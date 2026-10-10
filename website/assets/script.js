"use strict";

const CURRENT_VERSION = "v1.0.55";
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
    desc: "写入 ~/.workbuddy-ai/models.json，并同步进程内环境变量。",
    configPath: "~/.workbuddy-ai/models.json",
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

  function updateScrollState() {
    ticking = false;
    nav.classList.toggle("scrolled", window.scrollY > 24);
    if (story && faq && floating) {
      const showAfter = story.offsetTop + Math.min(story.offsetHeight * 0.75, window.innerHeight * 3);
      const hideAfter = faq.offsetTop - window.innerHeight * 0.35;
      floating.classList.toggle("visible", window.scrollY > showAfter && window.scrollY < hideAfter);
    }
  }

  window.addEventListener("scroll", function () {
    if (!ticking) {
      ticking = true;
      window.requestAnimationFrame(updateScrollState);
    }
  }, { passive: true });
  updateScrollState();

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

  const observedSections = Array.from(document.querySelectorAll("[data-nav-section]")).map(function (link) {
    return document.getElementById(link.getAttribute("data-nav-section"));
  }).filter(Boolean);

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(function (entries) {
      const visible = entries.filter(function (entry) { return entry.isIntersecting; })
        .sort(function (a, b) { return b.intersectionRatio - a.intersectionRatio; })[0];
      if (!visible) return;
      document.querySelectorAll("[data-nav-section]").forEach(function (link) {
        link.classList.toggle("active", link.getAttribute("data-nav-section") === visible.target.id);
      });
    }, { rootMargin: "-28% 0px -58% 0px", threshold: [0.01, 0.2, 0.5] });
    observedSections.forEach(function (section) { observer.observe(section); });
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
    .from(".hero-actions > *", { opacity: 0, y: 18, duration: 0.62, stagger: 0.08 }, "-=0.42")
    .from(".hero-trust li", { opacity: 0, y: 12, duration: 0.45, stagger: 0.07 }, "-=0.36")
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
    start: "top top",
    end: "bottom bottom",
    scrub: 0.55,
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

  const story = document.getElementById("story");
  if (!story) return;
  const start = story.offsetTop;
  const scrollDistance = Math.max(0, story.offsetHeight - window.innerHeight);
  const target = start + scrollDistance * (sceneIndex / (SCENES.length - 1));
  window.scrollTo({ top: target, behavior: "smooth" });
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

  const checksumButton = document.getElementById("btn-copy-checksum");
  if (checksumButton) checksumButton.addEventListener("click", function () {
    copyToClipboard(activeReleasePageUrl, "官方发布页链接已复制");
  });

  ["open-config-demo", "native-open-demo"].forEach(function (id) {
    const button = document.getElementById(id);
    if (button) button.addEventListener("click", function () {
      showToast("演示：已通过默认编辑器打开配置文件");
    });
  });
}

let latestReleaseData = null;

function applyReleaseData(data) {
  if (!data.tag) return;
  latestReleaseData = data;
  const tag = data.tag.indexOf("v") === 0 ? data.tag : "v" + data.tag;
  const setupFileName = data.setupFileName || "AI-Helper-" + tag + "-Windows-x64-Setup.exe";
  const zipFileName = "AI-Helper-" + tag + "-Windows-x64-Standalone.zip";
  const setupUrl = data.setupUrl || GITHUB_RELEASES_URL + "/download/" + tag + "/" + setupFileName;
  const zipUrl = data.zipUrl || GITHUB_RELEASES_URL + "/download/" + tag + "/" + zipFileName;
  const fastSetupUrl = data.fastSetupUrl || GHFAST_PREFIX + setupUrl;
  const fastZipUrl = data.fastZipUrl || GHFAST_PREFIX + zipUrl;
  activeReleasePageUrl = data.releasePageUrl || GITHUB_RELEASES_URL + "/tag/" + tag;

  document.querySelectorAll(".current-version-tag").forEach(function (element) { element.textContent = tag; });
  setLink("btn-hero-download", setupUrl);
  setText("hero-btn-text", "立即下载 Windows 安装版 (" + tag + ")");
  setLink("link-dl-setup", setupUrl);
  setLink("link-dl-fast-setup", fastSetupUrl);
  setLink("link-dl-zip", zipUrl);
  setLink("link-dl-fast-zip", fastZipUrl);
  setText("checksum-setup-filename", setupFileName);
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

          applyReleaseData({
            tag: data.tag || "v" + data.version,
            setupUrl: directUrl,
            ossSetupDownloadUrl: ossUrl,
            zipUrl: data.zipDownloadUrl,
            fastSetupUrl: mirrorUrl,
            fastZipUrl: data.fastZipDownloadUrl,
            releasePageUrl: data.releasePageUrl,
            setupFileName: data.setupFileName
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
