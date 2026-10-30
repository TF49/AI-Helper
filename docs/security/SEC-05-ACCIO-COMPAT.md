# SEC-05 Accio Bridge 实例鉴权兼容说明

Bridge 对除 `/health` 外的路由要求实例凭据，并在读请求体之前拒绝。

## 凭据传递方式

Accio 不读取任何鉴权类环境变量，也不会携带自定义请求头。它只读取 `GATEWAY_BASE_URL` 与 `ADK_BASE_URL`，并以字符串拼接（`${baseUrl}${path}`）生成请求地址。因此 AI Helper 拉起 Accio 时把凭据作为路径前缀写入这两个地址：

- `GATEWAY_BASE_URL=http://127.0.0.1:<port>/i/<token>`
- `ADK_BASE_URL=http://127.0.0.1:<port>/i/<token>/api/adk/llm`

Bridge 的安全中间件包在路由之外：先以常量时间比较校验 `/i/<token>`，通过后剥离前缀再进入路由，业务处理与官方网关转发看到的都是不含凭据的路径。

其他调用方仍可使用请求头凭据，三者择一：

- `x-ai-helper-instance: <token>`
- `x-gateway-auth: <token>`
- `Authorization: Bearer <token>`

无凭据、错误凭据、伪造 Origin、DNS Rebinding Host 均失败关闭。监听失败不回退默认端口。

## 凭据生命周期

凭据在 AI Helper 进程内首次启动 Bridge 时生成，Bridge 停止、改端口重启时保持不变，AI Helper 退出后失效。AI Helper 重启后，正在运行的 Accio 仍持有旧凭据，所有请求返回 401，需要通过 AI Helper 重新启动 Accio。

凭据会出现在 Accio 的日志 `~/.accio/logs/sdk.log` 中（Accio 会记录完整请求 URL）。该文件仅当前用户可读，同用户进程本就能读取 `~/.ai-helper` 下的配置，因此不扩大暴露面；凭据防护的对象是浏览器网页、DNS Rebinding 及其他用户。

## 防官方泄露（prevent_official_leak）

开启时，Bridge 只向官方网关透传账号与元数据接口（登录态、团队、Agent 同步、技能、插件、功能开关、模型目录、子代理路由策略等，见 `accio/config.rs` 的 `OFFICIAL_METADATA_PREFIXES` / `OFFICIAL_METADATA_PATHS`）。这些接口不触发推理、不消耗 i 豆。路径仅允许字母、数字、`/`、`-`、`_`，拒绝 `..` 与百分号编码。其余路径一律返回 403。

## 已验证版本

| Accio 版本 | 平台 | 结论 |
| --- | --- | --- |
| 0.36.2 | Windows | 通过源码确认 `GATEWAY_BASE_URL` 按字符串拼接使用；旧的请求头方案下全部 401（`sdk.log` 证据），路径前缀方案待实机回归 |
