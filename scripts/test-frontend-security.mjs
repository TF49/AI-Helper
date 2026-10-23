// Isolated behavior tests: transpile the real TS/TSX, mock hooks, IPC and browser APIs.
// No network, real credentials, real localStorage, clipboard or HOME are accessed.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fakeToken = { id: 11, name: "fake-token", key: "masked", status: 1,
  expired_time: -1, unlimited_quota: true, remain_quota: 0, group: "default", user_id: 1 };
const auth = (id) => ({ is_logged_in: id !== null, user: id === null ? null : { id, username: `fake-${id}` } });
const pricing = (ratio = 1.2) => ({ success: true, group_ratio: { default: 1, target: ratio },
  usable_group: { default: "default", target: "target" }, data: [], vendors: [], auto_groups: [], pricing_version: "test" });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

const fields = {
  TokenSelectModal: ["tokens", "loading", "errorMsg", "revealedKeys", "copiedId", "fetchingKeyId", "syncingKeyId",
    "editingGroupToken", "availableGroups", "pricingInfo", "pricingLoading", "isUpdatingGroup",
    "setSelectedNewGroup", "setRateConfirmed", "loadTokens", "handleSmoothClose", "handleCloseEditGroup",
    "handleSelectToken", "handleApplyToAll", "handleCopyKey", "handleToggleReveal", "handleOpenEditGroup", "handleSaveTokenGroup"],
  ChannelGroupMonitor: ["groups", "loading", "pricingInfo", "pricingLoading", "switchModalState", "boundTokenInfo",
    "setSwitchModalState", "loadData", "handleInitiateSwitchGroup", "handleConfirmSwitchGroup", "handleCloseSwitchModal"],
  AuthProvider: ["authState", "wallet", "walletError", "isLoadingWallet", "authSessionGeneration", "isAuthReady",
    "refreshState", "refreshWallet", "logout", "onLoginSuccess", "onTokenSelected", "loginModalOpen"],
  ApiKeyInput: ["credentialStatus", "confirmingDestination", "credentialError", "boundToken", "handleConfirmDestination"],
  BoundTokenGroupHost: ["group", "onBoundTokenChange"],
};

// Expose existing component closures for the harness without reimplementing handlers.
function captureTransformer(component) {
  return (context) => (source) => ts.visitNode(source, function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === component) {
      const statements = [...node.body.statements];
      const index = statements.findIndex((statement) => ts.isReturnStatement(statement) ||
        (ts.isIfStatement(statement) && ts.isReturnStatement(statement.thenStatement)));
      statements.splice(index, 0, ts.factory.createExpressionStatement(ts.factory.createCallExpression(
        ts.factory.createIdentifier("__capture"), undefined,
        [ts.factory.createObjectLiteralExpression(fields[component].map((name) => ts.factory.createShorthandPropertyAssignment(name)))],
      )));
      return ts.factory.updateFunctionDeclaration(node, node.modifiers, node.asteriskToken, node.name,
        node.typeParameters, node.parameters, node.type, ts.factory.updateBlock(node.body, statements));
    }
    return ts.visitEachChild(node, visit, context);
  });
}

function environment() {
  const env = { now: 1_000_000, calls: new Map(), impl: {}, storage: new Map(), events: [], notices: [],
    clipboard: [], clipboardCleanup: [], timers: new Map(), nextTimer: 1,
    authContext: { authState: auth(1), authSessionGeneration: 1, setLoginModalOpen() {},
      wallet: null, walletError: null, isLoadingWallet: false,
      refreshWallet: async () => true, refreshState: async () => {}, logout: async () => {} } };
  const listeners = new Map();
  const schedule = (callback, ms, interval = false) => {
    const id = env.nextTimer++;
    env.timers.set(id, { callback, due: env.now + ms, interval: interval ? ms : 0 });
    return id;
  };
  env.window = {
    addEventListener(name, callback) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(callback);
    },
    removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
    dispatchEvent(event) {
      env.events.push(event);
      for (const callback of [...(listeners.get(event.type) || [])]) callback(event);
      return true;
    },
    setTimeout: (callback, ms) => schedule(callback, ms), clearTimeout: (id) => env.timers.delete(id),
    setInterval: (callback, ms) => schedule(callback, ms, true), clearInterval: (id) => env.timers.delete(id),
  };
  env.advance = (ms) => {
    env.now += ms;
    for (const [id, timer] of [...env.timers]) {
      if (timer.due > env.now) continue;
      if (timer.interval) timer.due = env.now + timer.interval;
      else env.timers.delete(id);
      timer.callback();
    }
  };
  env.impl = {
    getUserTokens: () => [fakeToken], getTokenKey: () => "sk-fake-test-only", setSelectedToken: () => undefined,
    applyApiKeyToAgents: () => ({ chatgpt: true, claude: true, workbuddy: true, acciowork: true }),
    getPricingData: () => pricing(), getChannelGroupOverview: () => [], getUserAvailableGroups: () => ["target"],
    updateUserTokenGroup: (id, group) => ({ ...fakeToken, id, group }), getAuthState: () => auth(null),
    getUserWallet: () => ({ balance: "fake-wallet" }), logoutAccount: () => undefined, openUrl: () => undefined,
    checkBobApiNetwork: () => ({ reachable: true }),
    getUserUsageLogs: () => ({ items: [], total: 0, page: 1, page_size: 20 }),
    getUserUsageStat: () => null,
    getCredentialStatus: () => ({ source: "unknown", authorized: false, can_confirm: true,
      origin: "https://fake.example", message: null }),
    confirmCredentialDestination: () => ({ source: "external", authorized: true, can_confirm: false,
      origin: "https://fake.example", message: null }),
  };
  env.api = Object.fromEntries(Object.keys(env.impl).map((name) => [name, (...args) => {
    if (!env.calls.has(name)) env.calls.set(name, []);
    env.calls.get(name).push(args);
    try { return Promise.resolve(env.impl[name](...args)); } catch (error) { return Promise.reject(error); }
  }]));
  env.count = (name) => env.calls.get(name)?.length || 0;
  env.changeAuth = (id, session = env.authContext.authSessionGeneration + 1) => {
    env.authContext = { ...env.authContext, authState: auth(id), authSessionGeneration: session };
    env.window.dispatchEvent({ type: "ai_helper_auth_changed", detail: { userId: id, sessionGeneration: session } });
  };
  return env;
}

class Harness {
  constructor(component, env = environment(), props = {}) {
    this.component = component;
    this.env = env;
    this.props = { open: true, onSelectKey: (...args) => this.selected.push(args), onClose() {},
      value: "sk-fake-input-only", destinationUrl: "https://fake.example/v1", toolId: "chatgpt",
      onChange: (value) => this.changed.push(value), ...props };
    this.selected = [];
    this.changed = [];
    this.slots = [];
    this.dirty = true;
    const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
    const memo = (factory, deps) => {
      const index = this.index++;
      if (!this.slots[index] || !same(this.slots[index].deps, deps)) this.slots[index] = { value: factory(), deps };
      return this.slots[index].value;
    };
    const effect = (callback, deps) => {
      const index = this.index++;
      const previous = this.slots[index];
      if (!previous || !same(previous.deps, deps)) {
        this.slots[index] = { deps, cleanup: previous?.cleanup, effect: callback };
        this.effects.push(() => {
          this.slots[index].cleanup?.();
          this.slots[index].cleanup = callback();
        });
      }
    };
    const hooks = {
      useState: (initial) => {
        const index = this.index++;
        if (!this.slots[index]) this.slots[index] = { value: typeof initial === "function" ? initial() : initial };
        const set = (next) => {
          const previous = this.slots[index].value;
          const value = typeof next === "function" ? next(previous) : next;
          if (!Object.is(previous, value)) { this.slots[index].value = value; this.dirty = true; }
        };
        return [this.slots[index].value, set];
      },
      useRef: (initial) => {
        const index = this.index++;
        if (!this.slots[index]) this.slots[index] = { current: initial };
        return this.slots[index];
      },
      useMemo: memo, useCallback: (callback, deps) => memo(() => callback, deps), useEffect: effect,
      useLayoutEffect: effect, createContext: () => ({ Provider: "AuthContext.Provider" }), useContext: () => env.authContext,
    };
    const jsx = (type, props, key) => ({ type, props, key });
    const placeholder = new Proxy({}, { get: (_target, name) => String(name) });
    const button = function ButtonToLoaderToSuccess() {};
    const gsap = { killTweensOf() {}, fromTo() {}, to() {}, timeline: () => ({ to() {} }) };
    const modules = new Map();
    const load = (relative, capture) => {
      if (modules.has(relative)) return modules.get(relative);
      const filename = path.join(root, relative);
      let source = fs.readFileSync(filename, "utf8");
      if (capture === "BoundTokenGroupHost") {
        // Mount the real hook with the same mocked React/IPC runtime as the
        // components. The resolver and its asynchronous helpers stay unmodified.
        source += "\nexport function BoundTokenGroupHost({ toolId, value }: { toolId: string; value: string }) { const { group, onBoundTokenChange } = useBoundTokenGroup(toolId, value); return null; }";
      }
      const output = ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
        fileName: filename, transformers: capture ? { before: [captureTransformer(capture)] } : undefined,
      }).outputText;
      const exports = {};
      const requireMock = (name) => {
        if (name === "react") return { ...hooks, default: hooks };
        if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "Fragment" };
        if (name === "react-dom") return { createPortal: (tree) => tree };
        if (name === "gsap") return { default: gsap };
        if (name === "sonner") return { toast: Object.fromEntries(["success", "warning", "error", "info"].map((kind) =>
          [kind, (...args) => env.notices.push([kind, ...args])])) };
        if (name.endsWith("/api") || name === "./api") return env.api;
        if (name.endsWith("/useAuth")) return { useAuth: () => env.authContext };
        if (name.endsWith("/groupPricing")) return load("src/lib/groupPricing.ts");
        if (name.endsWith("/quotaDisplay")) return load("src/lib/quotaDisplay.ts");
        if (name.endsWith("/useBoundTokenGroup")) return load("src/lib/useBoundTokenGroup.ts");
        if (name.endsWith("/secureClipboard")) return { scheduleClipboardClear: (key) => env.clipboardCleanup.push(key) };
        if (name.endsWith("/utils")) return { cn: (...args) => args.filter((arg) => typeof arg === "string").join(" ") };
        if (name.endsWith("/types")) return { isUserAdmin: (user) => (user?.role || 0) >= 10 };
        if (name.endsWith("/ButtonToLoaderToSuccess")) return { ButtonToLoaderToSuccess: button };
        return placeholder;
      };
      const FakeDate = class extends Date { static now() { return env.now; } };
      const sandbox = { exports, require: requireMock, console: { warn() {}, log() {} }, Date: FakeDate,
        __capture: (value) => { this.capture = value; }, window: env.window, document: { body: {} },
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
        navigator: { clipboard: { writeText: async (value) => { env.clipboard.push(value); } } },
        localStorage: { getItem: (key) => env.storage.get(key) ?? null, setItem: (key, value) => env.storage.set(key, value),
          removeItem: (key) => env.storage.delete(key) },
        setTimeout: env.window.setTimeout, clearTimeout: env.window.clearTimeout,
        setInterval: env.window.setInterval, clearInterval: env.window.clearInterval,
      };
      vm.runInNewContext(output, sandbox, { filename });
      modules.set(relative, exports);
      return exports;
    };
    const filename = component === "AccountBalanceCard" ? "src/components/AccountBalanceCard.tsx"
      : component === "PersonalCenterPanel" ? "src/components/account/PersonalCenterPanel.tsx"
      : component === "UsageLogsPanel" ? "src/components/account/UsageLogsPanel.tsx"
      : component === "BoundTokenGroupHost" ? "src/lib/useBoundTokenGroup.ts"
      : component === "AuthProvider" ? "src/lib/useAuth.tsx"
      : component === "TokenSelectModal" ? "src/components/auth/TokenSelectModal.tsx"
        : component === "ApiKeyInput" ? "src/components/ApiKeyInput.tsx" : "src/components/ChannelGroupMonitor.tsx";
    this.fn = load(filename, component)[component];
    this.groupPricing = load("src/lib/groupPricing.ts");
  }
  flush() {
    let count = 0;
    while (this.dirty) {
      assert.ok(++count <= 30, "hook render/effect loop");
      this.dirty = false;
      this.index = 0;
      this.effects = [];
      this.tree = this.fn(this.props);
      for (const effect of this.effects) effect();
    }
    return this.capture;
  }
  render(props = {}) { this.props = { ...this.props, ...props }; this.dirty = true; return this.flush(); }
  renderBeforeEffects(props = {}) {
    this.props = { ...this.props, ...props };
    this.dirty = false;
    this.index = 0;
    this.effects = [];
    this.tree = this.fn(this.props);
    return this.capture;
  }
  commitEffects() {
    const effects = this.effects;
    this.effects = [];
    for (const effect of effects) effect();
    return this.flush();
  }
  replayEffects() {
    const effects = this.slots.filter((slot) => typeof slot?.effect === "function");
    for (const slot of effects) slot.cleanup?.();
    for (const slot of effects) slot.cleanup = slot.effect();
    return this.flush();
  }
  unmount() { for (const slot of this.slots) slot?.cleanup?.(); }
}

async function settle(harness) {
  for (let i = 0; i < 10; i++) { await Promise.resolve(); harness.flush(); }
  return harness.capture;
}
async function ready(component, env = environment(), props = {}) {
  const harness = new Harness(component, env, props);
  harness.flush();
  await settle(harness);
  return harness;
}
function buttons(tree) {
  const result = [];
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    if (node.type?.name === "ButtonToLoaderToSuccess") result.push(node.props);
    visit(node.props?.children);
  };
  visit(tree);
  return result;
}

function textOf(node) {
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "string" || typeof node === "number") return String(node);
  return node && typeof node === "object" ? textOf(node.props?.children) : "";
}
function findButton(tree, text) {
  if (Array.isArray(tree)) return tree.map((node) => findButton(node, text)).find(Boolean);
  if (!tree || typeof tree !== "object") return undefined;
  if (tree.type === "button" && textOf(tree) === text) return tree;
  return findButton(tree.props?.children, text);
}

function findByTitle(tree, title) {
  if (Array.isArray(tree)) return tree.map((node) => findByTitle(node, title)).find(Boolean);
  if (!tree || typeof tree !== "object") return undefined;
  if (tree.props?.title === title) return tree;
  return findByTitle(tree.props?.children, title);
}

const tests = [];
const test = (name, run) => tests.push({ name, run });

const rawWallet = (extra = {}) => {
  const quota = extra.quota !== undefined ? extra.quota : 1234567;
  const used_quota = extra.used_quota !== undefined ? extra.used_quota : 42;
  const quota_per_unit = 500000;
  const rmb_to_usd_rate = 4.0;
  const quota_usd = typeof quota === "number" ? quota / quota_per_unit : 0;
  const quota_cny = quota_usd / rmb_to_usd_rate;
  const used_quota_usd = typeof used_quota === "number" ? used_quota / quota_per_unit : 0;
  const used_quota_cny = used_quota_usd / rmb_to_usd_rate;
  return {
    quota,
    used_quota,
    request_count: 0,
    quota_usd,
    quota_cny,
    used_quota_usd,
    used_quota_cny,
    quota_per_unit,
    rmb_to_usd_rate,
    group: "test",
    ...extra,
  };
};

test("wallet cards display USD and CNY balances accurately using 1:4 rate and 500k quota per unit", async () => {
  for (const component of ["AccountBalanceCard", "PersonalCenterPanel"]) {
    const env = environment();
    env.authContext.wallet = rawWallet({
      quota: 163638029,
      used_quota: 380572158,
      quota_usd: 163638029 / 500000,
      quota_cny: (163638029 / 500000) / 4,
      used_quota_usd: 380572158 / 500000,
      used_quota_cny: (380572158 / 500000) / 4,
      request_count: 22649,
    });
    const h = await ready(component, env);
    const text = textOf(h.tree);
    assert.ok(text.includes("327.2761"), `${component} did not display correct USD balance`);
    assert.ok(text.includes("81.82") || text.includes("81.8190"), `${component} did not display correct CNY balance`);
    assert.ok(text.includes("1¥=4$") || text.includes("1¥ = $4.00"), `${component} did not display exchange rate`);
  }
});

test("wallet balance copy copies USD amount to clipboard", async () => {
  for (const value of [null, undefined, NaN]) {
    const env = environment(); env.authContext.wallet = rawWallet({ quota_usd: value });
    const h = await ready("AccountBalanceCard", env);
    const copy = findByTitle(h.tree, "复制美元余额");
    assert.equal(copy.props.disabled, true);
    await copy.props.onClick();
    assert.equal(env.clipboard.length, 0);
  }
  const env = environment();
  env.authContext.wallet = rawWallet({ quota_usd: 327.2761 });
  const h = await ready("AccountBalanceCard", env);
  await findByTitle(h.tree, "复制美元余额").props.onClick();
  assert.deepEqual(env.clipboard, ["327.2761"]);
  env.authContext.wallet = rawWallet({ quota_usd: 0 }); h.render();
  await findByTitle(h.tree, "复制美元余额").props.onClick();
  assert.deepEqual(env.clipboard, ["327.2761", "0.0000"]);
});

test("failed wallet refresh clears unknown balance and cannot announce successful synchronization", async () => {
  const env = environment(); env.authContext.refreshWallet = async () => false;
  const h = await ready("AccountBalanceCard", env);
  findByTitle(h.tree, "刷新额度").props.onClick(); await settle(h);
  assert.equal(env.notices.some(([kind]) => kind === "success"), false);
  assert.ok(env.notices.some(([kind]) => kind === "error"));
  const provider = await ready("AuthProvider");
  provider.env.impl.getAuthState = () => auth(1);
  provider.env.impl.getUserWallet = () => rawWallet();
  provider.capture.onLoginSuccess(auth(1).user); await settle(provider);
  provider.env.impl.getUserWallet = () => { throw "Test wallet unavailable"; };
  assert.equal(await provider.capture.refreshWallet(), false); await settle(provider);
  assert.equal(provider.capture.wallet, null);
  assert.ok(provider.capture.walletError.includes("unavailable"));
});

test("usage logs show cost in USD and CNY at 1:4 rate and 500k points per USD", async () => {
  const env = environment();
  const log = { id: 1, created_at: 1, model_name: "test-model", token_name: "fake-token",
    quota: 1250, prompt_tokens: 1, completion_tokens: 2, use_time: 1 };
  env.impl.getUserUsageLogs = () => ({ items: [log], total: 1, page: 1, page_size: 20 });
  const h = await ready("UsageLogsPanel", env);
  const text = textOf(h.tree);
  assert.ok(text.includes("0.0025"), "Did not show USD cost for 1250 points");
  assert.ok(text.includes("0.0006"), "Did not show CNY cost");
});

test("shared pricing rejects missing/invalid/expired/future rates and requires high-rate acknowledgement", async () => {
  const h = await ready("TokenSelectModal");
  const { createGroupPricing, getValidGroupRatio, getGroupSwitchError, GROUP_PRICING_MAX_AGE_MS } = h.groupPricing;
  for (const ratio of [0, -1, NaN, Infinity, "1"])
    assert.equal(getValidGroupRatio(createGroupPricing(pricing(ratio), 100), "target", 100), null);
  const valid = createGroupPricing(pricing(2), 100);
  assert.equal(getValidGroupRatio(valid, "target", 99), null);
  assert.equal(getValidGroupRatio(valid, "target", 100 + GROUP_PRICING_MAX_AGE_MS), null);
  assert.equal(getValidGroupRatio(valid, "missing", 100), null);
  assert.ok(getGroupSwitchError(valid, "target", false, 100));
  assert.equal(getGroupSwitchError(valid, "target", true, 100), null);
  assert.equal(getValidGroupRatio(createGroupPricing({ ...pricing(), success: false }, 100), "target", 100), null);
});

test("token list late success/error cannot refill a closed window or overwrite a newer request", async () => {
  const env = environment(), old = deferred(), current = deferred();
  env.impl.getUserTokens = () => old.promise;
  const h = new Harness("TokenSelectModal", env); h.flush();
  env.impl.getUserTokens = () => current.promise;
  const refresh = h.capture.loadTokens();
  current.resolve([{ ...fakeToken, id: 22 }]); await refresh; await settle(h);
  old.reject(new Error("old error")); await settle(h);
  assert.equal(h.capture.tokens[0].id, 22); assert.equal(h.capture.errorMsg, null);
  const late = deferred(); env.impl.getUserTokens = () => late.promise;
  const pending = h.capture.loadTokens(); h.capture.handleSmoothClose(); h.flush();
  late.resolve([fakeToken]); await pending; await settle(h);
  assert.equal(h.capture.tokens.length, 0); assert.equal(h.capture.loading, false);
});

test("copy closes before fake key returns: no plaintext cache, clipboard, or stale notification", async () => {
  const h = await ready("TokenSelectModal"), key = deferred();
  h.env.impl.getTokenKey = () => key.promise;
  const pending = h.capture.handleCopyKey(fakeToken);
  h.capture.handleSmoothClose(); h.flush(); key.resolve("sk-fake-delayed"); await pending; await settle(h);
  assert.equal(Object.keys(h.capture.revealedKeys).length, 0);
  assert.equal(h.env.clipboard.length, 0); assert.equal(h.env.notices.length, 0);
});

test("successful copy uses fake clipboard and expiry cleanup without caching plaintext", async () => {
  const h = await ready("TokenSelectModal"); await h.capture.handleCopyKey(fakeToken); await settle(h);
  assert.equal(h.env.clipboard[0], "sk-fake-test-only");
  assert.equal(h.env.clipboardCleanup[0], "sk-fake-test-only");
  assert.equal(Object.keys(h.capture.revealedKeys).length, 0);
});

test("partial token sync cannot mark the current failed tool as bound through its callback", async () => {
  const h = await ready("TokenSelectModal"); h.env.impl.applyApiKeyToAgents = () => ({ chatgpt: false, claude: true });
  await h.capture.handleApplyToAll(fakeToken); await settle(h);
  assert.equal(h.selected.length, 0); assert.equal(h.env.storage.has("bound_token_chatgpt"), false);
  assert.ok(h.env.storage.has("bound_token_claude"));
  const event = h.env.events.find((item) => item.type === "ai_helper_sync_all_tokens");
  assert.equal(event.detail.toolIds.join(","), "claude");
});

test("reveal and stale event callbacks cannot survive an auth-session change or reopen", async () => {
  const h = await ready("TokenSelectModal"), key = deferred(), oldHandlers = h.capture;
  h.env.impl.getTokenKey = () => key.promise;
  const pending = oldHandlers.handleToggleReveal(fakeToken);
  h.env.changeAuth(2); h.render(); key.resolve("sk-fake-old-account"); await pending; await settle(h);
  assert.equal(Object.keys(h.capture.revealedKeys).length, 0);
  const before = h.env.count("getTokenKey");
  await oldHandlers.handleCopyKey(fakeToken);
  assert.equal(h.env.count("getTokenKey"), before); assert.equal(h.env.clipboard.length, 0);
});

for (const action of ["handleSelectToken", "handleApplyToAll"]) {
  for (const stopAt of ["getTokenKey", "setSelectedToken", ...(action === "handleApplyToAll" ? ["applyApiKeyToAgents"] : [])]) {
    test(`${action}: close while ${stopAt} awaits stops subsequent side effects`, async () => {
      const h = await ready("TokenSelectModal"), wait = deferred();
      h.env.impl[stopAt] = () => wait.promise;
      const pending = h.capture[action](fakeToken); await settle(h);
      h.capture.handleSmoothClose(); h.flush();
      wait.resolve(stopAt === "getTokenKey" ? "sk-fake-only" : { chatgpt: true });
      await pending; await settle(h);
      assert.equal(h.selected.length, 0); assert.equal(h.env.storage.size, 0);
      if (stopAt === "getTokenKey") assert.equal(h.env.count("setSelectedToken"), 0);
      if (stopAt !== "applyApiKeyToAgents") assert.equal(h.env.count("applyApiKeyToAgents"), 0);
    });
  }
}

for (const action of ["handleCopyKey", "handleToggleReveal", "handleSelectToken", "handleApplyToAll"]) {
  test(`${action}: obsolete key failure cannot notify or mutate the new account`, async () => {
    const h = await ready("TokenSelectModal"), wait = deferred();
    h.env.impl.getTokenKey = () => wait.promise;
    const pending = h.capture[action](fakeToken);
    h.env.changeAuth(2); h.render(); wait.reject("fake old-account error"); await pending; await settle(h);
    assert.equal(h.env.notices.length, 0); assert.equal(h.env.clipboard.length, 0);
    assert.equal(Object.keys(h.capture.revealedKeys).length, 0);
    assert.equal(h.capture.fetchingKeyId, null); assert.equal(h.capture.syncingKeyId, null);
  });
}

test("pricing and fallback group responses cannot repopulate a closed editor", async () => {
  const h = await ready("TokenSelectModal"), wait = deferred();
  h.env.impl.getPricingData = () => Promise.reject("fake pricing failure");
  h.env.impl.getUserAvailableGroups = () => wait.promise;
  const pending = h.capture.handleOpenEditGroup(fakeToken); await settle(h);
  h.capture.handleCloseEditGroup(); h.flush(); wait.resolve(["old-private-group"]); await pending; await settle(h);
  assert.equal(h.capture.availableGroups.length, 0); assert.equal(h.capture.pricingInfo.loadedAt, null);
  assert.equal(h.capture.editingGroupToken, null);
});

async function tokenEditor(env = environment()) {
  const h = await ready("TokenSelectModal", env);
  await h.capture.handleOpenEditGroup(fakeToken); await settle(h);
  h.capture.setSelectedNewGroup("target"); h.flush();
  return h;
}

test("token group submit rechecks expiry and high-rate confirmation; a valid request succeeds", async () => {
  const env = environment(); env.impl.getPricingData = () => pricing(2);
  const h = await tokenEditor(env);
  await assert.rejects(h.capture.handleSaveTokenGroup()); assert.equal(env.count("updateUserTokenGroup"), 0);
  h.capture.setRateConfirmed(true); h.flush();
  env.now += 5 * 60 * 1000;
  await assert.rejects(h.capture.handleSaveTokenGroup()); assert.equal(env.count("updateUserTokenGroup"), 0);
  await h.capture.handleOpenEditGroup(fakeToken); await settle(h);
  h.capture.setSelectedNewGroup("target"); h.capture.setRateConfirmed(true); h.flush();
  await h.capture.handleSaveTokenGroup(); assert.equal(env.count("updateUserTokenGroup"), 1);
});

test("cloud group success after close stays success but cannot update local metadata or a new editor", async () => {
  const h = await tokenEditor(), wait = deferred();
  const oldButton = buttons(h.tree).find((button) => button.onAction === h.capture.handleSaveTokenGroup);
  h.env.impl.updateUserTokenGroup = () => wait.promise;
  const pending = h.capture.handleSaveTokenGroup(); h.capture.handleCloseEditGroup(); h.flush();
  await h.capture.handleOpenEditGroup({ ...fakeToken, id: 22 }); await settle(h);
  wait.resolve({ ...fakeToken, group: "target" }); await pending; await settle(h);
  oldButton.onBusyChange(false); oldButton.onComplete(); h.flush();
  assert.equal(h.capture.editingGroupToken.id, 22); assert.equal(h.env.storage.size, 0);
  assert.equal(h.env.events.filter((event) => event.type === "ai_helper_group_updated").length, 0);
});

async function monitorEditor(env = environment()) {
  const h = await ready("ChannelGroupMonitor", env);
  await h.capture.handleInitiateSwitchGroup("target"); await settle(h);
  return h;
}

function monitorBindingEnvironment() {
  const env = environment();
  env.storage.set("bound_token_chatgpt", JSON.stringify({ id: 11, name: "tool-bound-A", group: "default" }));
  env.authContext.authState = { ...auth(1), selected_token_id: 22 };
  env.impl.getUserTokens = () => [{ ...fakeToken, id: 22, name: "other-tool-B" }, fakeToken];
  return env;
}

test("monitor preserves the current tool binding and defaults to A instead of globally selected B", async () => {
  const env = monitorBindingEnvironment();
  const h = await ready("ChannelGroupMonitor", env);
  assert.equal(h.capture.boundTokenInfo.id, 11);
  await h.capture.handleInitiateSwitchGroup("target"); await settle(h);
  assert.equal(h.capture.switchModalState.selectedTokenId, 11);
});

test("monitor effect cleanup/setup replay keeps the same account's tool binding", async () => {
  const h = await ready("ChannelGroupMonitor", monitorBindingEnvironment());
  h.replayEffects(); await settle(h);
  assert.equal(h.capture.boundTokenInfo.id, 11);
  await h.capture.handleInitiateSwitchGroup("target"); await settle(h);
  assert.equal(h.capture.switchModalState.selectedTokenId, 11);
});

test("monitor does not substitute another account's B when bound A is absent", async () => {
  const env = monitorBindingEnvironment();
  const h = await ready("ChannelGroupMonitor", env);
  env.changeAuth(2);
  env.impl.getUserTokens = () => [{ ...fakeToken, id: 22, name: "account-B-key" }];
  h.render(); await settle(h);
  assert.equal(h.capture.boundTokenInfo, null);
  await h.capture.handleInitiateSwitchGroup("target"); await settle(h);
  assert.equal(h.capture.switchModalState.selectedTokenId, undefined);
  assert.ok(h.capture.switchModalState.errorMessage.includes("请明确选择"));
  await assert.rejects(h.capture.handleConfirmSwitchGroup());
  assert.equal(env.count("updateUserTokenGroup"), 0);
});

test("monitor verifies the bound token's full key before choosing it for a configured tool", async () => {
  const env = monitorBindingEnvironment();
  env.impl.getTokenKey = () => "sk-fake-current-tool";
  const h = await ready("ChannelGroupMonitor", env, { configuredKey: "sk-fake-current-tool", hasConfiguredKey: true });
  await h.capture.handleInitiateSwitchGroup("target"); await settle(h);
  assert.equal(h.capture.switchModalState.selectedTokenId, 11);
  assert.equal(env.calls.get("getTokenKey")[0][0], 11);
});

test("monitor requires an explicit selection when the saved binding does not match the configured key", async () => {
  const env = monitorBindingEnvironment();
  env.impl.getTokenKey = () => "sk-fake-different-key";
  const h = await ready("ChannelGroupMonitor", env, { configuredKey: "sk-fake-current-tool", hasConfiguredKey: true });
  await h.capture.handleInitiateSwitchGroup("target"); await settle(h);
  assert.equal(h.capture.switchModalState.selectedTokenId, undefined);
  assert.ok(h.capture.switchModalState.errorMessage.includes("重新关联"));
});

test("monitor key verification cannot complete after the current tool key changes", async () => {
  const env = monitorBindingEnvironment(), wait = deferred();
  env.impl.getTokenKey = () => wait.promise;
  const h = await ready("ChannelGroupMonitor", env, { configuredKey: "sk-fake-current-tool", hasConfiguredKey: true });
  const pending = h.capture.handleInitiateSwitchGroup("target"); await settle(h);
  h.render({ configuredKey: "sk-fake-replacement-tool" });
  wait.resolve("sk-fake-current-tool"); await pending; await settle(h);
  assert.equal(h.capture.switchModalState.open, false);
  assert.equal(h.capture.switchModalState.selectedTokenId, undefined);
});

test("monitor may use the global default only when no tool credential or binding exists", async () => {
  const env = environment();
  env.authContext.authState = { ...auth(1), selected_token_id: 22 };
  env.impl.getUserTokens = () => [fakeToken, { ...fakeToken, id: 22 }];
  const h = await ready("ChannelGroupMonitor", env);
  await h.capture.handleInitiateSwitchGroup("target"); await settle(h);
  assert.equal(h.capture.switchModalState.selectedTokenId, 22);
});

test("monitor refresh immediately invalidates rates; failure cannot reuse old cheap pricing", async () => {
  const h = await monitorEditor(), wait = deferred();
  h.env.impl.getPricingData = () => wait.promise;
  const oldSubmit = h.capture.handleConfirmSwitchGroup;
  const refresh = h.capture.loadData(true);
  await assert.rejects(oldSubmit()); assert.equal(h.env.count("updateUserTokenGroup"), 0);
  wait.reject("fake price outage"); await refresh; await settle(h);
  assert.equal(h.capture.pricingInfo.loadedAt, null);
  await assert.rejects(h.capture.handleConfirmSwitchGroup()); assert.equal(h.env.count("updateUserTokenGroup"), 0);
});

test("monitor blocks nonpositive, expired and unconfirmed high rates", async () => {
  for (const ratio of [0, -1, Infinity, 2]) {
    const env = environment(); env.impl.getPricingData = () => pricing(ratio);
    const h = await monitorEditor(env);
    await assert.rejects(h.capture.handleConfirmSwitchGroup()); assert.equal(env.count("updateUserTokenGroup"), 0);
  }
  const h = await monitorEditor(); h.env.now += 5 * 60 * 1000;
  await assert.rejects(h.capture.handleConfirmSwitchGroup()); assert.equal(h.env.count("updateUserTokenGroup"), 0);
});

test("monitor accepts confirmed high pricing and invalidates the acknowledgement on refresh", async () => {
  const env = environment(); env.impl.getPricingData = () => pricing(2);
  const h = await monitorEditor(env);
  h.capture.setSwitchModalState((previous) => ({ ...previous, ackHighRatio: true })); h.flush();
  await h.capture.handleConfirmSwitchGroup(); assert.equal(env.count("updateUserTokenGroup"), 1);
  await h.capture.loadData(true); await settle(h);
  assert.equal(h.capture.switchModalState.ackHighRatio, false);
  await assert.rejects(h.capture.handleConfirmSwitchGroup()); assert.equal(env.count("updateUserTokenGroup"), 1);
});

test("monitor old pricing response and old button callbacks cannot refill a different account", async () => {
  const h = await monitorEditor(), wait = deferred();
  const oldButton = buttons(h.tree).find((button) => button.onAction === h.capture.handleConfirmSwitchGroup);
  h.env.impl.getPricingData = () => wait.promise;
  const pending = h.capture.loadData(true);
  h.env.changeAuth(2); h.render(); h.env.impl.getPricingData = () => pricing(3);
  await h.capture.loadData(true); await settle(h);
  wait.resolve(pricing(0.1)); await pending; await settle(h);
  oldButton.onBusyChange(true); oldButton.onComplete(); h.flush();
  assert.equal(h.capture.pricingInfo.groupRatio.target, 3);
  assert.equal(h.capture.switchModalState.open, false); assert.equal(h.capture.switchModalState.isSubmitting, false);
});

test("monitor token-list completion after close cannot refill the modal", async () => {
  const h = await ready("ChannelGroupMonitor"), wait = deferred(); h.env.impl.getUserTokens = () => wait.promise;
  const pending = h.capture.handleInitiateSwitchGroup("target"); h.capture.handleCloseSwitchModal(); h.flush();
  wait.resolve([fakeToken]); await pending; await settle(h);
  assert.equal(h.capture.switchModalState.open, false); assert.equal(h.capture.switchModalState.tokensList.length, 0);
});

test("monitor cloud mutation already sent is not reported as cancelled after account change", async () => {
  const h = await monitorEditor(), wait = deferred(); h.env.impl.updateUserTokenGroup = () => wait.promise;
  h.capture.setSwitchModalState((previous) => ({ ...previous, syncToAllAgents: true })); h.flush();
  const pending = h.capture.handleConfirmSwitchGroup(); h.env.changeAuth(2); h.render();
  wait.resolve({ ...fakeToken, group: "target" }); await pending; await settle(h);
  assert.equal(h.env.count("updateUserTokenGroup"), 1); assert.equal(h.env.count("getTokenKey"), 0);
  assert.equal(h.env.storage.size, 0); assert.equal(h.capture.switchModalState.open, false);
});

test("monitor partial local-sync failure preserves cloud success and only binds successful tools", async () => {
  const h = await monitorEditor(); h.env.impl.applyApiKeyToAgents = () => ({ chatgpt: true, claude: false });
  h.capture.setSwitchModalState((previous) => ({ ...previous, syncToAllAgents: true })); h.flush();
  await h.capture.handleConfirmSwitchGroup(); await settle(h);
  assert.equal(h.env.count("updateUserTokenGroup"), 1);
  assert.ok(h.env.storage.has("bound_token_chatgpt")); assert.equal(h.env.storage.has("bound_token_claude"), false);
  assert.ok(h.env.notices.some(([kind, message]) => kind === "warning" && message.includes("云端分组已修改")));
});

test("failed session restore prompts relogin once and never displays a logged-in account", async () => {
  const h = await ready("AuthProvider");
  const failure = { ...auth(null), session_restore_error: "Test session restore requires login" };
  h.env.impl.getAuthState = () => failure;
  await h.capture.refreshState(); await settle(h);
  await h.capture.refreshState(); await settle(h);
  assert.equal(h.capture.authState.is_logged_in, false);
  assert.equal(h.env.notices.length, 1);
  const [kind, message, options] = h.env.notices[0];
  assert.equal(kind, "error"); assert.equal(message, failure.session_restore_error);
  options.action.onClick(); h.flush();
  assert.equal(h.capture.loginModalOpen, true);
  h.env.impl.getAuthState = () => auth(null);
  await h.capture.refreshState(); await settle(h);
  h.env.impl.getAuthState = () => failure;
  await h.capture.refreshState(); await settle(h);
  assert.equal(h.env.notices.length, 2);
});

test("A-to-B login with logged_in unchanged fetches and accepts B wallet", async () => {
  const h = await ready("AuthProvider"); let account = 1;
  h.env.impl.getAuthState = () => auth(account); h.env.impl.getUserWallet = () => ({ owner: account });
  h.capture.onLoginSuccess(auth(1).user); await settle(h); assert.equal(h.capture.wallet.owner, 1);
  account = 2; h.capture.onLoginSuccess(auth(2).user); await settle(h);
  assert.equal(h.capture.authState.user.id, 2); assert.equal(h.capture.wallet.owner, 2);
});

test("old wallet error/finally cannot clear B wallet loading or trigger B auth refresh", async () => {
  const h = await ready("AuthProvider"), old = deferred(), current = deferred(); let account = 1;
  h.env.impl.getAuthState = () => auth(account);
  h.env.impl.getUserWallet = () => account === 1 ? old.promise : current.promise;
  h.capture.onLoginSuccess(auth(1).user); await settle(h);
  account = 2; h.capture.onLoginSuccess(auth(2).user); await settle(h);
  const authReads = h.env.count("getAuthState"); old.reject("Unauthorized old account"); await settle(h);
  assert.equal(h.capture.isLoadingWallet, true); assert.equal(h.capture.walletError, null);
  assert.equal(h.env.count("getAuthState"), authReads);
  current.resolve({ owner: 2 }); await settle(h); assert.equal(h.capture.wallet.owner, 2);
});

test("older auth reads and wallet role refresh cannot overwrite a newer login", async () => {
  const h = await ready("AuthProvider"), older = deferred(), newer = deferred();
  h.env.impl.getAuthState = () => older.promise; const oldRead = h.capture.refreshState();
  h.env.impl.getAuthState = () => newer.promise; const newRead = h.capture.refreshState();
  newer.resolve(auth(2)); await newRead; await settle(h);
  older.resolve(auth(1)); await oldRead; await settle(h); assert.equal(h.capture.authState.user.id, 2);
  const roleRead = deferred(); h.env.impl.getAuthState = () => roleRead.promise;
  const walletRead = h.capture.refreshWallet(); await settle(h);
  h.env.impl.getAuthState = () => auth(3); h.capture.onLoginSuccess(auth(3).user); await settle(h);
  roleRead.resolve(auth(2)); await walletRead; await settle(h); assert.equal(h.capture.authState.user.id, 3);
});

test("pending logout blocks auth refresh from restoring the old session; same-user relog invalidates old callbacks", async () => {
  const h = await ready("AuthProvider"); h.env.impl.getAuthState = () => auth(1);
  h.capture.onLoginSuccess(auth(1).user); await settle(h);
  const oldWalletCallback = h.capture.refreshWallet;
  h.capture.onLoginSuccess(auth(1).user); await settle(h);
  const beforeWallet = h.env.count("getUserWallet"); await oldWalletCallback();
  assert.equal(h.env.count("getUserWallet"), beforeWallet);
  const wait = deferred(); h.env.impl.logoutAccount = () => wait.promise;
  const pending = h.capture.logout(); h.flush(); const beforeAuth = h.env.count("getAuthState");
  await h.capture.refreshState(); assert.equal(h.env.count("getAuthState"), beforeAuth);
  assert.equal(h.capture.authState.is_logged_in, false);
  h.env.impl.getAuthState = () => auth(null); wait.resolve(); await pending; await settle(h);
  assert.equal(h.capture.authState.is_logged_in, false);
});

test("unmounted wallet and token requests cannot apply results", async () => {
  const token = await ready("TokenSelectModal"), key = deferred(); token.env.impl.getTokenKey = () => key.promise;
  const copy = token.capture.handleCopyKey(fakeToken); token.unmount(); key.resolve("sk-fake-unmounted"); await copy;
  assert.equal(token.env.clipboard.length, 0);
  const h = await ready("AuthProvider"), wallet = deferred(); h.env.impl.getAuthState = () => auth(1);
  h.env.impl.getUserWallet = () => wallet.promise; h.capture.onLoginSuccess(auth(1).user); await settle(h);
  h.unmount(); wallet.resolve({ owner: "unmounted" }); await settle(h);
  assert.equal(h.capture.wallet, null);
});

async function credentialInput(env = environment()) {
  env.impl.getUserTokens = () => [];
  const h = await ready("ApiKeyInput", env); env.advance(150); await settle(h);
  return h;
}

test("unknown credential displays an explicit destination confirmation and updates only after success", async () => {
  const h = await credentialInput();
  const button = findButton(h.tree, "确认用于此节点"); assert.ok(button, "confirmation button must be reachable");
  button.props.onClick(); await settle(h);
  assert.equal(h.env.count("confirmCredentialDestination"), 1);
  assert.equal(h.capture.credentialStatus.authorized, true);
  assert.equal(h.env.events.filter((event) => event.type === "ai_helper_credential_authorized").length, 1);
  assert.equal(findButton(h.tree, "确认用于此节点"), undefined);
});

for (const changed of [{ value: "sk-fake-replacement" }, { destinationUrl: "https://other-fake.example/v1" }]) {
  test(`credential confirmation does not send a grant when ${Object.keys(changed)[0]} changes before the click or effects`, async () => {
    const h = await credentialInput();
    const oldConfirm = h.capture.handleConfirmDestination;
    assert.equal(h.capture.credentialStatus.can_confirm, true);
    // Render the changed input while retaining the old status state. This
    // deliberately leaves passive effect cleanup pending, as in the UI race.
    h.renderBeforeEffects(changed);
    assert.equal(h.capture.credentialStatus.can_confirm, true);
    assert.equal(findButton(h.tree, "确认用于此节点"), undefined);
    await oldConfirm();
    await h.capture.handleConfirmDestination();
    assert.equal(h.env.count("confirmCredentialDestination"), 0);
    assert.equal(h.env.events.filter((event) => event.type === "ai_helper_credential_authorized").length, 0);
    assert.equal(h.env.notices.length, 0);
    h.commitEffects();
    assert.equal(h.capture.credentialStatus, null);
    assert.equal(h.capture.confirmingDestination, false);
  });

  test(`credential confirmation ignores an old success after ${Object.keys(changed)[0]} changes`, async () => {
    const h = await credentialInput(), wait = deferred(); h.env.impl.confirmCredentialDestination = () => wait.promise;
    const pending = h.capture.handleConfirmDestination(); h.render(changed);
    wait.resolve({ source: "external", authorized: true, can_confirm: false, origin: "https://fake.example" });
    await pending; await settle(h);
    assert.equal(h.capture.credentialStatus, null); assert.equal(h.capture.confirmingDestination, false);
    assert.equal(h.env.events.filter((event) => event.type === "ai_helper_credential_authorized").length, 0);
    assert.equal(h.env.notices.length, 0); assert.equal(h.changed.length, 0);
  });

  test(`old credential offer cannot confirm a replacement ${Object.keys(changed)[0]} after its new status arrives`, async () => {
    const h = await credentialInput();
    const oldConfirm = h.capture.handleConfirmDestination;
    h.render(changed);
    h.env.advance(150); await settle(h);
    assert.equal(h.capture.credentialStatus.can_confirm, true);
    assert.ok(findButton(h.tree, "确认用于此节点"));
    await oldConfirm(); await settle(h);
    assert.equal(h.env.count("confirmCredentialDestination"), 0);
    assert.equal(h.env.events.filter((event) => event.type === "ai_helper_credential_authorized").length, 0);
    // Only the handler belonging to the newly displayed offer may grant it.
    await h.capture.handleConfirmDestination(); await settle(h);
    assert.equal(h.env.count("confirmCredentialDestination"), 1);
    assert.deepEqual(h.env.calls.get("confirmCredentialDestination")[0], [h.props.value, h.props.destinationUrl]);
    assert.equal(h.capture.credentialStatus.authorized, true);
    assert.equal(h.env.events.filter((event) => event.type === "ai_helper_credential_authorized").length, 1);
  });
}

test("managed credential at a forbidden external destination never offers BYOK confirmation", async () => {
  const env = environment(); env.impl.getCredentialStatus = () => ({ source: "managed", authorized: false,
    can_confirm: false, origin: "https://fake.example", message: "fake managed destination is forbidden" });
  const h = await credentialInput(env);
  assert.equal(findButton(h.tree, "确认用于此节点"), undefined);
  assert.ok(textOf(h.tree).includes("fake managed destination is forbidden"));
  assert.equal(env.count("confirmCredentialDestination"), 0);
});

test("credential sync events affect only toolIds that actually succeeded", async () => {
  const h = await credentialInput();
  h.env.window.dispatchEvent({ type: "ai_helper_sync_all_tokens", detail: { id: 11, name: "fake", toolIds: ["claude"] } });
  await settle(h); assert.equal(h.env.count("getTokenKey"), 0); assert.equal(h.changed.length, 0);
  h.env.window.dispatchEvent({ type: "ai_helper_sync_all_tokens", detail: { id: 11, name: "fake", toolIds: ["chatgpt"] } });
  await settle(h); assert.equal(h.env.count("getTokenKey"), 1); assert.equal(h.changed[0], "sk-fake-test-only");
});

test("credential confirmation cannot authorize after the auth session changes", async () => {
  const h = await credentialInput(), wait = deferred(); h.env.impl.confirmCredentialDestination = () => wait.promise;
  const pending = h.capture.handleConfirmDestination(); h.env.changeAuth(2); h.render();
  wait.resolve({ authorized: true }); await pending; await settle(h);
  assert.equal(h.capture.credentialStatus, null);
  assert.equal(h.env.events.filter((event) => event.type === "ai_helper_credential_authorized").length, 0);
});

test("credential sync key response cannot overwrite a manually replaced input", async () => {
  const h = await credentialInput(), wait = deferred(); h.env.impl.getTokenKey = () => wait.promise;
  h.env.window.dispatchEvent({ type: "ai_helper_sync_all_tokens", detail: { id: 11, name: "fake", toolIds: ["chatgpt"] } });
  h.render({ value: "sk-fake-manually-edited" }); wait.resolve("sk-fake-old-sync"); await settle(h);
  assert.equal(h.changed.length, 0);
});

test("credential sync keeps the latest event when key responses arrive in reverse order", async () => {
  const h = await credentialInput(), old = deferred(), current = deferred();
  h.env.impl.getTokenKey = (id) => id === 11 ? old.promise : current.promise;
  h.env.window.dispatchEvent({ type: "ai_helper_sync_all_tokens", detail: { id: 11, name: "fake-old", toolIds: ["chatgpt"] } });
  h.env.window.dispatchEvent({ type: "ai_helper_sync_all_tokens", detail: { id: 22, name: "fake-new", toolIds: ["chatgpt"] } });
  current.resolve("sk-fake-latest-sync"); await settle(h);
  old.resolve("sk-fake-old-sync"); await settle(h);
  assert.deepEqual(h.changed, ["sk-fake-latest-sync"]);
});

for (const nextAccount of [2, 1]) {
  test(`real bound-token hook drops a late list response after ${nextAccount === 1 ? "same-user relogin" : "A-to-B login"}`, async () => {
    const env = environment(), old = deferred();
    env.impl.getUserTokens = () => old.promise;
    const h = new Harness("BoundTokenGroupHost", env); h.flush();
    env.changeAuth(nextAccount);
    env.impl.getUserTokens = () => [];
    h.render();
    old.resolve([{ ...fakeToken, key: "sk-fake-input-only", group: "old-account-private-group" }]);
    await settle(h);
    assert.equal(h.capture.group, null);
    assert.equal(env.storage.has("bound_token_chatgpt"), false);
  });
}

test("real bound-token hook invalidates old requests and callbacks on auth event before rerender", async () => {
  const env = environment(), old = deferred();
  env.impl.getUserTokens = () => old.promise;
  const h = new Harness("BoundTokenGroupHost", env); h.flush();
  const oldCallbacks = h.capture;
  env.changeAuth(2);
  oldCallbacks.onBoundTokenChange({ id: 11, name: "old", group: "obsolete-group" });
  env.window.dispatchEvent({ type: "ai_helper_group_updated", detail: { toolId: "chatgpt" } });
  old.resolve([{ ...fakeToken, key: "sk-fake-input-only", group: "old-account-private-group" }]);
  await Promise.resolve(); await Promise.resolve();
  env.impl.getUserTokens = () => [];
  h.render(); await settle(h);
  assert.equal(h.capture.group, null);
  assert.equal(env.storage.has("bound_token_chatgpt"), false);
});

test("real bound-token hook stops plaintext lookup follow-up and writes when the session changes", async () => {
  const env = environment(), key = deferred();
  env.storage.set("bound_token_claude", JSON.stringify({ id: 11, name: "old-other-tool" }));
  env.impl.getUserTokens = () => [{ ...fakeToken, key: "" }];
  env.impl.getTokenKey = () => key.promise;
  const h = await ready("BoundTokenGroupHost", env);
  assert.equal(env.count("getTokenKey"), 1);
  env.changeAuth(2); env.impl.getUserTokens = () => [];
  h.render();
  key.resolve("sk-fake-input-only"); await settle(h);
  assert.equal(h.capture.group, null);
  assert.equal(env.storage.has("bound_token_chatgpt"), false);
  assert.equal(env.count("getTokenKey"), 1);
});

test("real bound-token hook ignores a key result after unmount", async () => {
  const env = environment(), key = deferred();
  env.impl.getUserTokens = () => [{ ...fakeToken, key: "" }];
  env.impl.getTokenKey = () => key.promise;
  const h = await ready("BoundTokenGroupHost", env);
  h.unmount(); key.resolve("sk-fake-input-only"); await Promise.resolve(); await Promise.resolve();
  assert.equal(env.storage.has("bound_token_chatgpt"), false);
});

test("real bound-token hook commits a current match after effect cleanup/setup replay", async () => {
  const env = environment(), old = deferred();
  env.impl.getUserTokens = () => old.promise;
  const h = new Harness("BoundTokenGroupHost", env); h.flush();
  env.impl.getUserTokens = () => [{ ...fakeToken, key: "sk-fake-input-only", group: "current-group" }];
  h.replayEffects(); await settle(h);
  old.resolve([{ ...fakeToken, key: "sk-fake-input-only", group: "obsolete-group" }]);
  await settle(h);
  assert.equal(h.capture.group, "current-group");
  assert.equal(JSON.parse(env.storage.get("bound_token_chatgpt")).group, "current-group");
});

let failed = 0;
for (const { name, run } of tests) {
  try { await run(); console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}\n${error.stack}`); }
}
console.log(`${tests.length - failed}/${tests.length} frontend security behavior checks passed`);
if (failed) process.exitCode = 1;
