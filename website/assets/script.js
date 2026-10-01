/**
 * AI Helper - Cinematic Motion & Video-Like Product Showcase
 * Integrated: Anime.js (v3.2.2) + GSAP (v3.12.5) + React-Bits
 */

const CURRENT_VERSION = "v1.0.39";
const GITHUB_REPO = "TF49/AI-Helper";
const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases`;
const GHFAST_PREFIX = "https://ghfast.top/";

// Data models for the interactive app simulator
const SIMULATOR_DATA = {
  chatgpt: {
    title: "🟢 ChatGPT & Codex CLI 配置中心",
    desc: "原子写入 ~/.codex/config.toml，全面接管微软商店 Store 隔离包与 Win32 原生版",
    configPath: "~/.codex/config.toml",
    apiUrl: "https://api.openai.com/v1",
    model: "gpt-4o",
    chips: ["gpt-4o", "gpt-4o-mini", "o1", "o3-mini", "chatgpt-4o-latest"],
    sampleTokens: [
      "OpenAI Codex CLI initialized successfully.",
      " Model set to gpt-4o. Connection latency: 142ms.",
      " 200 OK | Process ready for autonomous execution."
    ],
    status: "已注入 · 进程就绪"
  },
  claude: {
    title: "🟣 Claude Code CLI 配置托管",
    desc: "统一纳管 ~/.claude.json 与 settings.json，内置 Claude 3.7 Sonnet 快捷芯片",
    configPath: "~/.claude.json",
    apiUrl: "https://api.anthropic.com/v1",
    model: "claude-3-7-sonnet",
    chips: ["claude-3-7-sonnet", "claude-3-5-sonnet", "claude-3-5-haiku", "claude-3-opus"],
    sampleTokens: [
      "Hello! Claude 3.7 Sonnet is ready.",
      " Thinking process enabled: Verified API gateway connection.",
      " 200 OK | Stream completed safely with 0 errors."
    ],
    status: "已接管 · 运行良好"
  },
  workbuddy: {
    title: "🟠 Workbuddy AI 工作流中枢",
    desc: "一键调阅与原子写入 ~/.workbuddy-ai/models.json，提供进程内环境变量即时注入",
    configPath: "~/.workbuddy-ai/models.json",
    apiUrl: "https://api.workbuddy.cn/v1",
    model: "deepseek-coder",
    chips: ["deepseek-coder", "claude-3.5-sonnet", "gpt-4o", "kimi-latest"],
    sampleTokens: [
      "Workbuddy AI configuration synced.",
      " System environment std::env::set_var dispatched.",
      " 200 OK | Workbuddy profile loaded."
    ],
    status: "已同步 · 状态正常"
  },
  paths: {
    title: "🧭 深度路径感知 & 进程安全热重启",
    desc: "智能多级回退探测引擎 + 有界句柄释放等待 + 进程树强力清理 (/F /T)",
    configPath: "~/.ai-helper/app_paths.json",
    apiUrl: "N/A (本地进程控制器)",
    model: "taskkill /F /T /PID",
    chips: ["自动探测", "Store解包", "NPM全局", "句柄释放轮询", "进程树自愈"],
    sampleTokens: [
      "Scanning active process trees...",
      " Found orphan node.exe on port 8080. Executing taskkill /F /T.",
      " File handles released in 120ms. Target process cleanly rebooted!"
    ],
    status: "双核守护监控中"
  }
};

let currentTab = "chatgpt";
let isStreaming = false;

// DOM Initialization
document.addEventListener("DOMContentLoaded", () => {
  // 核心版本与下载链接初始化优先执行，保证任何情况下下载按钮与版本展示立即可用
  try {
    initReleaseInfo();
  } catch (e) {
    console.error("[AI Helper] initReleaseInfo error:", e);
  }

  // 视觉与动画交互模块安全初始化（互不干扰）
  const visualModules = [
    initKineticTypography,
    initAnimeDotGrid,
    initSvgLaserPipeline,
    initReactBitsSpotlight,
    initReactBitsDecryptedText,
    initReactBits3DTilt,
    initReactBitsMagneticButtons,
    initSimulator,
    initFaqAccordion,
    initNavScrollEffect,
    initGsapAnimations
  ];

  visualModules.forEach(fn => {
    try {
      fn();
    } catch (err) {
      console.warn(`[AI Helper] 模块 ${fn.name || 'anonymous'} 初始化警告:`, err);
    }
  });
});

/**
 * ==========================================================================
 * Anime.js Feature 1: Kinetic Typography (Split Letter Elastic Entrance)
 * ==========================================================================
 */
function initKineticTypography() {
  const textElements = document.querySelectorAll(".anime-split-text");
  textElements.forEach(el => {
    const text = el.innerText;
    el.innerHTML = text
      .split("")
      .map(char => `<span class="anime-letter">${char === " " ? "&nbsp;" : char}</span>`)
      .join("");
  });

  if (typeof anime !== "undefined") {
    anime({
      targets: ".anime-headline .anime-letter",
      translateY: [40, 0],
      opacity: [0, 1],
      rotateZ: () => anime.random(-8, 8),
      duration: 1100,
      delay: anime.stagger(30, { start: 100 }),
      easing: "easeOutElastic(1, .6)"
    });
  }
}

/**
 * ==========================================================================
 * Anime.js Feature 2: Interactive Ripple Dot Grid Canvas (Inspired by animejs.com)
 * ==========================================================================
 */
function initAnimeDotGrid() {
  const canvas = document.getElementById("anime-dot-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  let width = (canvas.width = window.innerWidth);
  let height = (canvas.height = window.innerHeight);

  window.addEventListener("resize", () => {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
    createDots();
  });

  const spacing = 38;
  let dots = [];

  function createDots() {
    dots = [];
    const cols = Math.ceil(width / spacing) + 1;
    const rows = Math.ceil(height / spacing) + 1;

    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        dots.push({
          x: i * spacing,
          y: j * spacing,
          baseRadius: 1.5,
          radius: 1.5,
          color: "rgba(0, 113, 227, 0.25)"
        });
      }
    }
  }

  createDots();

  function render() {
    ctx.clearRect(0, 0, width, height);
    for (let d of dots) {
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.radius, 0, Math.PI * 2);
      ctx.fillStyle = d.color;
      ctx.fill();
    }
    requestAnimationFrame(render);
  }
  render();

  // Wave ripple on click or hover using Anime.js
  function triggerRipple(centerX, centerY) {
    if (typeof anime === "undefined") return;

    dots.forEach(dot => {
      const dx = dot.x - centerX;
      const dy = dot.y - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 400) {
        anime({
          targets: dot,
          radius: [1.5, 4.5, 1.5],
          duration: 900,
          delay: dist * 1.8,
          easing: "easeOutElastic(1, .5)"
        });
      }
    });
  }

  window.addEventListener("click", (e) => {
    triggerRipple(e.clientX, e.clientY);
  });

  let lastMove = 0;
  window.addEventListener("mousemove", (e) => {
    const now = Date.now();
    if (now - lastMove > 180) {
      lastMove = now;
      triggerRipple(e.clientX, e.clientY);
    }
  });
}

/**
 * ==========================================================================
 * Anime.js Feature 3: Cinematic Video Showcase Timeline Player
 * ==========================================================================
 */
let cinemaTimeline = null;
let isPlaying = false;

function initCinematicVideoPlayer() {
  const playBtn = document.getElementById("cinema-btn-play");
  const timeDisplay = document.getElementById("cinema-timer");
  const progressFill = document.getElementById("cinema-progress-fill");
  const chapterTag = document.getElementById("cinema-chapter");
  const scrubber = document.getElementById("cinema-scrubber");

  if (!playBtn || typeof anime === "undefined") return;

  const totalDuration = 15000; // 15 seconds product video simulation

  cinemaTimeline = anime.timeline({
    autoplay: false,
    duration: totalDuration,
    easing: "linear",
    update: (anim) => {
      const progress = anim.progress;
      if (progressFill) progressFill.style.width = `${progress}%`;

      const currentSec = Math.floor((anim.currentTime / 1000) % 60);
      const formatted = `00:${currentSec < 10 ? "0" + currentSec : currentSec} / 00:15`;
      if (timeDisplay) timeDisplay.innerText = formatted;

      // Chapter tags update
      if (chapterTag) {
        if (progress < 33) {
          chapterTag.innerHTML = `<span class="cinema-rec-dot"></span> 阶段 01: 智能路径探测与 Store 解包`;
        } else if (progress < 66) {
          chapterTag.innerHTML = `<span class="cinema-rec-dot"></span> 阶段 02: API 网关与流式 Token 握手`;
        } else {
          chapterTag.innerHTML = `<span class="cinema-rec-dot"></span> 阶段 03: 进程树安全查杀 (/F /T) 与热重启`;
        }
      }
    },
    complete: () => {
      isPlaying = false;
      playBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
    }
  });

  // Choreographed scenes
  cinemaTimeline
    .add({
      // Scene 1: Switch to ChatGPT and pulse node
      targets: ".p-node-cloud",
      scale: [1, 1.08, 1],
      duration: 1200,
      begin: () => {
        switchSimulatorTab("chatgpt");
        highlightPipelineNode(0);
      }
    })
    .add({
      // Scene 2: Stream Token typing
      targets: ".p-node-hub",
      scale: [1, 1.08, 1],
      duration: 4800,
      begin: () => {
        highlightPipelineNode(1);
        runSimulatorTerminalTest();
      }
    })
    .add({
      // Scene 3: Hot reboot client
      targets: ".p-node-target",
      scale: [1, 1.1, 1],
      duration: 4500,
      begin: () => {
        switchSimulatorTab("paths");
        highlightPipelineNode(2);
        showToast("🎬 电影演示完成：目标客户端已携最新配置无缝拉起！");
      }
    });

  // Toggle play/pause
  playBtn.addEventListener("click", () => {
    if (isPlaying) {
      cinemaTimeline.pause();
      isPlaying = false;
      playBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
    } else {
      cinemaTimeline.play();
      isPlaying = true;
      playBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`;
    }
  });

  // Scrubber click seek
  if (scrubber) {
    scrubber.addEventListener("click", (e) => {
      const rect = scrubber.getBoundingClientRect();
      const clickPercent = (e.clientX - rect.left) / rect.width;
      cinemaTimeline.seek(cinemaTimeline.duration * clickPercent);
    });
  }
}

function highlightPipelineNode(index) {
  const nodes = document.querySelectorAll(".p-node");
  nodes.forEach((n, i) => {
    n.classList.toggle("active-glow", i === index);
  });
}

/**
 * ==========================================================================
 * Anime.js Feature 4: SVG Laser Data Flow Drawing
 * ==========================================================================
 */
function initSvgLaserPipeline() {
  if (typeof anime === "undefined") return;

  const path = document.querySelector(".laser-circuit-path");
  if (!path) return;

  anime({
    targets: path,
    strokeDashoffset: [anime.setDashoffset, 0],
    easing: "easeInOutSine",
    duration: 2500,
    direction: "alternate",
    loop: true
  });
}

/**
 * ==========================================================================
 * React-Bits Component 1: SpotlightCard (Light Specular Glow)
 * ==========================================================================
 */
function initReactBitsSpotlight() {
  const cards = document.querySelectorAll(".spotlight-card, .tilted-window-card");
  cards.forEach(card => {
    card.addEventListener("mousemove", (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      card.style.setProperty("--mouse-x", `${x}px`);
      card.style.setProperty("--mouse-y", `${y}px`);
    });
  });
}

/**
 * ==========================================================================
 * React-Bits Component 2: DecryptedText (Cyber Character Scramble)
 * ==========================================================================
 */
function initReactBitsDecryptedText() {
  const elements = document.querySelectorAll("[data-decrypted-text]");
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789$#%&*";

  elements.forEach(el => {
    const originalText = el.getAttribute("data-decrypted-text") || el.innerText;
    let iteration = 0;
    let interval = null;

    function runDecryption() {
      clearInterval(interval);
      iteration = 0;

      interval = setInterval(() => {
        el.innerText = originalText
          .split("")
          .map((char, index) => {
            if (char === " ") return " ";
            if (index < iteration) {
              return originalText[index];
            }
            return characters[Math.floor(Math.random() * characters.length)];
          })
          .join("");

        if (iteration >= originalText.length) {
          clearInterval(interval);
        }
        iteration += 1 / 2;
      }, 30);
    }

    runDecryption();
    el.addEventListener("mouseenter", runDecryption);
  });
}

/**
 * ==========================================================================
 * React-Bits Component 3: 3D TiltedCard (Perspective Parallax Tilt)
 * ==========================================================================
 */
function initReactBits3DTilt() {
  const tiltCard = document.querySelector(".tilted-window-card");
  if (!tiltCard) return;

  const stage = document.querySelector(".showcase-stage");
  if (!stage) return;

  stage.addEventListener("mousemove", (e) => {
    const rect = stage.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    const rotateX = ((y - centerY) / centerY) * -5;
    const rotateY = ((x - centerX) / centerX) * 5;

    tiltCard.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.01, 1.01, 1.01)`;
  });

  stage.addEventListener("mouseleave", () => {
    tiltCard.style.transform = "perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)";
  });
}

/**
 * ==========================================================================
 * React-Bits Component 4: MagneticButton (Apple Cursor Pull Physics)
 * ==========================================================================
 */
function initReactBitsMagneticButtons() {
  const magneticElements = document.querySelectorAll(".btn-hero-primary, .btn-dl-apple, .star-border-btn, .cinema-play-btn");
  
  magneticElements.forEach(btn => {
    btn.addEventListener("mousemove", (e) => {
      const rect = btn.getBoundingClientRect();
      const x = e.clientX - rect.left - rect.width / 2;
      const y = e.clientY - rect.top - rect.height / 2;
      btn.style.transform = `translate(${x * 0.25}px, ${y * 0.25}px)`;
    });

    btn.addEventListener("mouseleave", () => {
      btn.style.transform = "translate(0px, 0px)";
    });
  });
}

/**
 * ==========================================================================
 * GSAP Keynote Entrance & ScrollTrigger Animations
 * ==========================================================================
 */
function initGsapAnimations() {
  if (typeof window.gsap !== "undefined") {
    const gsap = window.gsap;
    if (typeof window.ScrollTrigger !== "undefined") {
      gsap.registerPlugin(window.ScrollTrigger);
    }

    // Keynote Hero Timeline
    const tl = gsap.timeline({ defaults: { ease: "power4.out" } });
    tl.from(".keynote-eyebrow", { opacity: 0, y: -20, duration: 0.8, delay: 0.1 })
      .from(".keynote-subhead", { opacity: 0, y: 25, duration: 0.9 }, "-=0.5")
      .from(".hero-cta-group", { opacity: 0, y: 20, duration: 0.8 }, "-=0.6")
      .from(".pipeline-showcase", { opacity: 0, y: 25, duration: 0.8 }, "-=0.5")
      .from(".tilted-window-card", { opacity: 0, y: 50, scale: 0.97, duration: 1.1, ease: "power3.out" }, "-=0.6");

    // Bento Grid ScrollTrigger
    if (window.ScrollTrigger) {
      gsap.from(".spotlight-card", {
        scrollTrigger: {
          trigger: ".bento-grid",
          start: "top 80%"
        },
        opacity: 0,
        y: 40,
        duration: 0.9,
        stagger: 0.12,
        ease: "power3.out"
      });

      gsap.from(".workflow-card-step", {
        scrollTrigger: {
          trigger: ".workflow-steps-deck",
          start: "top 85%"
        },
        opacity: 0,
        y: 35,
        duration: 0.8,
        stagger: 0.15,
        ease: "power3.out"
      });

      gsap.from(".dl-pro-card", {
        scrollTrigger: {
          trigger: ".download-cards-row",
          start: "top 85%"
        },
        opacity: 0,
        y: 40,
        duration: 0.9,
        stagger: 0.15,
        ease: "power3.out"
      });
    }
  } else {
    document.querySelectorAll(".keynote-headline, .spotlight-card, .workflow-card-step, .dl-pro-card").forEach(el => {
      el.style.opacity = "1";
    });
  }
}

/**
 * ==========================================================================
 * Interactive Simulator Actions & Typewriter Terminal
 * ==========================================================================
 */
function initSimulator() {
  const tabBtns = document.querySelectorAll(".sim-tab-button");
  tabBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-tab");
      switchSimulatorTab(tab);
    });
  });

  const testBtn = document.getElementById("btn-sim-test");
  if (testBtn) {
    testBtn.addEventListener("click", runSimulatorTerminalTest);
  }

  document.addEventListener("click", (e) => {
    if (e.target.classList.contains("chip-item")) {
      const parent = e.target.closest(".chips-deck");
      if (parent) {
        parent.querySelectorAll(".chip-item").forEach(c => c.classList.remove("active"));
        e.target.classList.add("active");
        const modelInput = document.getElementById("sim-input-model");
        if (modelInput) {
          modelInput.value = e.target.innerText;
        }
        showToast(`已切换模型为: ${e.target.innerText}`);
      }
    }
  });

  switchSimulatorTab("chatgpt");
}

function switchSimulatorTab(tabKey) {
  if (!SIMULATOR_DATA[tabKey]) return;
  currentTab = tabKey;
  const data = SIMULATOR_DATA[tabKey];

  document.querySelectorAll(".sim-tab-button").forEach(b => {
    b.classList.toggle("active", b.getAttribute("data-tab") === tabKey);
  });

  const titleEl = document.getElementById("sim-title");
  const descEl = document.getElementById("sim-desc");
  const configEl = document.getElementById("sim-input-config");
  const apiEl = document.getElementById("sim-input-api");
  const modelEl = document.getElementById("sim-input-model");
  const chipsContainer = document.getElementById("sim-chips");
  const statusBadge = document.getElementById("sim-status-badge");
  const terminalBody = document.getElementById("sim-terminal-text");

  if (titleEl) titleEl.innerText = data.title;
  if (descEl) descEl.innerText = data.desc;
  if (configEl) configEl.value = data.configPath;
  if (apiEl) apiEl.value = data.apiUrl;
  if (modelEl) modelEl.value = data.model;
  if (statusBadge) statusBadge.innerText = data.status;

  if (chipsContainer) {
    chipsContainer.innerHTML = data.chips.map((chip, idx) => `
      <span class="chip-item ${idx === 0 ? 'active' : ''}">${chip}</span>
    `).join("");
  }

  if (terminalBody) {
    terminalBody.innerHTML = `<span style="color:#64748b;">// 准备就绪。点击下方「测试流式连通性」发起网络握手探针...</span>`;
  }
}

function runSimulatorTerminalTest() {
  if (isStreaming) return;
  const terminalBody = document.getElementById("sim-terminal-text");
  const latencyBadge = document.getElementById("sim-latency-badge");
  if (!terminalBody) return;

  isStreaming = true;
  terminalBody.innerHTML = "";
  if (latencyBadge) latencyBadge.innerText = "测速中...";

  const data = SIMULATOR_DATA[currentTab];
  const startTime = Date.now();

  const lines = [
    `> [CONNECT] POST ${data.apiUrl} (TLS 1.3 / HTTP/2)`,
    `> [AUTH] Token verified via atomic local credentials.`,
    `> [STREAM] Received response chunk:`,
    ...data.sampleTokens
  ];

  let lineIdx = 0;
  let charIdx = 0;

  function typeNextChar() {
    if (lineIdx >= lines.length) {
      isStreaming = false;
      const elapsed = Date.now() - startTime;
      if (latencyBadge) latencyBadge.innerText = `${elapsed}ms (TTFT: 78ms)`;
      terminalBody.innerHTML += `\n<span style="color:#10b981;">✔ 流式握手圆满完成！首字时延极佳，网络状态优良。</span>`;
      return;
    }

    const currentLine = lines[lineIdx];
    if (charIdx === 0) {
      if (lineIdx > 0) terminalBody.innerHTML += "\n";
    }

    terminalBody.innerHTML += currentLine[charIdx];
    charIdx++;

    if (charIdx >= currentLine.length) {
      lineIdx++;
      charIdx = 0;
      setTimeout(typeNextChar, 100);
    } else {
      setTimeout(typeNextChar, 15);
    }
  }

  typeNextChar();
}

/**
 * ==========================================================================
 * Dynamic GitHub Release Fetcher & Multi-Source Auto-Sync
 * ==========================================================================
 */
let activeReleaseTag = CURRENT_VERSION;
let activeReleasePageUrl = `${GITHUB_RELEASES_URL}/tag/${CURRENT_VERSION}`;

function copyReleaseChecksumUrl() {
  copyToClipboard(activeReleasePageUrl, "已复制官方发布页链接以验证校验和！");
}
window.copyReleaseChecksumUrl = copyReleaseChecksumUrl;

function applyReleaseData({
  tag,
  setupUrl,
  zipUrl,
  fastSetupUrl,
  fastZipUrl,
  releasePageUrl,
  setupFileName
}) {
  if (!tag) return;
  const normalizedTag = tag.startsWith("v") ? tag : `v${tag}`;
  activeReleaseTag = normalizedTag;
  activeReleasePageUrl = releasePageUrl || `${GITHUB_RELEASES_URL}/tag/${normalizedTag}`;

  const resolvedSetupFileName = setupFileName || `AI-Helper-${normalizedTag}-Windows-x64-Setup.exe`;
  const resolvedZipFileName = `AI-Helper-${normalizedTag}-Windows-x64-Standalone.zip`;

  const finalSetupUrl = setupUrl || `${GITHUB_RELEASES_URL}/download/${normalizedTag}/${resolvedSetupFileName}`;
  const finalZipUrl = zipUrl || `${GITHUB_RELEASES_URL}/download/${normalizedTag}/${resolvedZipFileName}`;
  const finalFastSetupUrl = fastSetupUrl || `${GHFAST_PREFIX}${finalSetupUrl}`;
  const finalFastZipUrl = fastZipUrl || `${GHFAST_PREFIX}${finalZipUrl}`;

  // 1. 更新所有版本徽标与标签文本
  document.querySelectorAll(".current-version-tag").forEach(el => {
    el.innerText = normalizedTag;
  });

  // 2. 更新 Hero 区域主下载按钮
  const heroDownloadBtn = document.getElementById("btn-hero-download");
  if (heroDownloadBtn) {
    heroDownloadBtn.href = finalSetupUrl;
  }
  const heroBtnText = document.getElementById("hero-btn-text");
  if (heroBtnText) {
    heroBtnText.innerText = `立即下载 Windows 安装版 (${normalizedTag})`;
  }

  // 3. 更新下载专区直链及国内镜像
  const setupDownloadLink = document.getElementById("link-dl-setup");
  if (setupDownloadLink) setupDownloadLink.href = finalSetupUrl;

  const fastSetupLink = document.getElementById("link-dl-fast-setup");
  if (fastSetupLink) fastSetupLink.href = finalFastSetupUrl;

  const zipDownloadLink = document.getElementById("link-dl-zip");
  if (zipDownloadLink) zipDownloadLink.href = finalZipUrl;

  const fastZipLink = document.getElementById("link-dl-fast-zip");
  if (fastZipLink) fastZipLink.href = finalFastZipUrl;

  // 4. 更新系统校验与文件名展示
  const checksumFilename = document.getElementById("checksum-setup-filename");
  if (checksumFilename) {
    checksumFilename.innerText = resolvedSetupFileName;
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 4000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return res;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

async function initReleaseInfo() {
  // 步骤 1: 使用内置常量瞬时初始化页面，确保首屏零等待
  applyReleaseData({ tag: CURRENT_VERSION });

  // 步骤 2: 尝试读取同源 version.json (本地构建/离线部署零延迟同步)
  // 如果是 file:// 协议打开则跳过 fetch 以免控制台产生 CORS 警报
  if (window.location.protocol !== "file:") {
    try {
      const localRes = await fetch(`./version.json?t=${Date.now()}`, { cache: "no-store" });
      if (localRes.ok) {
        const localData = await localRes.json();
        if (localData && (localData.tag || localData.version)) {
          applyReleaseData({
            tag: localData.tag || `v${localData.version}`,
            setupUrl: localData.setupDownloadUrl,
            zipUrl: localData.zipDownloadUrl,
            fastSetupUrl: localData.fastSetupDownloadUrl,
            fastZipUrl: localData.fastZipDownloadUrl,
            releasePageUrl: localData.releasePageUrl,
            setupFileName: localData.setupFileName
          });
        }
      }
    } catch (_) {
      // 容错处理
    }
  }

  // 步骤 3: 异步探测 GitHub 官方最新 Release (获取完整 assets 列表与最新标签)
  let syncSuccess = false;
  try {
    const res = await fetchWithTimeout(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      { headers: { "Accept": "application/vnd.github.v3+json" } },
      4000
    );

    if (res.ok) {
      const release = await res.json();
      const latestTag = release.tag_name;
      if (latestTag) {
        const setupAsset = release.assets?.find(a => a.name.endsWith("-Setup.exe"));
        const zipAsset = release.assets?.find(a => a.name.endsWith("-Standalone.zip"));

        const finalSetupUrl = setupAsset ? setupAsset.browser_download_url : `${GITHUB_RELEASES_URL}/download/${latestTag}/AI-Helper-${latestTag}-Windows-x64-Setup.exe`;
        const finalZipUrl = zipAsset ? zipAsset.browser_download_url : `${GITHUB_RELEASES_URL}/download/${latestTag}/AI-Helper-${latestTag}-Windows-x64-Standalone.zip`;

        applyReleaseData({
          tag: latestTag,
          setupUrl: finalSetupUrl,
          zipUrl: finalZipUrl,
          fastSetupUrl: `${GHFAST_PREFIX}${finalSetupUrl}`,
          fastZipUrl: `${GHFAST_PREFIX}${finalZipUrl}`,
          releasePageUrl: release.html_url || `${GITHUB_RELEASES_URL}/tag/${latestTag}`,
          setupFileName: setupAsset ? setupAsset.name : `AI-Helper-${latestTag}-Windows-x64-Setup.exe`
        });

        syncSuccess = true;
        console.info(`[AI Helper] 成功通过 GitHub API 同步最新版本: ${latestTag}`);
      }
    }
  } catch (err) {
    // 官方 API 超时或遭遇 Rate Limit (403)
  }

  // 步骤 4: 若官方 API 失败，通过 Raw version.json 双通道探针兜底 (无限流限制，支持国内加速反代)
  if (!syncSuccess) {
    const rawSources = [
      `${GHFAST_PREFIX}https://raw.githubusercontent.com/${GITHUB_REPO}/main/website/version.json`,
      `https://raw.githubusercontent.com/${GITHUB_REPO}/main/website/version.json`
    ];

    for (const rawUrl of rawSources) {
      try {
        const res = await fetchWithTimeout(rawUrl, { cache: "no-store" }, 4000);
        if (res.ok) {
          const rawData = await res.json();
          if (rawData && (rawData.tag || rawData.version)) {
            applyReleaseData({
              tag: rawData.tag || `v${rawData.version}`,
              setupUrl: rawData.setupDownloadUrl,
              zipUrl: rawData.zipDownloadUrl,
              fastSetupUrl: rawData.fastSetupDownloadUrl,
              fastZipUrl: rawData.fastZipDownloadUrl,
              releasePageUrl: rawData.releasePageUrl,
              setupFileName: rawData.setupFileName
            });

            syncSuccess = true;
            console.info(`[AI Helper] 成功通过 Raw 镜像通道同步最新版本: ${rawData.tag || rawData.version}`);
            break;
          }
        }
      } catch (_) {}
    }
  }
}

/**
 * ==========================================================================
 * Navigation Blur on Scroll & Utilities
 * ==========================================================================
 */
function initNavScrollEffect() {
  const nav = document.querySelector(".apple-nav");
  window.addEventListener("scroll", () => {
    if (window.scrollY > 40) {
      nav.classList.add("scrolled");
    } else {
      nav.classList.remove("scrolled");
    }
  });
}

function initFaqAccordion() {
  const faqRows = document.querySelectorAll(".faq-accordion-row");
  faqRows.forEach(row => {
    const trigger = row.querySelector(".faq-trigger-btn");
    const drawer = row.querySelector(".faq-content-drawer");

    trigger.addEventListener("click", () => {
      const isActive = row.classList.contains("active");

      faqRows.forEach(other => {
        if (other !== row) {
          other.classList.remove("active");
          const otherDrawer = other.querySelector(".faq-content-drawer");
          if (otherDrawer) otherDrawer.style.maxHeight = null;
        }
      });

      if (isActive) {
        row.classList.remove("active");
        drawer.style.maxHeight = null;
      } else {
        row.classList.add("active");
        drawer.style.maxHeight = drawer.scrollHeight + 30 + "px";
      }
    });
  });
}

function copyToClipboard(text, message) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => {
      showToast(message || "已复制到剪贴板！");
    }).catch(() => {
      fallbackCopy(text, message);
    });
  } else {
    fallbackCopy(text, message);
  }
}

function fallbackCopy(text, message) {
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.position = "fixed";
  textArea.style.left = "-999999px";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  try {
    document.execCommand("copy");
    showToast(message || "已复制到剪贴板！");
  } catch (err) {
    showToast("请手动选取复制");
  }
  document.body.removeChild(textArea);
}

let toastTimeout;
function showToast(msg) {
  let toast = document.getElementById("toast-notification");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast-notification";
    toast.className = "toast-msg";
    document.body.appendChild(toast);
  }

  toast.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0071e3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
      <polyline points="22 4 12 14.01 9 11.01"></polyline>
    </svg>
    <span>${msg}</span>
  `;

  toast.classList.add("show");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove("show");
  }, 2800);
}
