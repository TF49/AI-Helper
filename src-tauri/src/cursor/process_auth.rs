//! Cursor Bridge 调用方认证
//!
//! Bridge 只监听回环地址，但同一台机器上的其他进程（包括其他系统用户）
//! 同样能连上它。每条 TCP 连接在第一次请求时，根据对端端口找到发起连接的
//! 进程，确认它属于运行 AI Helper 的同一系统用户；结果按连接缓存，同一
//! keep-alive 连接不重复查询。查询失败一律拒绝。程序名只用于日志，不参与判断。

use axum::{
    extract::{connect_info::Connected, ConnectInfo, Request},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
    serve::IncomingStream,
};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::OnceCell;

/// 对端连接所属进程的查询结果
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PeerOwner {
    pub same_user: bool,
    pub program: String,
}

/// 平台相关的对端进程查询，抽象出来以便测试注入
pub trait PeerLookup: Send + Sync {
    /// `peer` 是对端（客户端）地址，`local` 是 Bridge 一侧的地址。
    fn peer_owner(&self, peer: SocketAddr, local: SocketAddr) -> Result<PeerOwner, String>;
}

/// 每条连接的身份信息：由 axum 在接受连接时创建一次，之后该连接上的
/// 所有请求共享同一个校验结果缓存。
#[derive(Clone)]
pub struct PeerConnection {
    pub peer: SocketAddr,
    pub local: Option<SocketAddr>,
    verdict: Arc<OnceCell<bool>>,
}

impl PeerConnection {
    #[cfg(test)]
    pub fn new(peer: SocketAddr, local: Option<SocketAddr>) -> Self {
        Self {
            peer,
            local,
            verdict: Arc::new(OnceCell::new()),
        }
    }
}

impl Connected<IncomingStream<'_>> for PeerConnection {
    fn connect_info(target: IncomingStream<'_>) -> Self {
        Self {
            peer: target.remote_addr(),
            local: target.local_addr().ok(),
            verdict: Arc::new(OnceCell::new()),
        }
    }
}

/// 判断对端是否允许访问。查询失败、非同一用户都返回 Err，并记一条 warn。
pub fn authorize_peer(
    lookup: &dyn PeerLookup,
    peer: SocketAddr,
    local: Option<SocketAddr>,
) -> Result<(), String> {
    let Some(local) = local else {
        log::warn!("Cursor Bridge 拒绝连接：无法确定本地监听地址 (对端 {peer})");
        return Err("无法确定本地监听地址".into());
    };
    match lookup.peer_owner(peer, local) {
        Ok(owner) if owner.same_user => Ok(()),
        Ok(owner) => {
            log::warn!(
                "Cursor Bridge 拒绝来自其他系统用户的连接：对端程序 {}",
                owner.program
            );
            Err("调用方不属于当前系统用户".into())
        }
        Err(error) => {
            log::warn!("Cursor Bridge 拒绝无法识别调用方的连接：{error}");
            Err("无法确认调用方身份".into())
        }
    }
}

/// 按连接校验并缓存结果。并发请求只会触发一次查询。
pub async fn verify_connection(lookup: Arc<dyn PeerLookup>, connection: &PeerConnection) -> bool {
    *connection
        .verdict
        .get_or_init(|| {
            let peer = connection.peer;
            let local = connection.local;
            async move {
                tokio::task::spawn_blocking(move || {
                    authorize_peer(lookup.as_ref(), peer, local).is_ok()
                })
                .await
                .unwrap_or_else(|error| {
                    log::warn!("Cursor Bridge 调用方校验任务异常，已拒绝连接：{error}");
                    false
                })
            }
        })
        .await
}

/// 当前平台的默认实现
pub fn system_lookup() -> Arc<dyn PeerLookup> {
    Arc::new(SystemPeerLookup)
}

/// axum 中间件：作用于 Cursor Bridge 的全部路由。缺少连接信息时同样拒绝。
pub async fn peer_auth_middleware(
    lookup: Arc<dyn PeerLookup>,
    request: Request,
    next: Next,
) -> Response {
    let connection = request
        .extensions()
        .get::<ConnectInfo<PeerConnection>>()
        .map(|info| info.0.clone());
    let allowed = match connection {
        Some(connection) => verify_connection(lookup, &connection).await,
        None => {
            log::warn!("Cursor Bridge 拒绝缺少连接信息的请求");
            false
        }
    };
    if !allowed {
        return (StatusCode::FORBIDDEN, "Unauthorized caller").into_response();
    }
    next.run(request).await
}

struct SystemPeerLookup;

impl PeerLookup for SystemPeerLookup {
    fn peer_owner(&self, peer: SocketAddr, local: SocketAddr) -> Result<PeerOwner, String> {
        platform::peer_owner(peer, local)
    }
}

/// 一条 TCP 连接在系统连接表中的端点（端口均为主机字节序）
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(target_os = "macos", allow(dead_code))]
struct TcpEndpoint {
    local_port: u16,
    remote_port: u16,
}

/// 客户端一侧的套接字：本地端口是对端端口，远端端口是 Bridge 端口。
#[cfg_attr(target_os = "macos", allow(dead_code))]
fn is_client_socket(entry: TcpEndpoint, peer: SocketAddr, local: SocketAddr) -> bool {
    entry.local_port == peer.port() && entry.remote_port == local.port()
}

/// Linux `/proc/net/tcp` 与 `/proc/net/tcp6` 的解析。
/// 返回发起连接的套接字条目中的 (uid, inode)。
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn find_in_proc_net_tcp(content: &str, peer: SocketAddr, local: SocketAddr) -> Option<(u32, u64)> {
    fn port(field: &str) -> Option<u16> {
        let (_, port) = field.rsplit_once(':')?;
        u16::from_str_radix(port, 16).ok()
    }
    content.lines().skip(1).find_map(|line| {
        // sl local_address rem_address st tx:rx tr:tm retrnsmt uid timeout inode ...
        let fields: Vec<&str> = line.split_whitespace().collect();
        if fields.len() < 10 {
            return None;
        }
        let entry = TcpEndpoint {
            local_port: port(fields[1])?,
            remote_port: port(fields[2])?,
        };
        if !is_client_socket(entry, peer, local) {
            return None;
        }
        Some((fields[7].parse().ok()?, fields[9].parse().ok()?))
    })
}

#[cfg(target_os = "linux")]
mod platform {
    use super::{find_in_proc_net_tcp, PeerOwner};
    use std::net::SocketAddr;
    use std::os::unix::fs::MetadataExt;

    pub(super) fn peer_owner(peer: SocketAddr, local: SocketAddr) -> Result<PeerOwner, String> {
        let current_uid = std::fs::metadata("/proc/self")
            .map_err(|e| format!("读取当前用户失败: {e}"))?
            .uid();
        let mut found = None;
        for table in ["/proc/net/tcp", "/proc/net/tcp6"] {
            let content = match std::fs::read_to_string(table) {
                Ok(content) => content,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => return Err(format!("读取 {table} 失败: {error}")),
            };
            if let Some(entry) = find_in_proc_net_tcp(&content, peer, local) {
                found = Some(entry);
                break;
            }
        }
        let (uid, inode) = found.ok_or("在系统连接表中找不到对端连接")?;
        Ok(PeerOwner {
            same_user: uid == current_uid,
            program: program_for_socket(inode).unwrap_or_else(|| format!("未知程序 (uid {uid})")),
        })
    }

    /// 仅用于日志：在可访问的进程中找到持有该 socket inode 的程序名。
    fn program_for_socket(inode: u64) -> Option<String> {
        let target = format!("socket:[{inode}]");
        for process in std::fs::read_dir("/proc").ok()?.flatten() {
            let pid = process.file_name();
            if !pid.to_string_lossy().bytes().all(|b| b.is_ascii_digit()) {
                continue;
            }
            let Ok(fds) = std::fs::read_dir(process.path().join("fd")) else {
                continue;
            };
            for fd in fds.flatten() {
                if std::fs::read_link(fd.path()).is_ok_and(|link| link.to_string_lossy() == target)
                {
                    return std::fs::read_to_string(process.path().join("comm"))
                        .ok()
                        .map(|name| name.trim().to_string());
                }
            }
        }
        None
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::PeerOwner;
    use libproc::libproc::bsd_info::BSDInfo;
    use libproc::libproc::file_info::{pidfdinfo, ListFDs, ProcFDType};
    use libproc::libproc::net_info::{SocketFDInfo, SocketInfoKind};
    use libproc::libproc::proc_pid::{listpidinfo, pidinfo};
    use libproc::processes::{pids_by_type, ProcFilter};
    use std::net::SocketAddr;

    /// `insi_lport` / `insi_fport` 以网络字节序保存在 int 的低 16 位。
    fn network_port(value: i32) -> u16 {
        u16::from_be(value as u16)
    }

    pub(super) fn peer_owner(peer: SocketAddr, local: SocketAddr) -> Result<PeerOwner, String> {
        let current_uid = pidinfo::<BSDInfo>(std::process::id() as i32, 0)
            .map_err(|e| format!("读取当前用户失败: {e}"))?
            .pbi_uid;
        let pids = pids_by_type(ProcFilter::All).map_err(|e| format!("列出进程失败: {e}"))?;
        for pid in pids {
            let pid = pid as i32;
            if pid <= 0 {
                continue;
            }
            // 其他用户的进程通常无法读取其文件描述符；只要在同一用户的
            // 进程中找不到发起连接的套接字，就按查询失败拒绝。
            let Ok(info) = pidinfo::<BSDInfo>(pid, 0) else {
                continue;
            };
            let Ok(fds) = listpidinfo::<ListFDs>(pid, info.pbi_nfiles as usize) else {
                continue;
            };
            for fd in fds {
                if !matches!(ProcFDType::from(fd.proc_fdtype), ProcFDType::Socket) {
                    continue;
                }
                let Ok(socket) = pidfdinfo::<SocketFDInfo>(pid, fd.proc_fd) else {
                    continue;
                };
                if !matches!(
                    SocketInfoKind::from(socket.psi.soi_kind),
                    SocketInfoKind::Tcp
                ) {
                    continue;
                }
                // SAFETY: soi_kind 已确认是 TCP，pri_tcp 是联合体中的有效成员。
                let tcp = unsafe { socket.psi.soi_proto.pri_tcp };
                let local_port = network_port(tcp.tcpsi_ini.insi_lport);
                let remote_port = network_port(tcp.tcpsi_ini.insi_fport);
                if local_port == peer.port() && remote_port == local.port() {
                    let program = libproc::libproc::proc_pid::name(pid)
                        .unwrap_or_else(|_| format!("pid {pid}"));
                    return Ok(PeerOwner {
                        same_user: info.pbi_uid == current_uid,
                        program,
                    });
                }
            }
        }
        Err("在当前用户的进程中找不到对端连接".into())
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::{is_client_socket, PeerOwner, TcpEndpoint};
    use std::ffi::c_void;
    use std::net::SocketAddr;

    type Handle = *mut c_void;

    const AF_INET: u32 = 2;
    const AF_INET6: u32 = 23;
    const TCP_TABLE_OWNER_PID_ALL: u32 = 5;
    const ERROR_INSUFFICIENT_BUFFER: u32 = 122;
    const NO_ERROR: u32 = 0;
    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    const TOKEN_QUERY: u32 = 0x0008;
    const TOKEN_USER_CLASS: u32 = 1;

    #[repr(C)]
    struct MibTcpRowOwnerPid {
        state: u32,
        local_addr: u32,
        local_port: u32,
        remote_addr: u32,
        remote_port: u32,
        owning_pid: u32,
    }

    #[repr(C)]
    struct MibTcp6RowOwnerPid {
        local_addr: [u8; 16],
        local_scope_id: u32,
        local_port: u32,
        remote_addr: [u8; 16],
        remote_scope_id: u32,
        remote_port: u32,
        state: u32,
        owning_pid: u32,
    }

    #[repr(C)]
    struct SidAndAttributes {
        sid: *mut c_void,
        attributes: u32,
    }

    #[link(name = "iphlpapi")]
    extern "system" {
        fn GetExtendedTcpTable(
            table: *mut c_void,
            size: *mut u32,
            order: i32,
            family: u32,
            class: u32,
            reserved: u32,
        ) -> u32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> Handle;
        fn GetCurrentProcess() -> Handle;
        fn CloseHandle(handle: Handle) -> i32;
        fn QueryFullProcessImageNameW(
            process: Handle,
            flags: u32,
            name: *mut u16,
            size: *mut u32,
        ) -> i32;
    }

    #[link(name = "advapi32")]
    extern "system" {
        fn OpenProcessToken(process: Handle, access: u32, token: *mut Handle) -> i32;
        fn GetTokenInformation(
            token: Handle,
            class: u32,
            info: *mut c_void,
            length: u32,
            returned: *mut u32,
        ) -> i32;
        fn EqualSid(first: *mut c_void, second: *mut c_void) -> i32;
    }

    struct OwnedHandle(Handle);

    impl Drop for OwnedHandle {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe { CloseHandle(self.0) };
            }
        }
    }

    /// 端口字段以网络字节序保存在 DWORD 的低 16 位。
    fn table_port(value: u32) -> u16 {
        u16::from_be((value & 0xffff) as u16)
    }

    /// 读取一张 TCP 连接表的原始字节（表头 dwNumEntries + 行数组）。
    fn read_table(family: u32) -> Result<Vec<u32>, String> {
        let mut size = 0u32;
        let mut buffer: Vec<u32> = Vec::new();
        for _ in 0..4 {
            let status = unsafe {
                GetExtendedTcpTable(
                    if buffer.is_empty() {
                        std::ptr::null_mut()
                    } else {
                        buffer.as_mut_ptr().cast()
                    },
                    &mut size,
                    0,
                    family,
                    TCP_TABLE_OWNER_PID_ALL,
                    0,
                )
            };
            match status {
                NO_ERROR if !buffer.is_empty() => return Ok(buffer),
                NO_ERROR | ERROR_INSUFFICIENT_BUFFER => {
                    // 以 u32 为单位分配，保证行结构 4 字节对齐；预留余量应对连接表增长。
                    buffer = vec![0u32; (size as usize).div_ceil(4) + 64];
                    size = (buffer.len() * 4) as u32;
                }
                other => return Err(format!("GetExtendedTcpTable 失败，错误码 {other}")),
            }
        }
        Err("系统连接表持续变化，无法读取".into())
    }

    fn rows<T>(table: &[u32]) -> &[T] {
        let count = table.first().copied().unwrap_or(0) as usize;
        let available = (table.len().saturating_sub(1) * 4) / std::mem::size_of::<T>();
        let count = count.min(available);
        // SAFETY: 缓冲区由 GetExtendedTcpTable 按 MIB_TCP(6)TABLE_OWNER_PID 填充，
        // 行数组紧跟在 4 字节表头之后，且 count 已按缓冲区长度截断。
        unsafe { std::slice::from_raw_parts(table.as_ptr().add(1).cast::<T>(), count) }
    }

    fn find_owner_pid(peer: SocketAddr, local: SocketAddr) -> Result<u32, String> {
        let family = if peer.is_ipv4() { AF_INET } else { AF_INET6 };
        let table = read_table(family)?;
        let pid = if family == AF_INET {
            rows::<MibTcpRowOwnerPid>(&table).iter().find_map(|row| {
                let entry = TcpEndpoint {
                    local_port: table_port(row.local_port),
                    remote_port: table_port(row.remote_port),
                };
                is_client_socket(entry, peer, local).then_some(row.owning_pid)
            })
        } else {
            rows::<MibTcp6RowOwnerPid>(&table).iter().find_map(|row| {
                let entry = TcpEndpoint {
                    local_port: table_port(row.local_port),
                    remote_port: table_port(row.remote_port),
                };
                is_client_socket(entry, peer, local).then_some(row.owning_pid)
            })
        };
        pid.ok_or_else(|| "在系统连接表中找不到对端连接".into())
    }

    /// 返回进程令牌中的 TOKEN_USER 缓冲区（首个字段即用户 SID 指针）。
    fn token_user(process: Handle) -> Result<Vec<u64>, String> {
        let mut token: Handle = std::ptr::null_mut();
        if unsafe { OpenProcessToken(process, TOKEN_QUERY, &mut token) } == 0 {
            return Err(format!(
                "打开进程令牌失败: {}",
                std::io::Error::last_os_error()
            ));
        }
        let token = OwnedHandle(token);
        let mut needed = 0u32;
        unsafe {
            GetTokenInformation(
                token.0,
                TOKEN_USER_CLASS,
                std::ptr::null_mut(),
                0,
                &mut needed,
            )
        };
        if needed == 0 {
            return Err("读取进程用户失败".into());
        }
        // u64 缓冲区保证 SID_AND_ATTRIBUTES 中指针字段的对齐。
        let mut buffer = vec![0u64; (needed as usize).div_ceil(8)];
        if unsafe {
            GetTokenInformation(
                token.0,
                TOKEN_USER_CLASS,
                buffer.as_mut_ptr().cast(),
                (buffer.len() * 8) as u32,
                &mut needed,
            )
        } == 0
        {
            return Err(format!(
                "读取进程用户失败: {}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(buffer)
    }

    fn sid_of(token_user: &[u64]) -> *mut c_void {
        // SAFETY: 缓冲区由 GetTokenInformation(TokenUser) 填充，以 TOKEN_USER 开头。
        unsafe { (*(token_user.as_ptr().cast::<SidAndAttributes>())).sid }
    }

    fn program_name(process: Handle) -> Option<String> {
        let mut buffer = vec![0u16; 32_768];
        let mut size = buffer.len() as u32;
        if unsafe { QueryFullProcessImageNameW(process, 0, buffer.as_mut_ptr(), &mut size) } == 0 {
            return None;
        }
        let path = String::from_utf16_lossy(&buffer[..size as usize]);
        std::path::Path::new(&path)
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
    }

    pub(super) fn peer_owner(peer: SocketAddr, local: SocketAddr) -> Result<PeerOwner, String> {
        let pid = find_owner_pid(peer, local)?;
        let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if process.is_null() {
            return Err(format!(
                "无法打开对端进程 (pid {pid}): {}",
                std::io::Error::last_os_error()
            ));
        }
        let process = OwnedHandle(process);
        let program = program_name(process.0).unwrap_or_else(|| format!("pid {pid}"));
        let peer_user = token_user(process.0).map_err(|e| format!("{program}: {e}"))?;
        let own_user = token_user(unsafe { GetCurrentProcess() })?;
        let same_user = unsafe { EqualSid(sid_of(&peer_user), sid_of(&own_user)) } != 0;
        Ok(PeerOwner { same_user, program })
    }
}

#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
mod platform {
    use super::PeerOwner;
    use std::net::SocketAddr;

    pub(super) fn peer_owner(_peer: SocketAddr, _local: SocketAddr) -> Result<PeerOwner, String> {
        Err("当前平台不支持校验 Bridge 调用方".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct FakeLookup {
        result: Result<PeerOwner, String>,
        calls: AtomicUsize,
    }

    impl FakeLookup {
        fn new(result: Result<PeerOwner, String>) -> Arc<Self> {
            Arc::new(Self {
                result,
                calls: AtomicUsize::new(0),
            })
        }
    }

    impl PeerLookup for FakeLookup {
        fn peer_owner(&self, _peer: SocketAddr, _local: SocketAddr) -> Result<PeerOwner, String> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.result.clone()
        }
    }

    fn addresses() -> (SocketAddr, SocketAddr) {
        (
            "127.0.0.1:53000".parse().unwrap(),
            "127.0.0.1:3000".parse().unwrap(),
        )
    }

    fn owner(same_user: bool) -> PeerOwner {
        PeerOwner {
            same_user,
            program: "test.exe".into(),
        }
    }

    #[test]
    fn same_user_peer_is_allowed() {
        let (peer, local) = addresses();
        let lookup = FakeLookup::new(Ok(owner(true)));
        assert!(authorize_peer(lookup.as_ref(), peer, Some(local)).is_ok());
    }

    #[test]
    fn other_user_peer_is_rejected() {
        let (peer, local) = addresses();
        let lookup = FakeLookup::new(Ok(owner(false)));
        assert!(authorize_peer(lookup.as_ref(), peer, Some(local)).is_err());
    }

    #[test]
    fn failed_lookup_or_missing_local_address_is_rejected() {
        let (peer, local) = addresses();
        let lookup = FakeLookup::new(Err("lookup failed".into()));
        assert!(authorize_peer(lookup.as_ref(), peer, Some(local)).is_err());
        let lookup = FakeLookup::new(Ok(owner(true)));
        assert!(authorize_peer(lookup.as_ref(), peer, None).is_err());
        assert_eq!(lookup.calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn verdict_is_cached_per_connection() {
        let (peer, local) = addresses();
        let lookup = FakeLookup::new(Ok(owner(true)));
        let connection = PeerConnection::new(peer, Some(local));
        assert!(verify_connection(lookup.clone(), &connection).await);
        assert!(verify_connection(lookup.clone(), &connection).await);
        assert_eq!(lookup.calls.load(Ordering::SeqCst), 1);

        // A new connection (even from the same address) is checked again.
        let reconnect = PeerConnection::new(peer, Some(local));
        assert!(verify_connection(lookup.clone(), &reconnect).await);
        assert_eq!(lookup.calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn middleware_rejects_other_users_and_missing_connection_info() {
        use axum::{body::Body, routing::get, Router};
        use tower::ServiceExt;

        let build = |lookup: Arc<dyn PeerLookup>| {
            Router::new()
                .route("/health", get(|| async { "ok" }))
                .layer(axum::middleware::from_fn(move |req, next| {
                    peer_auth_middleware(lookup.clone(), req, next)
                }))
        };
        let (peer, local) = addresses();
        let request = |info: Option<PeerConnection>| {
            let mut request = Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap();
            if let Some(info) = info {
                request.extensions_mut().insert(ConnectInfo(info));
            }
            request
        };

        let denied = build(FakeLookup::new(Ok(owner(false))))
            .oneshot(request(Some(PeerConnection::new(peer, Some(local)))))
            .await
            .unwrap();
        assert_eq!(denied.status(), StatusCode::FORBIDDEN);

        let failed = build(FakeLookup::new(Err("no such socket".into())))
            .oneshot(request(Some(PeerConnection::new(peer, Some(local)))))
            .await
            .unwrap();
        assert_eq!(failed.status(), StatusCode::FORBIDDEN);

        let missing = build(FakeLookup::new(Ok(owner(true))))
            .oneshot(request(None))
            .await
            .unwrap();
        assert_eq!(missing.status(), StatusCode::FORBIDDEN);

        let allowed = build(FakeLookup::new(Ok(owner(true))))
            .oneshot(request(Some(PeerConnection::new(peer, Some(local)))))
            .await
            .unwrap();
        assert_eq!(allowed.status(), StatusCode::OK);
    }

    #[test]
    fn proc_net_tcp_parser_finds_the_client_side_socket() {
        let (peer, local) = addresses();
        // 53000 = 0xCF08, 3000 = 0x0BB8
        let table = "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n\
   0: 0100007F:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 11111 1 0000000000000000 100 0 0 10 0\n\
   1: 0100007F:0BB8 0100007F:CF08 01 00000000:00000000 00:00000000 00000000  1000        0 22222 1 0000000000000000 20 4 30 10 -1\n\
   2: 0100007F:CF08 0100007F:0BB8 01 00000000:00000000 00:00000000 00000000  1001        0 33333 1 0000000000000000 20 4 30 10 -1\n";
        // Row 1 is the bridge's accepted socket; row 2 is the client socket.
        assert_eq!(
            find_in_proc_net_tcp(table, peer, local),
            Some((1001, 33333))
        );
        let other: SocketAddr = "127.0.0.1:53001".parse().unwrap();
        assert_eq!(find_in_proc_net_tcp(table, other, local), None);
    }

    #[test]
    fn proc_net_tcp6_parser_handles_ipv6_rows_and_malformed_lines() {
        let peer: SocketAddr = "[::1]:53000".parse().unwrap();
        let local: SocketAddr = "[::1]:3000".parse().unwrap();
        let table = "  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n\
   garbage\n\
   0: 00000000000000000000000001000000:CF08 00000000000000000000000001000000:0BB8 01 00000000:00000000 00:00000000 00000000   501        0 44444 1 0000000000000000 20 4 30 10 -1\n";
        assert_eq!(find_in_proc_net_tcp(table, peer, local), Some((501, 44444)));
        assert_eq!(find_in_proc_net_tcp("", peer, local), None);
    }

    /// Exercises the real platform lookup against a loopback connection made by
    /// this test process: the peer must resolve to the current user.
    #[cfg(any(target_os = "windows", target_os = "linux", target_os = "macos"))]
    #[test]
    fn system_lookup_recognizes_a_connection_from_this_process() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let local = listener.local_addr().unwrap();
        let client = std::net::TcpStream::connect(local).unwrap();
        let (_server_side, peer) = listener.accept().unwrap();
        assert_eq!(peer, client.local_addr().unwrap());
        let owner = system_lookup().peer_owner(peer, local).unwrap();
        assert!(owner.same_user, "{owner:?}");
    }
}
