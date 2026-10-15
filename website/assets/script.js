"use strict";

const CURRENT_VERSION = "v1.0.63";
const GITHUB_REPO = "TF49/AI-Helper";
const GITHUB_RELEASES_URL = "https://github.com/" + GITHUB_REPO + "/releases";
const GHFAST_PREFIX = "https://ghfast.top/";

const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)");
const MOBILE_VIEW = window.matchMedia("(max-width: 767px)");
const FINE_POINTER = window.matchMedia("(hover: hover) and (pointer: fine)");

const SIMULATOR_DATA = {
  chatgpt: {
    title: "OpenAI Codex 配置中心",
    desc: "统一管理 ~/.codex/config.toml，并兼容 Store 隔离包与 Win32 原生版。",
    configPath: "~/.codex/config.toml",
    apiUrl: "https://api.openai.com/v1",
    model: "gpt-4o",
    chips: ["gpt-4o", "gpt-4o-mini", "o1", "o3-mini"],
    groupName: "SVIP-Codex-HighSpeed",
    groupRate: "99.9%",
    groupLatency: "78ms",
    status: "Codex 已就绪",
    sampleTokens: [
      "> [CONNECT] POST https://api.openai.com/v1",
      "> [GROUP] Channel SVIP-Codex: 99.9% success · 78ms avg",
      "> [STREAM] First token received · 78ms",
      "✓ Codex gateway is ready"
    ]
  },
  claude: {
    title: "Claude Code 配置托管",
    desc: "集中维护 ~/.claude.json 与 settings.json，并快速切换常用模型。",
    configPath: "~/.claude.json",
    apiUrl: "https://api.anthropic.com/v1",
    model: "claude-3-7-sonnet",
    chips: ["claude-3-7-sonnet", "claude-3-5-sonnet", "claude-3-5-haiku"],
    groupName: "ClaudeCode-Kiro-SVIP",
    groupRate: "100%",
    groupLatency: "142ms",
    status: "Claude 已接管",
    sampleTokens: [
      "> [CONNECT] POST https://api.anthropic.com/v1",
      "> [GROUP] Channel ClaudeCode-Kiro: 100% success · 142ms avg",
      "> [STREAM] Thinking channel ready",
      "✓ Claude Code is ready"
    ]
  },
  workbuddy: {
    title: "Workbuddy AI 工作流中枢",
    desc: "写入 ~/.workbuddy/models.json，并自动双向兼容 ~/.workbuddy-ai。",
    configPath: "~/.workbuddy/models.json",
    apiUrl: "https://api.workbuddy.cn/v1",
    model: "deepseek-coder",
    chips: ["deepseek-coder", "claude-3.5-sonnet", "gpt-4o", "kimi-latest"],
    groupName: "WorkBuddy-AllModels",
    groupRate: "99.4%",
    groupLatency: "65ms",
    status: "Workbuddy 已同步",
    sampleTokens: [
      "> [CONNECT] Workbuddy gateway",
      "> [GROUP] Multi-model route synced · 65ms avg",
      "> [ENV] Runtime variables injected",
      "✓ Workbuddy profile is ready"
    ]
  },
  acciowork: {
    title: "Accio Work Bridge 接入",
    desc: "通过本地 RLab Bridge 转译网关，让 Accio Work 使用自定义第三方模型。",
    configPath: "~/.ai-helper/accio_config.json",
    apiUrl: "http://127.0.0.1:8787",
    model: "gpt-4o",
    chips: ["gpt-4o", "claude-3-7-sonnet", "deepseek-chat", "自定义模型"],
    groupName: "Accio-Enterprise-Bridge",
    groupRate: "99.8%",
    groupLatency: "120ms",
    status: "Bridge 在线 :8787",
    sampleTokens: [
      "> [BRIDGE] Listening on 127.0.0.1:8787",
      "> [GROUP] Bridge upstream verified · 99.8% SLA",
      "> [ROUTE] Custom model translation ready",
      "✓ Accio Work Bridge is online"
    ]
  },
  paths: {
    title: "路径感知与进程安全热重启",
    desc: "扫描进程树、释放文件句柄，并以最新配置重新拉起目标客户端。",
    configPath: "~/.ai-helper/app_paths.json",
    apiUrl: "Local process controller",
    model: "taskkill /F /T",
    chips: ["自动探测", "Store 解包", "句柄轮询", "进程树自愈"],
    groupName: "Local-Core-Controller",
    groupRate: "100%",
    groupLatency: "12ms",
    status: "进程守护中",
    sampleTokens: [
      "> [PROCESS] Scanning target process tree",
      "> [CLEANUP] Child processes terminated",
      "> [HANDLE] File locks released · 120ms",
      "✓ Target client restarted safely"
    ]
  }
};

const GROUP_MONITOR_DATA = {
  chatgpt: {
    groupName: "SVIP-Codex-HighSpeed",
    tag: "Codex 流式专用",
    successRate: 99.9,
    latency: "78ms",
    latencyVal: 78,
    totalRequests: "18,420",
    failed: "0 熔断",
    statusText: "99.9% 运行极佳",
    guide: "Codex 命令行深度依赖高并发流式代码补全与特定上游模型，自动绑定拥有专属流式权限的分组，拒绝补全超时。",
    ribbonPoints: [
      { rate: 100, lat: 76 }, { rate: 100, lat: 75 }, { rate: 100, lat: 78 }, { rate: 99.8, lat: 82 },
      { rate: 100, lat: 74 }, { rate: 100, lat: 77 }, { rate: 100, lat: 79 }, { rate: 100, lat: 75 },
      { rate: 100, lat: 76 }, { rate: 100, lat: 74 }, { rate: 100, lat: 80 }, { rate: 100, lat: 76 },
      { rate: 100, lat: 75 }, { rate: 99.9, lat: 81 }, { rate: 100, lat: 77 }, { rate: 100, lat: 76 },
      { rate: 100, lat: 74 }, { rate: 100, lat: 78 }, { rate: 100, lat: 75 }, { rate: 100, lat: 77 },
      { rate: 100, lat: 76 }, { rate: 100, lat: 75 }, { rate: 100, lat: 79 }, { rate: 100, lat: 78 }
    ]
  },
  claude: {
    groupName: "ClaudeCode-Kiro-SVIP",
    tag: "Anthropic 深度推理",
    successRate: 100.0,
    latency: "142ms",
    latencyVal: 142,
    totalRequests: "12,850",
    failed: "0 熔断",
    statusText: "100% 满额可用",
    guide: "Claude Code CLI 深度依赖原生流式协议、Extended Thinking 思考链推理与 Prompt Caching，专属通道彻底规避 400/404 错误。",
    ribbonPoints: [
      { rate: 100, lat: 140 }, { rate: 100, lat: 142 }, { rate: 100, lat: 139 }, { rate: 100, lat: 145 },
      { rate: 100, lat: 141 }, { rate: 100, lat: 144 }, { rate: 100, lat: 140 }, { rate: 100, lat: 142 },
      { rate: 100, lat: 143 }, { rate: 100, lat: 139 }, { rate: 100, lat: 141 }, { rate: 100, lat: 144 },
      { rate: 100, lat: 142 }, { rate: 100, lat: 140 }, { rate: 100, lat: 145 }, { rate: 100, lat: 143 },
      { rate: 100, lat: 141 }, { rate: 100, lat: 142 }, { rate: 100, lat: 139 }, { rate: 100, lat: 146 },
      { rate: 100, lat: 140 }, { rate: 100, lat: 142 }, { rate: 100, lat: 144 }, { rate: 100, lat: 142 }
    ]
  },
  workbuddy: {
    groupName: "WorkBuddy-AllModels",
    tag: "多模型异构聚合",
    successRate: 99.5,
    latency: "62ms",
    latencyVal: 62,
    totalRequests: "24,190",
    failed: "2 告警",
    statusText: "99.5% 优质可用",
    guide: "聚合管理异构模型（DeepSeek、Claude、GPT-4o），自动路由至 models.json 中目标模型权限与配额全覆盖分组。",
    ribbonPoints: [
      { rate: 100, lat: 58 }, { rate: 100, lat: 60 }, { rate: 99.2, lat: 68 }, { rate: 100, lat: 61 },
      { rate: 100, lat: 59 }, { rate: 100, lat: 62 }, { rate: 100, lat: 63 }, { rate: 100, lat: 60 },
      { rate: 100, lat: 64 }, { rate: 99.6, lat: 67 }, { rate: 100, lat: 61 }, { rate: 100, lat: 59 },
      { rate: 100, lat: 62 }, { rate: 100, lat: 60 }, { rate: 100, lat: 65 }, { rate: 100, lat: 63 },
      { rate: 100, lat: 59 }, { rate: 100, lat: 61 }, { rate: 100, lat: 60 }, { rate: 100, lat: 64 },
      { rate: 100, lat: 62 }, { rate: 100, lat: 60 }, { rate: 100, lat: 63 }, { rate: 100, lat: 62 }
    ]
  },
  acciowork: {
    groupName: "Accio-Enterprise-Bridge",
    tag: "企业级长链路网关",
    successRate: 99.8,
    latency: "115ms",
    latencyVal: 115,
    totalRequests: "9,640",
    failed: "0 熔断",
    statusText: "99.8% 高度稳定",
    guide: "专为 Accio Work 多 Agent 长链路复杂工作流设计，Rust 本地 Bridge 专属稳定中转，保障长时间无断连。",
    ribbonPoints: [
      { rate: 100, lat: 112 }, { rate: 100, lat: 114 }, { rate: 100, lat: 118 }, { rate: 100, lat: 115 },
      { rate: 100, lat: 113 }, { rate: 100, lat: 116 }, { rate: 99.8, lat: 122 }, { rate: 100, lat: 115 },
      { rate: 100, lat: 114 }, { rate: 100, lat: 113 }, { rate: 100, lat: 117 }, { rate: 100, lat: 115 },
      { rate: 100, lat: 116 }, { rate: 100, lat: 112 }, { rate: 100, lat: 114 }, { rate: 100, lat: 118 },
      { rate: 100, lat: 115 }, { rate: 100, lat: 113 }, { rate: 100, lat: 116 }, { rate: 100, lat: 114 },
      { rate: 100, lat: 115 }, { rate: 100, lat: 117 }, { rate: 100, lat: 113 }, { rate: 100, lat: 115 }
    ]
  }
};

const SCENES = [
  {
    id: "discovery",
    tab: "chatgpt",
    overline: "SCENE 01 · DISCOVERY",
    workspaceTitle: "正在发现本机 AI 开发环境",
    workspaceDesc: "自动扫描 PATH、NPM 全局脚本与 Store 隔离包，定位全部可用客户端。",
    status: "扫描完成",
    copyTitle: "自动发现，不再手动翻路径。",
    copyBody: "启动即感知 Claude Code、Codex、Workbuddy 与 Accio Work 的安装位置和运行状态，并自动纠偏失效路径。",
    bullets: ["PATH 与 NPM 全局脚本扫描", "Store 隔离包智能识别", "异常路径自动修复"],
    terminal: [
      "> scanning PATH and package locations...",
      "✓ OpenAI Codex · Win32",
      "✓ Claude Code · NPM global",
      "✓ Workbuddy · Native client",
      "✓ Accio Work · RLab Bridge"
    ],
    latency: "4 AGENTS FOUND",
    action: "环境扫描完成",
    writeMode: "complete",
    showDiscovery: true,
    mobileRows: [["Codex", "Win32 · 已发现"], ["Claude Code", "NPM · 已发现"], ["Workbuddy", "Native · 已发现"], ["Accio Work", "Bridge · 已发现"]]
  },
  {
    id: "configure",
    tab: "claude",
    overline: "SCENE 02 · CONFIGURE",
    workspaceTitle: "统一配置网关、模型与本地路径",
    workspaceDesc: "切换 Agent 即加载对应配置结构，常用模型通过快捷芯片一键选择。",
    status: "配置已载入",
    copyTitle: "不同 Agent，同一套操作逻辑。",
    copyBody: "AI Helper 理解每个客户端的配置差异，将网关、模型和文件路径收敛到一致的操作界面。",
    bullets: ["按 Agent 加载专属配置格式", "模型芯片快速切换", "配置文件原生直达"],
    terminal: [
      "> profile: claude-code",
      "> config: ~/.claude.json",
      "> model: claude-3-7-sonnet",
      "✓ Configuration loaded"
    ],
    latency: "PROFILE READY",
    action: "保存当前配置",
    writeMode: "idle",
    showDiscovery: false,
    mobileRows: [["配置文件", "~/.claude.json"], ["API 网关", "api.anthropic.com"], ["默认模型", "claude-3-7-sonnet"]]
  },
  {
    id: "stream",
    tab: "workbuddy",
    overline: "SCENE 03 · STREAM VERIFY",
    workspaceTitle: "真实流式握手，立即确认连通状态",
    workspaceDesc: "向指定网关发起流式探针，观察鉴权、首字延迟与响应分块。",
    status: "正在验证",
    copyTitle: "不是“保存成功”，而是“连接已验证”。",
    copyBody: "在写入配置前完成一次真实流式握手，让错误网关、失效密钥和模型名称问题立刻暴露。",
    bullets: ["TLS 与鉴权状态可见", "首字延迟实时反馈", "Token 分块逐行输出"],
    terminal: [
      "> [CONNECT] POST https://api.workbuddy.cn/v1",
      "> [AUTH] Local token accepted",
      "> [STREAM] First response chunk · 78ms",
      "✓ 200 OK · Stream completed"
    ],
    latency: "TTFT 78MS",
    action: "重新测试连通性",
    writeMode: "active",
    showDiscovery: false,
    mobileRows: [["TLS 握手", "通过"], ["Token 鉴权", "通过"], ["首字延迟", "78ms"]]
  },
  {
    id: "write",
    tab: "chatgpt",
    overline: "SCENE 04 · ATOMIC WRITE",
    workspaceTitle: "校验完成，执行原子写入",
    workspaceDesc: "先生成临时配置并校验，再替换目标文件，同时同步进程内环境变量。",
    status: "安全落盘",
    copyTitle: "写入有边界，配置更可靠。",
    copyBody: "原子落盘避免半写入状态，进程内变量同步让当前应用与后续派生进程立刻读取最新配置。",
    bullets: ["写入前结构与字段校验", "临时文件原子替换", "运行时环境变量同步"],
    terminal: [
      "> [VALIDATE] config.toml schema passed",
      "> [WRITE] temporary file created",
      "> [COMMIT] atomic replace complete",
      "✓ Runtime environment synchronized"
    ],
    latency: "WRITE COMPLETE",
    action: "配置写入完成",
    writeMode: "complete",
    showDiscovery: false,
    mobileRows: [["结构校验", "PASS"], ["原子替换", "COMPLETE"], ["环境同步", "ACTIVE"]]
  },
  {
    id: "restart",
    tab: "paths",
    overline: "SCENE 05 · SAFE RESTART",
    workspaceTitle: "清理进程树，等待句柄释放并热重启",
    workspaceDesc: "终止旧进程树，轮询锁定状态，再携最新配置重新拉起客户端。",
    status: "重启完成",
    copyTitle: "安全重启，不留下僵尸进程。",
    copyBody: "有界等待文件句柄释放，杜绝端口冲突和多实例竞争，目标客户端以最新配置平滑恢复。",
    bullets: ["子进程树完整清理", "文件句柄有界轮询", "携最新配置重新拉起"],
    terminal: [
      "> [PROCESS] Target tree located",
      "> [CLEANUP] taskkill /F /T complete",
      "> [HANDLE] Released in 120ms",
      "✓ Client restarted with latest profile"
    ],
    latency: "PROCESS READY",
    action: "客户端已重新拉起",
    writeMode: "complete",
    showDiscovery: false,
    mobileRows: [["进程树", "已清理"], ["文件句柄", "120ms 释放"], ["目标客户端", "已重新拉起"]]
  }
];

let activeReleasePageUrl = GITHUB_RELEASES_URL + "/tag/" + CURRENT_VERSION;
let currentTab = "chatgpt";
let currentSceneIndex = -1;
let terminalRunToken = 0;
let toastTimer = 0;
let storyScrollTrigger = null;

document.addEventListener("DOMContentLoaded", function () {
  safeInit(initReleaseInfo);
  safeInit(initNavigation);
  safeInit(initMotionGrid);
  safeInit(initHeroMotion);
  safeInit(initCinematicStory);
  safeInit(initSectionMotion);
  safeInit(initWorkflowMotion);
  safeInit(initSpotlightCards);
  safeInit(initMagneticTargets);
  safeInit(initFaq);
  safeInit(initUtilityActions);
  safeInit(initGroupMonitorSection);
  safeInit(initDynamicDownloadButtons);
  safeInit(initParallaxMotion);
  safeInit(initHorizontalScroll);
  safeInit(initReactBitsComponents);
  safeInit(initCrossPlatformFeatures);
});

function safeInit(initializer) {
  try {
    initializer();
  } catch (error) {
    console.warn("[AI Helper] " + initializer.name + " 初始化失败", error);
  }
}

function initNavigation() {
  const nav = document.getElementById("site-nav");
  const toggle = document.getElementById("mobile-menu-toggle");
  const menu = document.getElementById("mobile-menu");
  const floating = document.getElementById("floating-download");
  const story = document.getElementById("story");
  const faq = document.getElementById("faq");
  let ticking = false;

  const navLinks = Array.from(document.querySelectorAll("[data-nav-section]"));
  const observedSections = navLinks.map(function (link) {
    return document.getElementById(link.getAttribute("data-nav-section"));
  }).filter(Boolean);

  function updateScrollSpy() {
    const scrollY = window.scrollY;
    const navHeight = nav ? nav.offsetHeight : 64;
    const probe = scrollY + navHeight + 80;

    let activeId = "";
    for (let i = observedSections.length - 1; i >= 0; i--) {
      const sec = observedSections[i];
      if (sec && sec.offsetTop <= probe) {
        activeId = sec.id;
        break;
      }
    }

    if (activeId) {
      navLinks.forEach(function (link) {
        link.classList.toggle("active", link.getAttribute("data-nav-section") === activeId);
      });
    }
  }

  function updateScrollState() {
    ticking = false;
    const scrollY = window.scrollY;
    nav.classList.toggle("scrolled", scrollY > 24);
    if (story && faq && floating) {
      const showAfter = story.offsetTop + Math.min(story.offsetHeight * 0.5, window.innerHeight * 2);
      const hideAfter = faq.offsetTop - window.innerHeight * 0.35;
      floating.classList.toggle("visible", scrollY > showAfter && scrollY < hideAfter);
    }
    updateScrollSpy();
  }

  window.addEventListener("scroll", function () {
    if (!ticking) {
      ticking = true;
      window.requestAnimationFrame(updateScrollState);
    }
  }, { passive: true });
  updateScrollState();

  // 1. 全局内部锚点平滑滚动 (避免任何原生跳跃与错位，排除平台选择交互胶囊)
  document.querySelectorAll('a[href^="#"]:not(.hero-pill-btn)').forEach(function (anchor) {
    anchor.addEventListener("click", function (e) {
      const href = anchor.getAttribute("href");
      if (!href || href === "#") return;
      const target = document.querySelector(href);
      if (target) {
        e.preventDefault();
        const navHeight = nav ? nav.offsetHeight : 64;
        let targetTop;
        if (window.ScrollTrigger) {
          const sectionId = href.replace(/^#/, "");
          const st = window.ScrollTrigger.getAll().find(function (s) {
            return s.trigger === target || (s.vars && s.vars.id === sectionId);
          });
          if (st && st.pin) {
            targetTop = st.start;
          }
        }
        if (targetTop === undefined) {
          targetTop = target.getBoundingClientRect().top + window.scrollY - navHeight;
        }
        window.scrollTo({
          top: Math.max(0, targetTop),
          behavior: "smooth"
        });

        // 立即高亮对应导航
        const sectionId = href.replace(/^#/, "");
        navLinks.forEach(function (link) {
          link.classList.toggle("active", link.getAttribute("data-nav-section") === sectionId);
        });

        if (history.pushState) {
          history.pushState(null, "", href);
        }
      }
    });
  });

  // 2. 移动端抽屉菜单
  if (toggle && menu) {
    toggle.addEventListener("click", function () {
      const open = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!open));
      toggle.setAttribute("aria-label", open ? "打开导航菜单" : "关闭导航菜单");
      menu.classList.toggle("open", !open);
    });

    menu.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-label", "打开导航菜单");
        menu.classList.remove("open");
      });
    });

    document.addEventListener("click", function (event) {
      if (!menu.contains(event.target) && !toggle.contains(event.target)) {
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-label", "打开导航菜单");
        menu.classList.remove("open");
      }
    });
  }

  // 3. 首屏若带 Hash 则就绪后自愈对齐
  function alignToHash() {
    if (!window.location.hash) return;
    const hashTarget = document.querySelector(window.location.hash);
    if (hashTarget) {
      const navHeight = nav ? nav.offsetHeight : 64;
      const targetTop = hashTarget.getBoundingClientRect().top + window.scrollY - navHeight;
      window.scrollTo({ top: Math.max(0, targetTop), behavior: "auto" });
      updateScrollSpy();
    }
  }

  if (window.location.hash) {
    setTimeout(alignToHash, 80);
    window.addEventListener("load", function () {
      setTimeout(alignToHash, 80);
    }, { once: true });
  }
}

function initMotionGrid() {
  const canvas = document.getElementById("motion-grid");
  if (!canvas || REDUCED_MOTION.matches || MOBILE_VIEW.matches || !FINE_POINTER.matches) return;

  const context = canvas.getContext("2d");
  if (!context) return;

  let width = 0;
  let height = 0;
  let dpr = 1;
  let frameId = 0;
  let lastFrame = 0;
  let running = true;
  const pointer = { x: window.innerWidth * 0.5, y: window.innerHeight * 0.4, active: false };

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function render(time) {
    if (!running) return;
    frameId = window.requestAnimationFrame(render);
    if (time - lastFrame < 32) return;
    lastFrame = time;
    context.clearRect(0, 0, width, height);

    const spacing = 58;
    const cols = Math.ceil(width / spacing) + 1;
    const rows = Math.ceil(height / spacing) + 1;

    for (let xIndex = 0; xIndex < cols; xIndex += 1) {
      for (let yIndex = 0; yIndex < rows; yIndex += 1) {
        const x = xIndex * spacing;
        const y = yIndex * spacing;
        const dx = x - pointer.x;
        const dy = y - pointer.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const influence = pointer.active ? Math.max(0, 1 - distance / 260) : 0;
        const radius = 1 + influence * 2.2;
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fillStyle = "rgba(30, 116, 218, " + (0.12 + influence * 0.28).toFixed(3) + ")";
        context.fill();
      }
    }
  }

  function start() {
    if (running) return;
    running = true;
    frameId = window.requestAnimationFrame(render);
  }

  function stop() {
    running = false;
    window.cancelAnimationFrame(frameId);
  }

  resize();
  frameId = window.requestAnimationFrame(render);
  window.addEventListener("resize", resize, { passive: true });
  window.addEventListener("pointermove", function (event) {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.active = true;
  }, { passive: true });
  document.addEventListener("pointerleave", function () { pointer.active = false; });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stop();
    else start();
  });
}

function initHeroMotion() {
  if (!window.gsap || REDUCED_MOTION.matches) return;
  const gsap = window.gsap;
  const timeline = gsap.timeline({ defaults: { ease: "power4.out" } });

  timeline
    .from(".hero-brand-mark", { opacity: 0, y: 18, scale: 0.82, rotate: -6, duration: 0.72, delay: 0.08 })
    .from(".hero-eyebrow", { opacity: 0, y: 16, duration: 0.58 }, "-=0.34")
    .from(".hero-line > span", { yPercent: 115, rotateX: -12, filter: "blur(10px)", duration: 1.05, stagger: 0.12 }, "-=0.32")
    .from(".hero-lead", { opacity: 0, y: 22, filter: "blur(5px)", duration: 0.78 }, "-=0.5")
    .from(".hero-actions", { opacity: 0, y: 18, duration: 0.62, clearProps: "transform" }, "-=0.42")
    .from(".hero-platform-pills", { opacity: 0, y: 14, duration: 0.52, clearProps: "transform" }, "-=0.38")
    .from(".hero-trust li", { opacity: 0, y: 12, duration: 0.45, stagger: 0.07, clearProps: "transform" }, "-=0.36")
    .from(".runway-node", { opacity: 0, y: 24, scale: 0.96, duration: 0.72, stagger: 0.12 }, "-=0.16")
    .from(".scroll-cue", { opacity: 0, duration: 0.5 }, "-=0.2");
}

function initCinematicStory() {
  renderMobileStory();
  bindSimulatorControls();
  goToScene(0, "initial");

  document.querySelectorAll("[data-scene-target]").forEach(function (button) {
    button.addEventListener("click", function () {
      scrollToScene(Number(button.getAttribute("data-scene-target")));
    });
  });

  const replayButton = document.getElementById("replay-story");
  if (replayButton) replayButton.addEventListener("click", function () { scrollToScene(0); });

  if (!window.gsap || !window.ScrollTrigger || REDUCED_MOTION.matches || MOBILE_VIEW.matches) return;
  window.gsap.registerPlugin(window.ScrollTrigger);
  storyScrollTrigger = window.ScrollTrigger.create({
    trigger: "#story",
    pin: true,
    pinSpacing: true,
    start: "top top",
    end: "+=2400",
    scrub: 0.45,
    invalidateOnRefresh: true,
    onUpdate: function (self) {
      const sceneIndex = Math.min(SCENES.length - 1, Math.floor(self.progress * SCENES.length));
      updateStoryProgress(self.progress);
      goToScene(sceneIndex, "scroll");
    }
  });
}

function scrollToScene(index) {
  const sceneIndex = clamp(index, 0, SCENES.length - 1);
  if (REDUCED_MOTION.matches) {
    goToScene(sceneIndex, "manual");
    return;
  }
  if (MOBILE_VIEW.matches) {
    const card = document.querySelector('[data-mobile-scene="' + sceneIndex + '"]');
    if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  if (storyScrollTrigger) {
    const p = (sceneIndex + 0.5) / SCENES.length;
    const target = storyScrollTrigger.start + (storyScrollTrigger.end - storyScrollTrigger.start) * p;
    window.scrollTo({ top: target, behavior: "smooth" });
  } else {
    const story = document.getElementById("story");
    if (!story) return;
    const start = story.offsetTop;
    const scrollDistance = Math.max(0, story.offsetHeight - window.innerHeight);
    const target = start + scrollDistance * (sceneIndex / (SCENES.length - 1));
    window.scrollTo({ top: target, behavior: "smooth" });
  }
}

function updateStoryProgress(progress) {
  const fill = document.getElementById("scene-progress-fill");
  if (fill) fill.style.height = Math.round(clamp(progress, 0, 1) * 100) + "%";
}

function goToScene(index, source) {
  const sceneIndex = clamp(index, 0, SCENES.length - 1);
  if (sceneIndex === currentSceneIndex && source !== "initial") return;
  currentSceneIndex = sceneIndex;
  terminalRunToken += 1;

  const scene = SCENES[sceneIndex];
  const story = document.getElementById("story");
  const productFrame = document.getElementById("product-frame");
  if (story) story.setAttribute("data-active-scene", String(sceneIndex));
  if (productFrame) {
    productFrame.setAttribute("data-scene-state", scene.id);
    productFrame.classList.toggle("show-discovery", scene.showDiscovery);
  }

  document.querySelectorAll(".scene-nav-item").forEach(function (button, buttonIndex) {
    const active = buttonIndex === sceneIndex;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
  });

  const targets = [
    document.getElementById("scene-copy-title"),
    document.getElementById("scene-copy-body"),
    document.getElementById("scene-bullets"),
    document.getElementById("sim-title"),
    document.getElementById("sim-desc")
  ].filter(Boolean);

  function applyScene() {
    switchSimulatorTab(scene.tab, false);
    setText("scene-copy-index", pad(sceneIndex + 1) + " / " + pad(SCENES.length));
    setText("scene-copy-title", scene.copyTitle);
    setText("scene-copy-body", scene.copyBody);
    setText("scene-overline", scene.overline);
    setText("sim-title", scene.workspaceTitle);
    setText("sim-desc", scene.workspaceDesc);
    setStatus(scene.status);
    setText("sim-latency-badge", scene.latency);
    setText("scene-bullets", "");
    const bullets = document.getElementById("scene-bullets");
    if (bullets) {
      scene.bullets.forEach(function (bullet) {
        const item = document.createElement("li");
        item.textContent = bullet;
        bullets.appendChild(item);
      });
    }

    const action = document.getElementById("btn-sim-test");
    if (action) {
      action.lastChild.textContent = scene.action;
    }

    updateWriteState(scene.writeMode, scene.action);
    const animateTerminal = scene.id === "stream" && !REDUCED_MOTION.matches;
    renderTerminal(scene.terminal, animateTerminal);
  }

  if (window.gsap && !REDUCED_MOTION.matches && source !== "initial") {
    window.gsap.killTweensOf(targets);
    window.gsap.to(targets, {
      opacity: 0,
      y: 10,
      filter: "blur(5px)",
      duration: 0.16,
      ease: "power2.in",
      onComplete: function () {
        applyScene();
        window.gsap.fromTo(targets,
          { opacity: 0, y: 14, filter: "blur(7px)" },
          { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.48, stagger: 0.025, ease: "power3.out", clearProps: "filter" }
        );
      }
    });
    window.gsap.fromTo("#product-frame", { rotateY: sceneIndex % 2 ? -1.2 : 1.2, scale: 0.995 }, { rotateY: 0, scale: 1, duration: 0.7, ease: "power3.out" });
  } else {
    applyScene();
  }
}

function bindSimulatorControls() {
  document.querySelectorAll(".agent-tab").forEach(function (button) {
    button.addEventListener("click", function () {
      switchSimulatorTab(button.getAttribute("data-tab"), true);
    });
    button.addEventListener("keydown", function (event) {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const tabs = Array.from(document.querySelectorAll(".agent-tab"));
      const currentIndex = tabs.indexOf(button);
      const offset = event.key === "ArrowRight" ? 1 : -1;
      const next = tabs[(currentIndex + offset + tabs.length) % tabs.length];
      next.focus();
      next.click();
    });
  });

  const testButton = document.getElementById("btn-sim-test");
  if (testButton) testButton.addEventListener("click", runSimulatorTerminalTest);
}

function switchSimulatorTab(tabKey, manual) {
  const data = SIMULATOR_DATA[tabKey];
  if (!data) return;
  currentTab = tabKey;

  document.querySelectorAll(".agent-tab").forEach(function (button) {
    const active = button.getAttribute("data-tab") === tabKey;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });

  const configInput = document.getElementById("sim-input-config");
  const apiInput = document.getElementById("sim-input-api");
  const modelInput = document.getElementById("sim-input-model");
  if (configInput) configInput.value = data.configPath;
  if (apiInput) apiInput.value = data.apiUrl;
  if (modelInput) modelInput.value = data.model;
  renderModelChips(data.chips);

  const groupInfo = document.getElementById("sim-group-info");
  if (groupInfo && data.groupName) {
    groupInfo.textContent = data.groupName + " · " + data.groupRate + " (" + data.groupLatency + ")";
  }

  if (manual) {
    setText("scene-overline", "MANUAL MODE · " + tabKey.toUpperCase());
    setText("sim-title", data.title);
    setText("sim-desc", data.desc);
    setStatus(data.status);
    setText("sim-latency-badge", "READY");
    updateWriteState("idle", "等待任务");
    renderTerminal(["// " + data.title, "// 点击“测试流式连通性”开始网络握手。"], false);
  }
}

function renderModelChips(chips) {
  const container = document.getElementById("sim-chips");
  if (!container) return;
  container.textContent = "";
  chips.forEach(function (chip, index) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "model-chip" + (index === 0 ? " active" : "");
    button.textContent = chip;
    button.addEventListener("click", function () {
      container.querySelectorAll(".model-chip").forEach(function (item) { item.classList.remove("active"); });
      button.classList.add("active");
      const modelInput = document.getElementById("sim-input-model");
      if (modelInput) modelInput.value = chip;
      showToast("模型已切换为 " + chip);
    });
    container.appendChild(button);
  });
}

function runSimulatorTerminalTest() {
  const data = SIMULATOR_DATA[currentTab];
  if (!data) return;
  setStatus("正在验证");
  setText("sim-latency-badge", "CONNECTING");
  updateWriteState("active", "流式握手中");
  renderTerminal(data.sampleTokens, true, function () {
    setStatus("连接验证通过");
    setText("sim-latency-badge", "TTFT 78MS");
    updateWriteState("complete", "网络状态优良");
    showToast("流式握手完成，首字延迟 78ms");
  });
}

function renderTerminal(lines, animate, onComplete) {
  const terminal = document.getElementById("sim-terminal-text");
  if (!terminal) return;
  const runToken = ++terminalRunToken;
  terminal.textContent = "";

  if (!animate) {
    terminal.textContent = lines.join("\n");
    if (onComplete) onComplete();
    return;
  }

  let lineIndex = 0;
  function appendLine() {
    if (runToken !== terminalRunToken) return;
    if (lineIndex >= lines.length) {
      if (onComplete) onComplete();
      return;
    }
    terminal.textContent += (lineIndex ? "\n" : "") + lines[lineIndex];
    lineIndex += 1;
    window.setTimeout(appendLine, lineIndex === 1 ? 180 : 360);
  }
  appendLine();
}

function updateWriteState(mode, label) {
  const state = document.getElementById("write-state");
  if (!state) return;
  state.classList.remove("active", "complete");
  if (mode === "active") state.classList.add("active");
  if (mode === "complete") state.classList.add("complete");
  const labelElement = state.querySelector("strong");
  if (labelElement) labelElement.textContent = label;
}

function setStatus(text) {
  const badge = document.getElementById("sim-status-badge");
  if (!badge) return;
  const textNode = Array.from(badge.childNodes).find(function (node) { return node.nodeType === Node.TEXT_NODE; });
  if (textNode) textNode.nodeValue = text;
  else badge.appendChild(document.createTextNode(text));
}

function renderMobileStory() {
  const container = document.getElementById("mobile-story-list");
  if (!container) return;
  container.textContent = "";

  const intro = document.createElement("header");
  intro.className = "mobile-story-intro";
  intro.innerHTML = '<span class="section-kicker">PRODUCT FILM · 01—05</span><h2>一次滚动，看完整条配置链路。</h2><p>移动端使用轻量章节卡片，保持顺畅、清晰和可读。</p>';
  container.appendChild(intro);

  SCENES.forEach(function (scene, index) {
    const card = document.createElement("article");
    card.className = "mobile-scene-card";
    card.setAttribute("data-mobile-scene", String(index));

    const top = document.createElement("div");
    top.className = "mobile-scene-top";
    top.innerHTML = "<span>" + pad(index + 1) + " / " + pad(SCENES.length) + "</span><span>" + scene.overline.split("·")[1].trim() + "</span>";

    const title = document.createElement("h3");
    title.textContent = scene.copyTitle;
    const body = document.createElement("p");
    body.textContent = scene.copyBody;
    const ui = document.createElement("div");
    ui.className = "mobile-scene-ui";
    scene.mobileRows.forEach(function (row) {
      const item = document.createElement("div");
      item.className = "mobile-ui-row";
      const label = document.createElement("span");
      const value = document.createElement("strong");
      label.textContent = row[0];
      value.textContent = row[1];
      item.appendChild(label);
      item.appendChild(value);
      ui.appendChild(item);
    });

    card.appendChild(top);
    card.appendChild(title);
    card.appendChild(body);
    card.appendChild(ui);
    container.appendChild(card);
  });

  if ("IntersectionObserver" in window && !REDUCED_MOTION.matches) {
    const observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("revealed");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.18 });
    container.querySelectorAll(".mobile-scene-card").forEach(function (card) { observer.observe(card); });
  }
}

function initSectionMotion() {
  if (!window.gsap || !window.ScrollTrigger || REDUCED_MOTION.matches) return;
  window.gsap.registerPlugin(window.ScrollTrigger);
  const gsap = window.gsap;

  gsap.utils.toArray(".section-heading").forEach(function (heading) {
    gsap.from(heading.children, {
      scrollTrigger: { trigger: heading, start: "top 82%", once: true },
      opacity: 0,
      y: 26,
      filter: "blur(6px)",
      duration: 0.75,
      stagger: 0.09,
      ease: "power3.out",
      clearProps: "filter"
    });
  });

  gsap.from(".capability-card", {
    scrollTrigger: { trigger: ".capability-grid", start: "top 78%", once: true },
    opacity: 0,
    y: 38,
    scale: 0.985,
    duration: 0.78,
    stagger: 0.09,
    ease: "power3.out"
  });

  gsap.from(".download-primary, .download-compact, .security-strip", {
    scrollTrigger: { trigger: ".download-layout", start: "top 80%", once: true },
    opacity: 0,
    y: 28,
    duration: 0.78,
    stagger: 0.08,
    ease: "power3.out",
    clearProps: "all"
  });

  const metric = document.querySelector(".metric-value[data-count]");
  if (metric) {
    const target = Number(metric.getAttribute("data-count")) || 35;
    const suffix = metric.getAttribute("data-suffix") || "";
    const counter = { value: 0 };
    gsap.to(counter, {
      value: target,
      duration: 1.5,
      ease: "power2.out",
      scrollTrigger: { trigger: metric, start: "top 86%", once: true },
      onUpdate: function () {
        metric.textContent = "< " + Math.round(counter.value) + suffix;
      }
    });
  }
}

function initWorkflowMotion() {
  const steps = Array.from(document.querySelectorAll(".workflow-step"));
  const fill = document.getElementById("workflow-line-fill");
  if (!steps.length || !fill) return;

  if (!window.gsap || !window.ScrollTrigger || REDUCED_MOTION.matches) {
    steps.forEach(function (step) { step.classList.add("active"); });
    if (MOBILE_VIEW.matches) fill.style.height = "100%";
    else fill.style.width = "100%";
    return;
  }

  window.gsap.registerPlugin(window.ScrollTrigger);
  window.ScrollTrigger.create({
    trigger: ".workflow-path",
    start: "top 72%",
    end: "bottom 58%",
    scrub: 0.45,
    onUpdate: function (self) {
      const percent = Math.round(self.progress * 100) + "%";
      if (MOBILE_VIEW.matches) {
        fill.style.height = percent;
        fill.style.width = "100%";
      } else {
        fill.style.width = percent;
        fill.style.height = "100%";
      }
      steps.forEach(function (step, index) {
        step.classList.toggle("active", self.progress >= index / steps.length);
      });
    }
  });
}

function initSpotlightCards() {
  if (!FINE_POINTER.matches || REDUCED_MOTION.matches) return;
  document.querySelectorAll(".spotlight-card").forEach(function (card) {
    card.addEventListener("pointermove", function (event) {
      const rect = card.getBoundingClientRect();
      card.style.setProperty("--mouse-x", event.clientX - rect.left + "px");
      card.style.setProperty("--mouse-y", event.clientY - rect.top + "px");
    });
  });
}

function initMagneticTargets() {
  if (!FINE_POINTER.matches || REDUCED_MOTION.matches || !window.gsap) return;
  document.querySelectorAll(".magnetic-target").forEach(function (target) {
    target.addEventListener("pointermove", function (event) {
      const rect = target.getBoundingClientRect();
      const x = event.clientX - rect.left - rect.width / 2;
      const y = event.clientY - rect.top - rect.height / 2;
      window.gsap.to(target, { x: x * 0.12, y: y * 0.16, duration: 0.28, ease: "power2.out" });
    });
    target.addEventListener("pointerleave", function () {
      window.gsap.to(target, { x: 0, y: 0, duration: 0.55, ease: "elastic.out(1, 0.45)" });
    });
  });
}

function initFaq() {
  document.querySelectorAll(".faq-trigger").forEach(function (trigger) {
    trigger.addEventListener("click", function () {
      const item = trigger.closest(".faq-item");
      const open = trigger.getAttribute("aria-expanded") === "true";
      document.querySelectorAll(".faq-item").forEach(function (otherItem) {
        const otherTrigger = otherItem.querySelector(".faq-trigger");
        otherItem.classList.remove("open");
        if (otherTrigger) otherTrigger.setAttribute("aria-expanded", "false");
      });
      if (!open) {
        item.classList.add("open");
        trigger.setAttribute("aria-expanded", "true");
      }
    });
  });
}

function initUtilityActions() {
  const cloneButton = document.getElementById("copy-clone-command");
  if (cloneButton) cloneButton.addEventListener("click", function () {
    copyToClipboard("git clone https://github.com/TF49/AI-Helper.git", "Git 克隆命令已复制");
  });

  document.querySelectorAll("#btn-copy-checksum, .btn-copy-checksum-mac").forEach(function (btn) {
    btn.addEventListener("click", function () {
      copyToClipboard(activeReleasePageUrl, "官方发布页链接已复制");
    });
  });

  ["open-config-demo", "native-open-demo"].forEach(function (id) {
    const button = document.getElementById(id);
    if (button) button.addEventListener("click", function () {
      showToast("演示：已通过默认编辑器打开配置文件");
    });
  });
}

let latestReleaseData = null;

/**
 * 智能检索当前用户操作系统 ('macos' | 'windows')
 */
function detectUserOS() {
  const ua = (navigator.userAgent || "").toLowerCase();
  const platform = (navigator.platform || "").toLowerCase();
  const uadPlatform = (navigator.userAgentData && typeof navigator.userAgentData.platform === "string")
    ? navigator.userAgentData.platform.toLowerCase()
    : "";

  // 1. 优先检索 macOS 特征 (Macintosh, macOS, MacIntel, Mac OS X 等)
  if (uadPlatform.includes("mac") || platform.includes("mac") || ua.includes("macintosh") || ua.includes("mac os x")) {
    return "macos";
  }

  // 2. 检索 Windows 特征 (Windows, Win32, Win64, WOW64 等)
  if (uadPlatform.includes("win") || platform.includes("win") || ua.includes("windows") || ua.includes("win32") || ua.includes("win64")) {
    return "windows";
  }

  // 默认适配 Windows
  return "windows";
}

let currentSelectedPlatform = detectUserOS();

/**
 * 切换与更新首页 Hero 立即下载按钮及平台快捷胶囊
 * @param {'windows'|'macos'} platform - 目标平台
 * @param {boolean} [updateDownloadTable=false] - 是否同步切换下方下载专区面板
 */
function updateHeroPlatformUI(platform, updateDownloadTable) {
  currentSelectedPlatform = platform;
  const tag = (latestReleaseData && latestReleaseData.tag)
    ? (latestReleaseData.tag.indexOf("v") === 0 ? latestReleaseData.tag : "v" + latestReleaseData.tag)
    : ("v" + CURRENT_VERSION);

  const heroBtn = document.getElementById("btn-hero-download");
  const heroBtnText = document.getElementById("hero-btn-text");

  let downloadUrl = "";
  let btnLabel = "";

  if (platform === "macos") {
    downloadUrl = (latestReleaseData && latestReleaseData.macArm64Url)
      ? latestReleaseData.macArm64Url
      : (GITHUB_RELEASES_URL + "/download/" + tag + "/AI-Helper-" + tag + "-macOS-aarch64.dmg");
    btnLabel = "立即下载 macOS 安装包 (" + tag + ")";
  } else {
    downloadUrl = (latestReleaseData && latestReleaseData.setupUrl)
      ? latestReleaseData.setupUrl
      : (GITHUB_RELEASES_URL + "/download/" + tag + "/AI-Helper-" + tag + "-Windows-x64-Setup.exe");
    btnLabel = "立即下载 Windows 安装包 (" + tag + ")";
  }

  if (heroBtn) {
    heroBtn.href = downloadUrl;
    heroBtn.setAttribute("data-current-os", platform);
  }
  if (heroBtnText) {
    heroBtnText.textContent = btnLabel;
  }

  // 同步高亮快捷架构选择胶囊
  document.querySelectorAll(".hero-pill-btn").forEach(function (pill) {
    const isTarget = pill.getAttribute("data-target-tab") === platform;
    pill.classList.toggle("active", isTarget);
    pill.setAttribute("aria-selected", String(isTarget));
  });

  // 更新校验和展示文件名
  const macArm64FileName = (latestReleaseData && latestReleaseData.macArm64FileName) || ("AI-Helper-" + tag + "-macOS-aarch64.dmg");
  const setupFileName = (latestReleaseData && latestReleaseData.setupFileName) || ("AI-Helper-" + tag + "-Windows-x64-Setup.exe");
  setText("checksum-setup-filename", platform === "macos" ? macArm64FileName : setupFileName);

  // 同步联动下方下载专区选项卡（静默切换面板，不引发任何页面滚动或跳转）
  if (updateDownloadTable && typeof window.switchDlTab === "function") {
    window.switchDlTab(platform);
  }
}

function applyReleaseData(data) {
  if (!data.tag) return;
  latestReleaseData = data;
  const tag = data.tag.indexOf("v") === 0 ? data.tag : "v" + data.tag;
  const setupFileName = data.setupFileName || "AI-Helper-" + tag + "-Windows-x64-Setup.exe";
  const zipFileName = "AI-Helper-" + tag + "-Windows-x64-Standalone.zip";
  const macArm64FileName = data.macArm64FileName || "AI-Helper-" + tag + "-macOS-aarch64.dmg";
  const macX64FileName = data.macX64FileName || "AI-Helper-" + tag + "-macOS-x64.dmg";

  const setupUrl = data.setupUrl || GITHUB_RELEASES_URL + "/download/" + tag + "/" + setupFileName;
  const zipUrl = data.zipUrl || GITHUB_RELEASES_URL + "/download/" + tag + "/" + zipFileName;
  const macArm64Url = data.macArm64Url || GITHUB_RELEASES_URL + "/download/" + tag + "/" + macArm64FileName;
  const macX64Url = data.macX64Url || GITHUB_RELEASES_URL + "/download/" + tag + "/" + macX64FileName;

  const fastSetupUrl = data.fastSetupUrl || GHFAST_PREFIX + setupUrl;
  const fastZipUrl = data.fastZipUrl || GHFAST_PREFIX + zipUrl;
  const fastMacArm64Url = data.fastMacArm64Url || GHFAST_PREFIX + macArm64Url;
  const fastMacX64Url = data.fastMacX64Url || GHFAST_PREFIX + macX64Url;

  activeReleasePageUrl = data.releasePageUrl || GITHUB_RELEASES_URL + "/tag/" + tag;

  document.querySelectorAll(".current-version-tag").forEach(function (element) { element.textContent = tag; });

  // Windows 下载链接
  setLink("link-dl-setup", setupUrl);
  setLink("link-dl-fast-setup", fastSetupUrl);
  setLink("link-dl-zip", zipUrl);
  setLink("link-dl-fast-zip", fastZipUrl);

  // macOS 下载链接
  setLink("link-dl-mac-arm64", macArm64Url);
  setLink("link-dl-mac-arm64-fast", fastMacArm64Url);
  setLink("link-dl-mac-x64", macX64Url);
  setLink("link-dl-mac-x64-fast", fastMacX64Url);

  // 根据检测到的用户平台同步更新 Hero 立即下载按钮及胶囊
  updateHeroPlatformUI(currentSelectedPlatform, false);
}

async function initReleaseInfo() {
  applyReleaseData({ tag: CURRENT_VERSION });

  if (window.location.protocol === "file:") return;

  // 依次尝试同源镜像站、本地静态文件、远程镜像与动态配置
  const versionEndpoints = [
    "/downloads/version.json",
    "./version.json",
    "./download-config.json",
    "https://helper.bob-api.com/downloads/version.json"
  ];

  for (const endpoint of versionEndpoints) {
    try {
      const response = await fetchWithTimeout(endpoint + "?t=" + Date.now(), { cache: "no-store" }, 3000);
      if (response.ok) {
        const data = await response.json();
        if (data && (data.tag || data.version)) {
          const directUrl = data.setupDownloadUrl || (data.channels && data.channels.direct && data.channels.direct.downloadUrl);
          const ossUrl = data.ossSetupDownloadUrl || (data.channels && data.channels.oss && data.channels.oss.downloadUrl);
          const mirrorUrl = data.fastSetupDownloadUrl || (data.channels && data.channels.mirror && data.channels.mirror.downloadUrl);

          // macOS 分流
          const macArm64Direct = data.macArm64DownloadUrl || (data.macosChannels && data.macosChannels.arm64 && data.macosChannels.arm64.direct);
          const macArm64Oss = data.ossMacArm64DownloadUrl || (data.macosChannels && data.macosChannels.arm64 && data.macosChannels.arm64.oss);
          const macArm64Mirror = data.fastMacArm64DownloadUrl || (data.macosChannels && data.macosChannels.arm64 && data.macosChannels.arm64.mirror);

          const macX64Direct = data.macX64DownloadUrl || (data.macosChannels && data.macosChannels.x64 && data.macosChannels.x64.direct);
          const macX64Mirror = data.fastMacX64DownloadUrl || (data.macosChannels && data.macosChannels.x64 && data.macosChannels.x64.mirror);

          applyReleaseData({
            tag: data.tag || "v" + data.version,
            setupUrl: directUrl,
            ossSetupDownloadUrl: ossUrl,
            zipUrl: data.zipDownloadUrl,
            fastSetupUrl: mirrorUrl,
            fastZipUrl: data.fastZipDownloadUrl,
            macArm64Url: macArm64Direct,
            ossMacArm64DownloadUrl: macArm64Oss,
            fastMacArm64Url: macArm64Mirror,
            macX64Url: macX64Direct,
            fastMacX64Url: macX64Mirror,
            releasePageUrl: data.releasePageUrl,
            setupFileName: data.setupFileName,
            macArm64FileName: data.macArm64FileName,
            macX64FileName: data.macX64FileName
          });
          return;
        }
      }
    } catch (_) {
      // 忽略单个源请求失败，继续尝试下一个源
    }
  }

  // 最终兜底：若全部分流文件不可用，尝试读取 GitHub Release 最新 Tag
  try {
    const ghRes = await fetchWithTimeout("https://api.github.com/repos/" + GITHUB_REPO + "/releases/latest", { cache: "no-store" }, 3000);
    if (ghRes.ok) {
      const ghData = await ghRes.json();
      if (ghData && ghData.tag_name) {
        applyReleaseData({ tag: ghData.tag_name });
      }
    }
  } catch (_) {}
}

/**
 * 访问后端接口获取下载地址（解耦设计：前端不写死外部链接，由服务端/配置文件下发）
 * @param {string} channel 通道标识，例如 'oss' | 'direct' | 'mirror'
 * @returns {Promise<string|null>} 真实的下载目标 URL
 */
async function fetchDownloadUrlFromBackend(channel) {
  // 1. 优先请求后端动态 API 接口 (/api/download?channel=xxx)
  const apiEndpoints = [
    "/api/download?channel=" + encodeURIComponent(channel),
    "/api/get-download-url?channel=" + encodeURIComponent(channel)
  ];

  for (const api of apiEndpoints) {
    try {
      const res = await fetchWithTimeout(api + "&t=" + Date.now(), { cache: "no-store" }, 3000);
      if (res.ok) {
        const json = await res.json();
        if (json && json.downloadUrl) {
          return json.downloadUrl;
        }
      }
    } catch (_) {}
  }

  // 2. 备用读取配置文件接口（download-config.json）
  const configEndpoints = [
    "/downloads/download-config.json",
    "./download-config.json"
  ];

  for (const endpoint of configEndpoints) {
    try {
      const res = await fetchWithTimeout(endpoint + "?t=" + Date.now(), { cache: "no-store" }, 3000);
      if (res.ok) {
        const data = await res.json();
        if (data && data.channels && data.channels[channel] && data.channels[channel].downloadUrl) {
          return data.channels[channel].downloadUrl;
        }
      }
    } catch (_) {}
  }

  // 3. 尝试从已获取的 releaseData 缓存读取
  if (latestReleaseData) {
    if (channel === "oss" && latestReleaseData.ossSetupDownloadUrl) {
      return latestReleaseData.ossSetupDownloadUrl;
    }
  }

  // 4. 兜底读取 version.json 配置文件
  const versionEndpoints = [
    "/downloads/version.json",
    "./version.json"
  ];

  for (const endpoint of versionEndpoints) {
    try {
      const res = await fetchWithTimeout(endpoint + "?t=" + Date.now(), { cache: "no-store" }, 3000);
      if (res.ok) {
        const data = await res.json();
        if (channel === "oss" && data.ossSetupDownloadUrl) {
          return data.ossSetupDownloadUrl;
        }
        if (channel === "direct" && data.setupDownloadUrl) {
          return data.setupDownloadUrl;
        }
      }
    } catch (_) {}
  }

  return null;
}

/**
 * 初始化动态下载按钮事件
 */
function initDynamicDownloadButtons() {
  const btnOss = document.getElementById("btn-dl-oss");
  if (!btnOss) return;

  btnOss.addEventListener("click", async function (e) {
    e.preventDefault();
    if (btnOss.dataset.loading === "true") return;

    btnOss.dataset.loading = "true";
    const textSpan = document.getElementById("btn-dl-oss-text") || btnOss;
    const originalText = textSpan.textContent;
    textSpan.textContent = "正在获取下载地址...";
    btnOss.style.opacity = "0.75";
    btnOss.style.pointerEvents = "none";
    showToast("正在连接后端接口获取 OSS 高速下载通道...");

    try {
      const downloadUrl = await fetchDownloadUrlFromBackend("oss");
      if (!downloadUrl) {
        throw new Error("后端接口或配置未返回有效的下载地址");
      }

      showToast("已成功获取 OSS 下载地址，正在拉起下载...");

      // 前端拉起文件下载
      const trigger = document.createElement("a");
      trigger.href = downloadUrl;
      trigger.download = "";
      trigger.target = "_blank";
      trigger.rel = "noopener noreferrer";
      document.body.appendChild(trigger);
      trigger.click();
      document.body.removeChild(trigger);
    } catch (err) {
      console.error("[Download] 获取下载链接异常:", err);
      showToast("获取下载链接失败，请稍后重试或使用备用通道");
    } finally {
      btnOss.dataset.loading = "false";
      textSpan.textContent = originalText;
      btnOss.style.opacity = "";
      btnOss.style.pointerEvents = "";
    }
  });
}


async function fetchWithTimeout(url, options, timeout) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(function () { controller.abort(); }, timeout);
  try {
    const response = await fetch(url, Object.assign({}, options, { signal: controller.signal }));
    window.clearTimeout(timeoutId);
    return response;
  } catch (error) {
    window.clearTimeout(timeoutId);
    throw error;
  }
}

function copyToClipboard(text, message) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(function () {
      showToast(message || "已复制");
    }).catch(function () {
      fallbackCopy(text, message);
    });
  } else {
    fallbackCopy(text, message);
  }
}

function fallbackCopy(text, message) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand("copy");
    showToast(message || "已复制");
  } catch (_) {
    showToast("复制失败，请手动复制");
  }
  document.body.removeChild(textarea);
}

function showToast(message) {
  const toast = document.getElementById("toast-notification");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(function () { toast.classList.remove("show"); }, 2600);
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function setLink(id, href) {
  const element = document.getElementById(id);
  if (element && href) element.href = href;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function pad(value) {
  return String(value).padStart(2, "0");
}

/* React-Bits: DecryptedText 字符解密引擎 */
function runDecryptedText(element, targetText) {
  if (!element) return;
  const finalText = targetText || element.getAttribute("data-text") || element.textContent;
  if (!finalText) return;
  
  if (element._decryptTimer) {
    clearInterval(element._decryptTimer);
    element._decryptTimer = null;
  }

  const chars = "!@#$%^&*()_+-=<>?/~[]{}ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const length = finalText.length;
  let currentStep = 0;
  const totalSteps = Math.max(10, Math.min(22, Math.floor(length * 0.8)));

  element._decryptTimer = setInterval(function () {
    currentStep++;
    const progress = currentStep / totalSteps;
    const revealedLength = Math.floor(progress * length);
    let scrambled = "";

    for (let i = 0; i < length; i++) {
      if (i < revealedLength) {
        scrambled += finalText[i];
      } else {
        scrambled += chars[Math.floor(Math.random() * chars.length)];
      }
    }

    element.textContent = scrambled;

    if (currentStep >= totalSteps) {
      clearInterval(element._decryptTimer);
      element._decryptTimer = null;
      element.textContent = finalText;
    }
  }, 32);
}

/* 通道分组智能遥测监控引擎 (React-Bits + GSAP) */
function initGroupMonitorSection() {
  const card = document.getElementById("card-group-monitor");
  if (!card) return;

  const tabs = Array.from(document.querySelectorAll(".group-tab-btn"));
  const modeButtons = Array.from(document.querySelectorAll(".view-mode-toggle .mode-btn"));
  const refreshButton = document.getElementById("btn-group-refresh");

  let activeKey = "chatgpt";
  let activeMode = "ribbon";

  function renderGroupData(key, animateBars) {
    const data = GROUP_MONITOR_DATA[key];
    if (!data) return;

    activeKey = key;

    // 1. 基础元数据
    setText("widget-group-name", data.groupName);
    setText("widget-group-tag", data.tag);

    // 2. 字符解密 (React-Bits DecryptedText)
    const statusPill = document.getElementById("widget-live-status");
    if (statusPill) runDecryptedText(statusPill, data.statusText);

    const guideDesc = document.getElementById("widget-guide-desc");
    if (guideDesc) runDecryptedText(guideDesc, data.guide);

    // 3. GSAP 数值平滑滚轮动画
    if (window.gsap && !REDUCED_MOTION.matches) {
      const gsap = window.gsap;

      // 成功率数值
      const rateEl = document.getElementById("hud-metric-rate");
      if (rateEl) {
        const curRate = parseFloat(rateEl.textContent) || 90;
        const targetRate = data.successRate;
        const rateObj = { val: curRate };
        gsap.to(rateObj, {
          val: targetRate,
          duration: 0.75,
          ease: "power2.out",
          onUpdate: function () {
            rateEl.textContent = rateObj.val.toFixed(1) + "%";
          }
        });
      }

      // TTFT 延迟数值
      const latEl = document.getElementById("hud-metric-latency");
      if (latEl) {
        const curLat = parseInt(latEl.textContent, 10) || 50;
        const targetLat = data.latencyVal;
        const latObj = { val: curLat };
        gsap.to(latObj, {
          val: targetLat,
          duration: 0.75,
          ease: "power2.out",
          onUpdate: function () {
            latEl.textContent = Math.round(latObj.val) + "ms";
          }
        });
      }
    } else {
      setText("hud-metric-rate", data.successRate.toFixed(1) + "%");
      setText("hud-metric-latency", data.latency);
    }

    setText("hud-metric-requests", data.totalRequests);
    setText("hud-metric-failed", data.failed);

    // 4. 渲染三大图表视图
    renderRibbonView(data.ribbonPoints, animateBars);
    renderAreaView(data.ribbonPoints);
    renderBarView(data.ribbonPoints, animateBars);
  }

  function renderRibbonView(points, animate) {
    const track = document.getElementById("ribbon-track");
    if (!track) return;
    track.textContent = "";

    points.forEach(function (pt, idx) {
      const seg = document.createElement("div");
      seg.className = "ribbon-segment" + (pt.rate < 99.5 ? " rate-jitter" : pt.rate < 100 ? " rate-99" : "");
      seg.title = "时间桶 #" + (idx + 1) + " (5分钟) · 可用率: " + pt.rate + "% · 平均时延: " + pt.lat + "ms";
      track.appendChild(seg);
    });

    if (animate && window.gsap && !REDUCED_MOTION.matches) {
      window.gsap.fromTo(
        track.children,
        { scaleY: 0, opacity: 0.2 },
        { scaleY: 1, opacity: 1, duration: 0.4, stagger: 0.012, ease: "power2.out" }
      );
    }
  }

  function renderAreaView(points) {
    const fillPath = document.getElementById("area-fill-path");
    const strokePath = document.getElementById("area-stroke-path");
    if (!fillPath || !strokePath) return;

    const width = 600;
    const height = 70;
    const step = width / (points.length - 1);

    const minLat = 50;
    const maxLat = 160;
    const coords = points.map(function (pt, i) {
      const norm = (pt.lat - minLat) / (maxLat - minLat);
      const y = Math.max(12, Math.min(58, height - (norm * (height - 24) + 12)));
      return { x: i * step, y: y };
    });

    let d = "M " + coords[0].x.toFixed(1) + " " + coords[0].y.toFixed(1);
    for (let i = 1; i < coords.length; i++) {
      const prev = coords[i - 1];
      const curr = coords[i];
      const cx = ((prev.x + curr.x) / 2).toFixed(1);
      d += " C " + cx + " " + prev.y.toFixed(1) + ", " + cx + " " + curr.y.toFixed(1) + ", " + curr.x.toFixed(1) + " " + curr.y.toFixed(1);
    }

    strokePath.setAttribute("d", d);
    const fillD = d + " L " + width + " " + height + " L 0 " + height + " Z";
    fillPath.setAttribute("d", fillD);

    if (window.gsap && !REDUCED_MOTION.matches) {
      window.gsap.fromTo(
        strokePath,
        { strokeDasharray: 700, strokeDashoffset: 700 },
        { strokeDashoffset: 0, duration: 0.85, ease: "power2.out" }
      );
    }
  }

  function renderBarView(points, animate) {
    const track = document.getElementById("bar-track");
    if (!track) return;
    track.textContent = "";

    points.forEach(function (pt, idx) {
      const bar = document.createElement("div");
      bar.className = "bar-column";
      const hPercent = Math.min(95, Math.max(28, Math.round((pt.lat / 150) * 85 + 10)));
      bar.style.height = hPercent + "%";
      bar.title = "时间桶 #" + (idx + 1) + " · 时延: " + pt.lat + "ms";
      track.appendChild(bar);
    });

    if (animate && window.gsap && !REDUCED_MOTION.matches) {
      window.gsap.fromTo(
        track.children,
        { scaleY: 0 },
        { scaleY: 1, duration: 0.45, stagger: 0.012, ease: "power2.out", transformOrigin: "bottom" }
      );
    }
  }

  // 1. Tab 切换
  tabs.forEach(function (button) {
    button.addEventListener("click", function () {
      const key = button.getAttribute("data-group-key");
      if (!key || key === activeKey) return;

      tabs.forEach(function (t) {
        t.classList.remove("active");
        t.setAttribute("aria-selected", "false");
      });
      button.classList.add("active");
      button.setAttribute("aria-selected", "true");

      renderGroupData(key, true);
    });
  });

  // 2. 视图模式切换 (Ribbon / Area / Bar)
  modeButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      const mode = btn.getAttribute("data-mode");
      if (!mode || mode === activeMode) return;

      modeButtons.forEach(function (b) { b.classList.remove("active"); });
      btn.classList.add("active");
      activeMode = mode;

      const views = [
        { name: "ribbon", el: document.getElementById("chart-view-ribbon") },
        { name: "area", el: document.getElementById("chart-view-area") },
        { name: "bar", el: document.getElementById("chart-view-bar") }
      ];

      views.forEach(function (v) {
        if (!v.el) return;
        if (v.name === mode) {
          v.el.classList.add("active");
          if (window.gsap && !REDUCED_MOTION.matches) {
            window.gsap.fromTo(v.el, { opacity: 0, y: 4 }, { opacity: 1, y: 0, duration: 0.32, ease: "power2.out" });
          }
        } else {
          v.el.classList.remove("active");
        }
      });
    });
  });

  // 3. 刷新按钮 GSAP 旋转与动效
  if (refreshButton) {
    refreshButton.addEventListener("click", function () {
      if (window.gsap && !REDUCED_MOTION.matches) {
        window.gsap.to(refreshButton, {
          rotation: "+=360",
          duration: 0.6,
          ease: "power2.inOut"
        });
      }
      renderGroupData(activeKey, true);
      showToast("已刷新通道分组稳定性遥测数据");
    });
  }

  // 初次渲染
  renderGroupData("chatgpt", false);

  // GSAP ScrollTrigger 滚动进入视野动效
  if (window.gsap && window.ScrollTrigger && !REDUCED_MOTION.matches) {
    window.ScrollTrigger.create({
      trigger: card,
      start: "top 78%",
      once: true,
      onEnter: function () {
        renderGroupData(activeKey, true);
      }
    });
  }
}

/* ==========================================================================
   1. 首页视差滚动引擎 (Parallax Motion Engine)
   ========================================================================== */
function initParallaxMotion() {
  if (!window.gsap || !window.ScrollTrigger || REDUCED_MOTION.matches) return;
  const gsap = window.gsap;
  gsap.registerPlugin(window.ScrollTrigger);

  // 1.1 背景光斑与网格多层视差流动
  gsap.to(".ambient-orb-cyan", {
    y: 200,
    ease: "none",
    scrollTrigger: {
      trigger: "#home",
      start: "top top",
      end: "bottom top",
      scrub: 1
    }
  });

  gsap.to(".ambient-orb-violet", {
    y: -240,
    ease: "none",
    scrollTrigger: {
      trigger: "#home",
      start: "top top",
      end: "bottom top",
      scrub: 1
    }
  });

  gsap.to(".ambient-grid", {
    y: 100,
    ease: "none",
    scrollTrigger: {
      trigger: "#home",
      start: "top top",
      end: "bottom top",
      scrub: 1
    }
  });

  // 1.2 首页 3D 浮动徽章滚动视差 (不同层级差速运动)
  const parallaxBadges = document.querySelectorAll(".parallax-badge");
  parallaxBadges.forEach(function (badge) {
    const speed = parseFloat(badge.getAttribute("data-parallax-speed")) || 0.35;
    gsap.to(badge, {
      y: -150 * speed,
      rotate: speed > 0 ? 3.5 : -3.5,
      ease: "none",
      scrollTrigger: {
        trigger: "#home",
        start: "top top",
        end: "bottom top",
        scrub: 0.8
      }
    });
  });

  // 1.3 鼠标指针空间 3D 视差微动 (Fine Pointer)
  if (FINE_POINTER.matches) {
    const heroSection = document.getElementById("home");
    const brandMark = document.querySelector(".hero-brand-mark");
    if (heroSection) {
      heroSection.addEventListener("pointermove", function (e) {
        const rect = heroSection.getBoundingClientRect();
        const xNorm = (e.clientX - rect.left) / rect.width - 0.5;
        const yNorm = (e.clientY - rect.top) / rect.height - 0.5;

        if (brandMark) {
          gsap.to(brandMark, {
            x: xNorm * 32,
            y: yNorm * 32,
            rotateY: xNorm * 20,
            rotateX: -yNorm * 20,
            duration: 0.5,
            ease: "power2.out"
          });
        }

        parallaxBadges.forEach(function (badge) {
          const depth = parseFloat(badge.getAttribute("data-depth")) || 26;
          gsap.to(badge, {
            x: xNorm * depth,
            y: yNorm * depth,
            duration: 0.6,
            ease: "power2.out"
          });
        });
      });

      heroSection.addEventListener("pointerleave", function () {
        if (brandMark) {
          gsap.to(brandMark, {
            x: 0,
            y: 0,
            rotateX: 0,
            rotateY: 0,
            duration: 1.1,
            ease: "elastic.out(1, 0.45)"
          });
        }
        parallaxBadges.forEach(function (badge) {
          gsap.to(badge, {
            x: 0,
            y: 0,
            duration: 0.95,
            ease: "elastic.out(1, 0.45)"
          });
        });
      });
    }
  }
}

/* ==========================================================================
   2. 横向滚动全景画卷 (Horizontal Architecture Panoramic Gallery Engine)
   ========================================================================== */
function initHorizontalScroll() {
  if (!window.gsap || !window.ScrollTrigger || REDUCED_MOTION.matches) return;
  const section = document.querySelector(".horizontal-showcase");
  const viewport = document.querySelector(".horizontal-viewport");
  const track = document.getElementById("horizontal-track");
  const progressFill = document.getElementById("horizontal-progress-fill");
  const counterText = document.getElementById("showcase-card-counter");
  const btnPrev = document.getElementById("btn-showcase-prev");
  const btnNext = document.getElementById("btn-showcase-next");
  if (!section || !viewport || !track) return;

  const cards = Array.from(track.querySelectorAll(".panoramic-card"));
  const totalCards = cards.length;
  const gsap = window.gsap;
  gsap.registerPlugin(window.ScrollTrigger);

  window.ScrollTrigger.matchMedia({
    // 桌面宽屏：GSAP Pin 锁定并横向视差漫游
    "(min-width: 961px)": function () {
      const getScrollDistance = function () {
        return Math.max(0, track.scrollWidth - window.innerWidth);
      };

      const horizontalTween = gsap.to(track, {
        x: function () {
          return -getScrollDistance();
        },
        ease: "none",
        scrollTrigger: {
          trigger: section,
          pin: true,
          pinSpacing: true,
          scrub: 0.6,
          start: "top top",
          end: function () {
            return "+=" + Math.round(getScrollDistance() + 450);
          },
          invalidateOnRefresh: true,
          onUpdate: function (self) {
            if (progressFill) {
              const pct = Math.min(100, Math.max(12, Math.round(self.progress * 100)));
              progressFill.style.width = pct + "%";
            }
            if (counterText && totalCards > 0) {
              const idx = Math.min(totalCards - 1, Math.floor(self.progress * totalCards));
              counterText.textContent = (idx + 1).toString().padStart(2, "0") + " / " + totalCards.toString().padStart(2, "0");
            }
          }
        }
      });

      // 按钮联动：点击直接平滑滚动到相应进度的卡片
      if (btnPrev) {
        btnPrev.onclick = function () {
          const st = horizontalTween.scrollTrigger;
          if (st) {
            const step = 1 / (totalCards - 1);
            const targetP = Math.max(0, st.progress - step);
            window.scrollTo({
              top: st.start + (st.end - st.start) * targetP,
              behavior: "smooth"
            });
          }
        };
      }

      if (btnNext) {
        btnNext.onclick = function () {
          const st = horizontalTween.scrollTrigger;
          if (st) {
            const step = 1 / (totalCards - 1);
            const targetP = Math.min(1, st.progress + step);
            window.scrollTo({
              top: st.start + (st.end - st.start) * targetP,
              behavior: "smooth"
            });
          }
        };
      }
    },

    // 移动端：保持丝滑原生触控横滑，联动进度条
    "(max-width: 960px)": function () {
      track.style.transform = "none";
      viewport.style.overflowX = "auto";

      function updateMobileProgress() {
        const maxScroll = Math.max(1, viewport.scrollWidth - viewport.clientWidth);
        const scrollLeft = viewport.scrollLeft;
        const ratio = Math.min(1, Math.max(0, scrollLeft / maxScroll));

        if (progressFill) {
          progressFill.style.width = Math.min(100, Math.max(12, Math.round(ratio * 100))) + "%";
        }
        if (counterText && totalCards > 0) {
          const idx = Math.min(totalCards - 1, Math.floor(ratio * totalCards));
          counterText.textContent = (idx + 1).toString().padStart(2, "0") + " / " + totalCards.toString().padStart(2, "0");
        }
      }

      viewport.addEventListener("scroll", updateMobileProgress, { passive: true });
      updateMobileProgress();

      if (btnPrev) {
        btnPrev.onclick = function () {
          viewport.scrollBy({ left: -(cards[0]?.offsetWidth || 340), behavior: "smooth" });
        };
      }
      if (btnNext) {
        btnNext.onclick = function () {
          viewport.scrollBy({ left: (cards[0]?.offsetWidth || 340), behavior: "smooth" });
        };
      }
    }
  });
}

/* ==========================================================================
   3. React-Bits 动画组件集 (BlurText, TiltedCard, DecryptedText Hover)
   ========================================================================== */
function initReactBitsComponents() {
  // 3.1 React-Bits: BlurText 文本模糊飞入动画
  if (window.gsap && window.ScrollTrigger && !REDUCED_MOTION.matches) {
    const gsap = window.gsap;
    document.querySelectorAll(".react-bits-blur-text").forEach(function (heading) {
      gsap.from(heading, {
        scrollTrigger: {
          trigger: heading,
          start: "top 88%",
          once: true
        },
        opacity: 0,
        y: 20,
        filter: "blur(12px)",
        duration: 0.75,
        ease: "power2.out",
        clearProps: "filter,transform"
      });
    });
  }

  // 3.2 React-Bits: TiltedCard 3D 空间倾斜与光泽响应 (带 rAF 高性能平滑微动)
  if (FINE_POINTER.matches && !REDUCED_MOTION.matches && window.gsap) {
    const tiltedCards = document.querySelectorAll(".panoramic-card, .capability-card-macos");
    tiltedCards.forEach(function (card) {
      let rafId = 0;
      card.addEventListener("pointermove", function (e) {
        if (rafId) return;
        rafId = requestAnimationFrame(function () {
          rafId = 0;
          const rect = card.getBoundingClientRect();
          const x = e.clientX - rect.left - rect.width / 2;
          const y = e.clientY - rect.top - rect.height / 2;

          const rotateX = (-y / (rect.height / 2)) * 3.5;
          const rotateY = (x / (rect.width / 2)) * 3.5;

          window.gsap.to(card, {
            rotateX: rotateX,
            rotateY: rotateY,
            transformPerspective: 1000,
            scale: 1.01,
            duration: 0.35,
            ease: "power2.out",
            overwrite: "auto"
          });
        });
      });

      card.addEventListener("pointerleave", function () {
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = 0;
        }
        window.gsap.to(card, {
          rotateX: 0,
          rotateY: 0,
          scale: 1,
          duration: 0.6,
          ease: "power2.out",
          overwrite: "auto"
        });
      });
    });
  }

  // 3.3 鼠标悬浮触发 DecryptedText 字符解密动效
  document.querySelectorAll(".decrypted-text").forEach(function (el) {
    el.addEventListener("mouseenter", function () {
      runDecryptedText(el);
    });
  });
}

/* ==========================================================================
   4. 跨平台专属交互引擎 (Cross-Platform Hub & Simulator Mode Toggle)
   ========================================================================== */
function initCrossPlatformFeatures() {
  const isMac = detectUserOS() === "macos";

  // 4.1 下载专区平台切换选项卡 (Windows / macOS / All)
  const dlTabs = document.querySelectorAll(".dl-tab-btn");
  const dlPanels = {
    windows: document.getElementById("view-win-downloads"),
    macos: document.getElementById("view-mac-downloads"),
    all: document.getElementById("view-all-downloads")
  };

  function switchDlTab(targetKey) {
    dlTabs.forEach(function (btn) {
      const active = btn.getAttribute("data-tab-target") === targetKey;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", String(active));
    });

    Object.keys(dlPanels).forEach(function (key) {
      const panel = dlPanels[key];
      if (panel) {
        if (key === targetKey) {
          panel.classList.add("active");
          if (window.gsap && !REDUCED_MOTION.matches) {
            window.gsap.fromTo(panel, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.35, ease: "power2.out" });
          }
        } else {
          panel.classList.remove("active");
        }
      }
    });

    if (window.ScrollTrigger) {
      setTimeout(function () {
        window.ScrollTrigger.refresh();
      }, 100);
    }
  }

  dlTabs.forEach(function (btn) {
    btn.addEventListener("click", function () {
      const target = btn.getAttribute("data-tab-target");
      if (target) switchDlTab(target);
    });
  });

  window.switchDlTab = switchDlTab;

  // 首页平台快捷下载胶囊事件（切换目标架构与安装包，彻底阻止页面向下滚动）
  document.querySelectorAll(".hero-pill-btn").forEach(function (pill) {
    pill.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      const target = pill.getAttribute("data-target-tab");
      if (target) {
        updateHeroPlatformUI(target, true);
      }
    });
  });

  // 页面初次加载时：根据检索到的用户系统自动激活对应的胶囊和下载面板
  const userOS = detectUserOS();
  updateHeroPlatformUI(userOS, true);

  // 4.2 演示模拟器视界模式切换 (macOS 红绿灯 / Windows 双模)
  const simOsButtons = document.querySelectorAll(".win-os-btn");
  const productFrame = document.getElementById("product-frame");
  const windowControls = document.getElementById("window-controls");
  const windowTitle = document.getElementById("window-title-text");

  simOsButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      const osMode = btn.getAttribute("data-sim-os");
      simOsButtons.forEach(function (b) { b.classList.toggle("active", b === btn); });

      if (osMode === "macos") {
        if (productFrame) productFrame.classList.add("macos-mode");
        if (windowControls) windowControls.style.display = "none";
        if (windowTitle) windowTitle.textContent = "AI Helper · macOS Sonoma (Apple Silicon)";

        const s1 = document.getElementById("strip-item-1-desc");
        const s2 = document.getElementById("strip-item-2-desc");
        const s3 = document.getElementById("strip-item-3-desc");
        const s4 = document.getElementById("strip-item-4-desc");
        if (s1) s1.textContent = "~/.codex/config.toml (Native)";
        if (s2) s2.textContent = "/usr/local/bin/claude (Homebrew)";
        if (s3) s3.textContent = "~/.workbuddy/models.json";
        if (s4) s4.textContent = "Bridge :8787 (AppleScript Terminal)";

        showToast("已切换至 macOS 原生红绿灯 Overlay 视界");
      } else {
        if (productFrame) productFrame.classList.remove("macos-mode");
        if (windowControls) windowControls.style.display = "";
        if (windowTitle) windowTitle.textContent = "AI Helper Studio";

        const s1 = document.getElementById("strip-item-1-desc");
        const s2 = document.getElementById("strip-item-2-desc");
        const s3 = document.getElementById("strip-item-3-desc");
        const s4 = document.getElementById("strip-item-4-desc");
        if (s1) s1.textContent = "Win32 · 已发现";
        if (s2) s2.textContent = "NPM · 已发现";
        if (s3) s3.textContent = "Native · 已发现";
        if (s4) s4.textContent = "Bridge · 已发现";

        showToast("已切换至 Windows 视界");
      }
    });
  });

  // 4.3 macOS 终端解除隔离命令一键复制
  const btnCopyMacCmd = document.getElementById("btn-copy-mac-cmd");
  if (btnCopyMacCmd) {
    btnCopyMacCmd.addEventListener("click", function () {
      copyToClipboard("xattr -cr /Applications/AI\\ Helper.app", "macOS 终端解锁命令已复制到剪贴板");
    });
  }

  // 4.4 macOS 阿里云 OSS 高速镜像拉起
  const btnMacOss = document.getElementById("btn-dl-mac-arm64-oss");
  if (btnMacOss) {
    btnMacOss.addEventListener("click", async function (e) {
      e.preventDefault();
      const textSpan = document.getElementById("btn-dl-mac-arm64-oss-text") || btnMacOss;
      const origText = textSpan.textContent;
      textSpan.textContent = "正在获取 OSS 地址...";
      showToast("正在获取阿里云 OSS macOS 安装包高速通道...");

      try {
        let downloadUrl = "https://bobdong.oss-cn-beijing.aliyuncs.com/desktop/AI-Helper-" + CURRENT_VERSION + "-macOS-aarch64.dmg";
        if (latestReleaseData && latestReleaseData.ossMacArm64DownloadUrl) {
          downloadUrl = latestReleaseData.ossMacArm64DownloadUrl;
        }

        const trigger = document.createElement("a");
        trigger.href = downloadUrl;
        trigger.download = "";
        trigger.target = "_blank";
        trigger.rel = "noopener noreferrer";
        document.body.appendChild(trigger);
        trigger.click();
        document.body.removeChild(trigger);
        showToast("已成功拉起 macOS Apple Silicon DMG 下载");
      } catch (err) {
        showToast("拉起下载失败，请使用备用镜像");
      } finally {
        textSpan.textContent = origText;
      }
    });
  }
}


/* ============================================
   ACCESSIBILITY ENHANCEMENTS
   ============================================ */

// Keyboard navigation detection
document.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    document.body.classList.add('keyboard-nav');
  }
});

document.addEventListener('mousedown', () => {
  document.body.classList.remove('keyboard-nav');
});

// Skip to main content enhancement
const skipLink = document.querySelector('.skip-link');
if (skipLink) {
  skipLink.addEventListener('click', (e) => {
    e.preventDefault();
    const target = document.querySelector(skipLink.getAttribute('href'));
    if (target) {
      target.setAttribute('tabindex', '-1');
      target.focus();
      target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
      
      // Smooth scroll if not reduced motion
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        target.scrollIntoView({ block: 'start' });
      }
    }
  });
}

// Announce page section changes for screen readers
const announceSectionChange = (sectionName) => {
  const announcement = document.createElement('div');
  announcement.setAttribute('role', 'status');
  announcement.setAttribute('aria-live', 'polite');
  announcement.className = 'sr-only';
  announcement.textContent = `已进入${sectionName}部分`;
  document.body.appendChild(announcement);
  setTimeout(() => announcement.remove(), 1000);
};

// Enhanced focus management for modals and dialogs
const trapFocus = (element) => {
  const focusableElements = element.querySelectorAll(
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  const firstFocusable = focusableElements[0];
  const lastFocusable = focusableElements[focusableElements.length - 1];
  
  element.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      if (e.shiftKey && document.activeElement === firstFocusable) {
        e.preventDefault();
        lastFocusable.focus();
      } else if (!e.shiftKey && document.activeElement === lastFocusable) {
        e.preventDefault();
        firstFocusable.focus();
      }
    }
    
    if (e.key === 'Escape') {
      element.dispatchEvent(new CustomEvent('modal:close'));
    }
  });
};

// Improve button click feedback with haptic on supported devices
const enhanceButtonFeedback = () => {
  const buttons = document.querySelectorAll('button, .button, .nav-github, .nav-download');
  buttons.forEach(button => {
    button.addEventListener('click', () => {
      // Haptic feedback for mobile
      if ('vibrate' in navigator) {
        navigator.vibrate(10);
      }
    });
  });
};

// Initialize accessibility enhancements
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', enhanceButtonFeedback);
} else {
  enhanceButtonFeedback();
}

/* ============================================
   PERFORMANCE OPTIMIZATIONS
   ============================================ */

// Lazy load images when they enter viewport
const lazyLoadImages = () => {
  const images = document.querySelectorAll('img[data-src]');
  const imageObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target;
        img.src = img.dataset.src;
        img.removeAttribute('data-src');
        observer.unobserve(img);
      }
    });
  }, {
    rootMargin: '50px 0px',
    threshold: 0.01
  });
  
  images.forEach(img => imageObserver.observe(img));
};

// Preload critical resources on hover (for mouse users)
if (window.matchMedia('(hover: hover)').matches) {
  const preloadOnHover = (selector, resourceUrl, type = 'fetch') => {
    document.querySelectorAll(selector).forEach(element => {
      element.addEventListener('mouseenter', () => {
        const link = document.createElement('link');
        link.rel = 'prefetch';
        link.href = resourceUrl;
        link.as = type;
        document.head.appendChild(link);
      }, { once: true });
    });
  };
  
  // Example: Preload download page resources when hovering download button
  preloadOnHover('.nav-download, #btn-hero-download', '/downloads', 'document');
}

// Reduce animation complexity on low-end devices
const optimizeForLowEndDevices = () => {
  // Detect low-end device (simple heuristic)
  const isLowEnd = navigator.hardwareConcurrency <= 2 || 
                   navigator.deviceMemory <= 2 ||
                   /Android 4|Android 5/.test(navigator.userAgent);
  
  if (isLowEnd) {
    document.documentElement.classList.add('reduced-animations');
  }
};

optimizeForLowEndDevices();

/* ============================================
   PROGRESSIVE ENHANCEMENT
   ============================================ */

// Enhance form validation
const enhanceFormValidation = () => {
  const forms = document.querySelectorAll('form');
  forms.forEach(form => {
    const inputs = form.querySelectorAll('input, textarea');
    inputs.forEach(input => {
      input.addEventListener('invalid', (e) => {
        e.preventDefault();
        input.setAttribute('aria-invalid', 'true');
        
        // Add visual error indicator
        input.classList.add('error');
        
        // Announce error to screen reader
        const errorMsg = input.validationMessage;
        const errorAnnouncement = document.createElement('span');
        errorAnnouncement.className = 'error-message';
        errorAnnouncement.setAttribute('role', 'alert');
        errorAnnouncement.textContent = errorMsg;
        errorAnnouncement.id = `${input.id}-error`;
        input.setAttribute('aria-describedby', errorAnnouncement.id);
        
        if (!input.nextElementSibling?.classList.contains('error-message')) {
          input.parentNode.insertBefore(errorAnnouncement, input.nextSibling);
        }
      });
      
      input.addEventListener('input', () => {
        if (input.validity.valid) {
          input.removeAttribute('aria-invalid');
          input.classList.remove('error');
          const errorMsg = input.nextElementSibling;
          if (errorMsg?.classList.contains('error-message')) {
            errorMsg.remove();
          }
        }
      });
    });
  });
};

enhanceFormValidation();

console.log('✓ Accessibility and performance enhancements loaded');
