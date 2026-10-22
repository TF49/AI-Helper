// Parse the checked-in workflows and exercise their release preflight with fake
// HTTP responses. No GitHub request, credential store or release is touched.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument, stringify } from "yaml";
import { checkReleaseAvailability, releaseIdentity } from "./check-release.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowDir = path.join(root, ".github/workflows");
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const array = (value) => Array.isArray(value) ? value : value === undefined ? [] : [value];
const steps = (job) => Array.isArray(job?.steps) ? job.steps : [];
const code = (step) => String(step?.run ?? "").replace(/^\s*#.*$/gm, "").replace(/(?:\\|`)\r?\n/g, " ");
const runs = (job, pattern) => steps(job).some((step) => pattern.test(code(step)));
const owns = (value, key) => object(value) && Object.hasOwn(value, key);

function parseWorkflow(source, name) {
  const document = parseDocument(source, { strict: true, uniqueKeys: true });
  assert.equal(document.errors.length, 0, `${name}: ${document.errors.map((error) => error.message).join("; ")}`);
  const value = document.toJS({ maxAliasCount: 100 });
  assert.ok(object(value) && object(value.jobs), `${name}: workflow jobs must be a mapping`);
  return value;
}

// A positional Cargo filter silently drops most tests. Accept only the flags
// needed for a complete locked library run, plus harmless execution options.
function fullLibraryRun(step) {
  if (step.if !== undefined) return false;
  return [...code(step).matchAll(/\bcargo\s+test\s+([^\r\n]+)/g)].some((match) => {
    const separator = /\s+--(?:\s+|$)/.exec(match[1]);
    const cargo = separator ? match[1].slice(0, separator.index) : match[1];
    const harness = separator ? match[1].slice(separator.index + separator[0].length) : "";
    const harnessTokens = (harness.match(/"[^"]*"|'[^']*'|\S+/g) ?? [])
      .map((token) => token.replace(/^["']|["']$/g, ""));
    for (let index = 0; index < harnessTokens.length; index += 1) {
      const token = harnessTokens[index];
      if (token === "--test-threads") {
        if (!/^[1-9]\d*$/.test(harnessTokens[++index] ?? "")) return false;
      } else if (!/^--test-threads=[1-9]\d*$/.test(token)
        && !["--nocapture", "--show-output", "--quiet", "-q"].includes(token)) {
        return false;
      }
    }
    const tokens = cargo.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
    let manifest = false;
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token === "--manifest-path") {
        manifest = tokens[++index]?.replace(/^["']|["']$/g, "") === "src-tauri/Cargo.toml";
        if (!manifest) return false;
      } else if (!["--locked", "--lib", "--offline", "--release", "--quiet", "-q"].includes(token)) {
        return false;
      }
    }
    return manifest && tokens.includes("--locked") && tokens.includes("--lib");
  });
}

function validate(snapshot) {
  const issues = [];
  let checks = 0;
  const require = (condition, rule, detail) => {
    checks += 1;
    if (!condition) issues.push(`${rule}: ${detail}`);
  };
  const workflows = snapshot.workflows;
  for (const [name, workflow] of Object.entries(workflows)) {
    for (const [jobName, job] of Object.entries(workflow.jobs ?? {})) {
      for (const [label, node] of [[jobName, job], ...steps(job).map((step, index) => [`${jobName}.steps[${index}]`, step])]) {
        if (!owns(node, "uses")) continue;
        const use = node.uses;
        const local = typeof use === "string" && use.startsWith("./") && !use.split("/").includes("..") && !use.includes("@");
        require(local || (typeof use === "string" && /^[^@\s]+@[0-9a-f]{40}$/i.test(use)),
          "action-pin", `${name}:${label} must pin external uses to a full 40-character commit SHA`);
      }
      for (const step of steps(job)) {
        require(!/\bgh\s+release\s+(?:delete(?:-asset)?|upload\b[^\n]*--clobber)\b|(?:^|\s)--clobber\b/m.test(code(step)),
          "immutable-release", `${name}:${jobName} must preserve existing releases and assets`);
      }
    }
  }

  const ci = workflows["ci.yml"] ?? {};
  const frontend = ci.jobs?.frontend;
  const backend = ci.jobs?.backend;
  require(runs(frontend, /\bpnpm\s+(?:run\s+)?test:security\b/), "ci-security", "frontend must execute behavior security tests");
  require(runs(frontend, /\bpnpm\s+(?:run\s+)?test:workflows\b/), "ci-contract", "CI must execute this workflow contract");
  const platforms = array(backend?.strategy?.matrix?.os);
  require([/^windows-/, /^ubuntu-/, /^macos-/].every((platform) => platforms.some((os) => platform.test(os))),
    "ci-platforms", "backend matrix must include Windows, Linux and macOS");
  require(String(backend?.["runs-on"]).includes("matrix.os"), "ci-platforms", "backend runner must use its OS matrix");
  require(steps(backend).some(fullLibraryRun), "ci-full-library", "every backend OS must execute the full locked library suite without a positional filter");
  require(steps(backend).some((step) => step.if === undefined && /\bcargo\s+check\b[^\n]*--lib\b/.test(code(step))),
    "ci-production", "every backend OS must compile the production library");
  require(steps(backend).some((step) => step.if === undefined && /\bcargo\s+clippy\b[^\n]*--all-targets\b[^\n]*-D\s+warnings\b/.test(code(step))),
    "ci-clippy", "every backend OS must lint all targets with warnings denied");
  require(runs(backend, /\bcargo\s+test\b[^\n]*\b(?:native_dpapi|secret_storage::native_windows_tests)\b[^\n]*--ignored\b/),
    "ci-dpapi", "Windows must explicitly execute the ignored synthetic DPAPI tests");
  require(Object.values(ci.jobs ?? {}).some((job) => runs(job, /\bscripts[\\/]test-release-artifacts\.ps1\b/)),
    "ci-release-artifacts", "CI must run the release artifact regression");
  const nativeStep = steps(backend).find((step) => /\bscripts\/test-native-credentials\.sh\b/.test(code(step)));
  const nativeEnv = { ...ci.env, ...backend?.env, ...nativeStep?.env };
  const nativeCondition = String(nativeStep?.if ?? "").replace(/\$\{\{|\}\}/g, "").trim();
  require(Boolean(nativeStep) && ["", "runner.os != 'Windows'"].includes(nativeCondition) && String(nativeEnv.AI_HELPER_NATIVE_CREDENTIAL_TESTS) === "1",
    "ci-native", "both Unix platforms must explicitly enable the isolated native credential runner");
  const native = snapshot.nativeRunner.replace(/^\s*#.*$/gm, "");
  require(/\$\{GITHUB_ACTIONS:-\}/.test(native) && /\$\{AI_HELPER_NATIVE_CREDENTIAL_TESTS:-\}/.test(native)
    && /exit\s+1/.test(native), "native-disposable-guard", "the native runner must reject non-Actions environments and missing opt-in");
  require(/\bdbus-run-session\b/.test(native) && /\bgnome-keyring-daemon\b/.test(native) && /--unlock\b/.test(native)
    && /\bXDG_DATA_HOME=/.test(native) && /\bXDG_CONFIG_HOME=/.test(native) && /\bXDG_RUNTIME_DIR=/.test(native)
    && /\bmktemp\b/.test(native) && /RUNNER_TEMP/.test(native),
  "native-linux-isolation", "Linux native tests need a fresh D-Bus session and temporary XDG credential directories");
  require(/security\s+create-keychain\b/.test(native) && /security\s+unlock-keychain\b/.test(native)
    && /security\s+default-keychain\b[^\n]*-s\b/.test(native) && /security\s+delete-keychain\b/.test(native)
    && /RUNNER_TEMP/.test(native), "native-macos-isolation", "macOS native tests need a disposable unlocked user-default Keychain and cleanup");
  require(!/(?:^|[;\s])(?:export\s+)?HOME\s*=/m.test(native), "native-home", "native isolation must not repoint HOME");
  for (const name of ["native_secret_service", "native_keychain"]) {
    require(new RegExp(`\\bcargo\\s+test\\b[^\\n]*\\b${name}\\b[^\\n]*--ignored\\b`).test(native.replace(/\\\r?\n/g, " ")),
      "native-smoke", `${name} must execute the real ignored backend regression`);
  }
  const pathFilter = steps(ci.jobs?.changes).find((step) => object(step.with) && typeof step.with.filters === "string");
  if (pathFilter) {
    const filters = parseDocument(pathFilter.with.filters).toJS();
    require(array(filters?.frontend).includes("scripts/**"), "ci-paths", "script changes must select frontend workflow/security checks");
  }

  const release = workflows["release.yml"] ?? {};
  const jobs = release.jobs ?? {};
  require(owns(release.on, "workflow_call") && owns(release.on, "workflow_dispatch"),
    "release-entry", "release must support reusable and manual invocation");
  require(array(release.on?.push?.tags).some((tag) => tag === "v*.*.*"), "release-entry", "version tag pushes must retain the complete release pipeline");
  require(release.concurrency?.["cancel-in-progress"] === false, "release-concurrency", "an in-progress release must not be canceled");
  require(release.permissions?.contents === "read" && jobs.publish?.permissions?.contents === "write",
    "release-permissions", "only the publish job may write repository contents");
  const preflight = jobs["check-version"];
  require(Boolean(preflight) && runs(preflight, /\bnode\s+scripts\/check-release\.mjs\b/)
    && typeof preflight.outputs?.should_release === "string" && typeof preflight.outputs?.tag === "string",
  "release-preflight", "release identity and availability must be checked before builds");
  for (const name of ["windows", "macos", "publish"]) {
    const job = jobs[name];
    require(Boolean(job), "release-platforms", `release ${name} job is required`);
    const condition = String(job?.if).replace(/\$\{\{|\}\}/g, "").trim();
    require(array(job?.needs).includes("check-version") && /^needs\.check-version\.outputs\.should_release\s*==\s*'true'$/.test(condition),
      "release-gate", `${name} must skip work when the version already exists`);
  }
  require(/windows/.test(String(jobs.windows?.["runs-on"])), "release-platforms", "Windows release requires a Windows runner");
  require(/macos/.test(String(jobs.macos?.["runs-on"])), "release-platforms", "macOS release requires a macOS runner");
  const targets = array(jobs.macos?.strategy?.matrix?.target);
  require(targets.includes("aarch64-apple-darwin") && targets.includes("x86_64-apple-darwin"),
    "release-platforms", "both macOS architectures must build");
  require(runs(jobs.windows, /\btauri\s+build\b[^\n]*--bundles\s+nsis\b/) && runs(jobs.windows, /\bpackage-release\.ps1\b/),
    "release-packaging", "Windows must build and package its installer");
  require(runs(jobs.macos, /\btauri\s+build\b[^\n]*--target\b[^\n]*matrix\.target[^\n]*--bundles\s+dmg\b/)
    && runs(jobs.macos, /\bpackage-macos\.sh\b/), "release-packaging", "each macOS architecture must build and package its DMG");
  const macosRegression = steps(backend).find((step) => /\bnode\s+scripts\/test-macos-release-artifacts\.mjs\b/.test(code(step)));
  require(Boolean(macosRegression) && /runner\.os\s*==\s*'macOS'/.test(String(macosRegression.if)),
    "release-macos-regression", "macOS CI must validate actual DMG mounting and metadata");
  for (const [jobName, job] of Object.entries(jobs)) {
    for (const step of steps(job)) {
      if (!/\btauri\s+(?:build|signer\s+sign)\b|\b(?:package-release\.ps1|package-macos\.sh|finalize-update-manifest\.ps1|sign-update-file\.ps1)\b/.test(code(step))) continue;
      const env = { ...release.env, ...job.env, ...step.env };
      for (const key of ["TAURI_SIGNING_PRIVATE_KEY", "TAURI_SIGNING_PRIVATE_KEY_PASSWORD"]) {
        require(typeof env[key] === "string" && new RegExp(`^\\$\\{\\{\\s*secrets\\.${key}\\s*\\}\\}$`).test(env[key]),
          "signing-env", `release:${jobName}:${step.name ?? "run"} must receive ${key} from secrets`);
      }
    }
  }
  require(["windows", "macos"].every((name) => array(jobs.publish?.needs).includes(name)),
    "release-join", "publishing must wait for Windows and both macOS artifacts");
  const publishSteps = steps(jobs.publish);
  const download = publishSteps.findIndex((step) => String(step.uses).startsWith("actions/download-artifact@"));
  const finalize = publishSteps.findIndex((step) => /\bfinalize-update-manifest\.ps1\b/.test(code(step)));
  const publish = publishSteps.findIndex((step) => /\bgh\s+release\s+create\b/.test(code(step)));
  require(download >= 0 && finalize > download && publish > finalize, "release-finalize", "downloaded platform assets must be finalized and signed before release creation");
  const finalCheck = publishSteps.findIndex((step) => step.id === "final-check" && /\bnode\s+scripts\/check-release\.mjs\b/.test(code(step)));
  const publishCondition = String(publishSteps[publish]?.if).replace(/\$\{\{|\}\}/g, "").trim();
  require(finalCheck > finalize && finalCheck < publish && /^steps\.final-check\.outputs\.should_release\s*==\s*'true'$/.test(publishCondition),
    "release-final-check", "release availability and tag commit must be checked again immediately before creating a release");
  require(publishSteps.every((step) => !/\bgh\s+release\s+upload\b/.test(code(step))),
    "immutable-release", "release creation must not upload into an existing release");

  const wrapper = workflows["update-release.yml"] ?? {};
  require(array(wrapper.on?.push?.branches).includes("main") && array(wrapper.on?.push?.paths).includes("package.json")
    && !owns(wrapper.on?.push, "tags") && !owns(wrapper.on?.push, "tags-ignore") && owns(wrapper.on, "workflow_dispatch")
    && Object.keys(wrapper.on ?? {}).every((event) => ["push", "workflow_dispatch"].includes(event)),
  "wrapper-trigger", "version changes on main and manual runs must delegate without a second tag trigger");
  const wrapperJobs = Object.values(wrapper.jobs ?? {});
  require(wrapperJobs.length === 1 && wrapperJobs[0].uses === "./.github/workflows/release.yml"
    && wrapperJobs[0].secrets === "inherit" && !owns(wrapperJobs[0], "steps") && !owns(wrapperJobs[0], "runs-on"),
  "wrapper-delegation", "update-release must be a thin local reusable-workflow caller with inherited signing secrets");
  return { issues, checks };
}

const snapshot = {
  workflows: Object.fromEntries(fs.readdirSync(workflowDir).filter((name) => /\.ya?ml$/.test(name))
    .map((name) => [name, parseWorkflow(fs.readFileSync(path.join(workflowDir, name), "utf8"), name)])),
  nativeRunner: fs.readFileSync(path.join(root, "scripts/test-native-credentials.sh"), "utf8"),
};
const actual = validate(snapshot);
assert.deepEqual(actual.issues, [], `Workflow security contracts failed:\n${actual.issues.join("\n")}`);

let mutations = 0;
function rejectsMutation(name, mutate, rule) {
  const changed = structuredClone(snapshot);
  mutate(changed);
  // Roundtrip mutations through YAML too; do not test a second hand-built model.
  for (const [file, workflow] of Object.entries(changed.workflows)) changed.workflows[file] = parseWorkflow(stringify(workflow), file);
  const result = validate(changed);
  assert.ok(result.issues.some((issue) => issue.startsWith(`${rule}:`)), `${name}: mutation escaped ${rule}\n${result.issues.join("\n")}`);
  mutations += 1;
}

rejectsMutation("mutable action tag", (copy) => { copy.workflows["ci.yml"].jobs.frontend.steps.find((step) => step.uses).uses = "actions/checkout@v7"; }, "action-pin");
rejectsMutation("missing macOS build", (copy) => { delete copy.workflows["release.yml"].jobs.macos; }, "release-platforms");
rejectsMutation("missing packaging key", (copy) => {
  const workflow = copy.workflows["release.yml"];
  const job = workflow.jobs.windows;
  const step = job.steps.find((candidate) => /package-release\.ps1/.test(code(candidate)));
  delete step.env?.TAURI_SIGNING_PRIVATE_KEY;
  delete job.env?.TAURI_SIGNING_PRIVATE_KEY;
  delete workflow.env?.TAURI_SIGNING_PRIVATE_KEY;
}, "signing-env");
rejectsMutation("asset overwrite", (copy) => { copy.workflows["release.yml"].jobs.publish.steps.push({ run: "gh release upload v1.0.0 file.exe --clobber" }); }, "immutable-release");
rejectsMutation("filtered Unix test suite", (copy) => {
  const step = copy.workflows["ci.yml"].jobs.backend.steps.find(fullLibraryRun);
  step.run = code(step).replace(/--lib\b/, "--lib unix_filesystem_tests");
}, "ci-full-library");
for (const harness of [
  "--list", "--exact nonexistent", "nonexistent", "--skip auth::", "--ignored", "--include-ignored",
  "--test-threads=0", "--test-threads 0", "--test-threads", "--test-threads=1 nonexistent",
  "--test-threads=1 --list", "-- --list",
]) {
  rejectsMutation(`filtered or non-executing harness: ${harness}`, (copy) => {
    const step = copy.workflows["ci.yml"].jobs.backend.steps.find(fullLibraryRun);
    step.run = `cargo test --manifest-path src-tauri/Cargo.toml --locked --lib -- ${harness}`;
  }, "ci-full-library");
}
for (const harness of [
  "", "--test-threads=1", "--test-threads 2", '--test-threads "3"', "--nocapture", "--show-output",
  "--quiet", "-q", "--test-threads=1 --nocapture --show-output -q",
]) {
  assert.ok(fullLibraryRun({ run: `cargo test --manifest-path src-tauri/Cargo.toml --locked --lib -- ${harness}` }),
    `full library execution option must remain accepted: ${harness}`);
}
rejectsMutation("missing frontend regressions", (copy) => {
  const job = copy.workflows["ci.yml"].jobs.frontend;
  job.steps = job.steps.filter((step) => !/test:security\b/.test(code(step)));
}, "ci-security");
rejectsMutation("missing DPAPI tests", (copy) => {
  const job = copy.workflows["ci.yml"].jobs.backend;
  job.steps = job.steps.filter((step) => !/native_dpapi\b|secret_storage::native_windows_tests\b/.test(code(step)));
}, "ci-dpapi");
rejectsMutation("missing native opt-in", (copy) => {
  const workflow = copy.workflows["ci.yml"];
  const job = workflow.jobs.backend;
  const step = job.steps.find((candidate) => /test-native-credentials\.sh/.test(code(candidate)));
  delete step.env?.AI_HELPER_NATIVE_CREDENTIAL_TESTS;
  delete job.env?.AI_HELPER_NATIVE_CREDENTIAL_TESTS;
  delete workflow.env?.AI_HELPER_NATIVE_CREDENTIAL_TESTS;
}, "ci-native");
rejectsMutation("shared Linux bus", (copy) => { copy.nativeRunner = copy.nativeRunner.replaceAll("dbus-run-session", "shared-session"); }, "native-linux-isolation");
rejectsMutation("personal native service access", (copy) => { copy.nativeRunner = copy.nativeRunner.replaceAll("GITHUB_ACTIONS", "UNGUARDED_ACTIONS"); }, "native-disposable-guard");
rejectsMutation("publish before macOS", (copy) => {
  const job = copy.workflows["release.yml"].jobs.publish;
  job.needs = array(job.needs).filter((name) => name !== "macos");
}, "release-join");
rejectsMutation("bypass release availability gate", (copy) => { copy.workflows["release.yml"].jobs.windows.if = "true"; }, "release-gate");
rejectsMutation("append unconditional release gate", (copy) => { copy.workflows["release.yml"].jobs.windows.if += " || true"; }, "release-gate");
rejectsMutation("missing final tag check", (copy) => {
  const job = copy.workflows["release.yml"].jobs.publish;
  job.steps = job.steps.filter((step) => step.id !== "final-check");
}, "release-final-check");
rejectsMutation("second tag publisher", (copy) => { copy.workflows["update-release.yml"].on.push.tags = ["v*"]; }, "wrapper-trigger");
rejectsMutation("wrapper drops signing secrets", (copy) => { delete Object.values(copy.workflows["update-release.yml"].jobs)[0].secrets; }, "wrapper-delegation");
assert.throws(() => parseWorkflow("jobs: {}\njobs: {}\n", "duplicate fixture"), /Map keys must be unique/);

const identity = { version: "1.2.3", tauriVersion: "1.2.3", refType: "tag", refName: "v1.2.3" };
const checkoutCommit = "a".repeat(40);
const options = { ...identity, repository: "fixture-owner/fixture-repo", token: "synthetic-test-token", commit: checkoutCommit };
assert.equal(releaseIdentity(identity), "v1.2.3");
assert.equal(releaseIdentity({ ...identity, refType: "branch", refName: "main" }), "v1.2.3");
for (const invalid of [
  { version: "1.2.4" }, { tauriVersion: "1.2.4" }, { refName: "v9.9.9" },
  { version: "1.2.3\n", tauriVersion: "1.2.3\n" },
  { version: "1.2.3\nshould_release=true", tauriVersion: "1.2.3\nshould_release=true" },
]) assert.throws(() => releaseIdentity({ ...identity, ...invalid }));

let httpChecks = 0;
let availabilityChecks = 0;
const releasePath = "/releases/tags/v1.2.3";
const refPath = "/git/ref/tags/v1.2.3";
const missingRelease = { path: releasePath, status: 404 };
const tagSha = (index) => index.toString(16).padStart(40, "0");
const target = (type, sha) => ({ type, sha, url: "https://untrusted.invalid/must-not-receive-the-token" });
const refResponse = (object) => ({ path: refPath, status: 200, payload: { ref: "refs/tags/v1.2.3", object } });
const tagResponse = (sha, object) => ({ path: `/git/tags/${sha}`, status: 200, payload: { sha, object } });

async function availability(responses, overrides = {}) {
  const remaining = [...responses];
  availabilityChecks += 1;
  try {
    return await checkReleaseAvailability({ ...options, ...overrides }, async (url, init) => {
      httpChecks += 1;
      const next = remaining.shift();
      assert.ok(next, `unexpected HTTP request: ${url}`);
      assert.equal(url, `https://api.github.com/repos/fixture-owner/fixture-repo${next.path}`);
      assert.equal(init.method ?? "GET", "GET");
      assert.equal(init.headers.Authorization, "Bearer synthetic-test-token");
      assert.equal(init.redirect, "error");
      assert.ok(init.signal instanceof AbortSignal);
      if (next.error) throw next.error;
      return {
        status: next.status,
        json: async () => {
          if (next.jsonError) throw new Error("invalid JSON");
          return next.payload;
        },
      };
    });
  } finally {
    assert.equal(remaining.length, 0, "expected HTTP fixtures were not consumed");
  }
}

const available = { tag: "v1.2.3", shouldRelease: true };
assert.deepEqual(await availability([missingRelease, { path: refPath, status: 404 }]), available);
assert.deepEqual(await availability([{ path: releasePath, status: 200, payload: { tag_name: "v1.2.3" } }]),
  { tag: "v1.2.3", shouldRelease: false });
assert.deepEqual(await availability([missingRelease, refResponse(target("commit", checkoutCommit))]), available);
assert.deepEqual(await availability([missingRelease, refResponse(target("tag", tagSha(1))),
  tagResponse(tagSha(1), target("commit", checkoutCommit))]), available);
// Eight nested annotated tags are allowed; the ninth is rejected before its GET.
function annotatedChain(length) {
  return [missingRelease, refResponse(target("tag", tagSha(1))),
    ...Array.from({ length }, (_, index) => tagResponse(tagSha(index + 1),
      index === length - 1 ? target("commit", checkoutCommit) : target("tag", tagSha(index + 2))))];
}
assert.deepEqual(await availability(annotatedChain(8)), available);
await assert.rejects(availability(annotatedChain(9).slice(0, -1)), /exceeds eight/);
await assert.rejects(availability([missingRelease, refResponse(target("tag", tagSha(1))),
  tagResponse(tagSha(1), target("tag", tagSha(1)))]), /cyclic/);
await assert.rejects(availability([missingRelease, refResponse(target("commit", "b".repeat(40)))]), /commit does not match/);
await assert.rejects(availability([missingRelease, refResponse(target("tag", tagSha(1))),
  tagResponse(tagSha(1), target("commit", "b".repeat(40)))]), /commit does not match/);
for (const invalid of [target("tree", checkoutCommit), target("commit", "not-a-sha"), target("tag", `${tagSha(1)}\n`), null]) {
  await assert.rejects(availability([missingRelease, refResponse(invalid)]), /Invalid release tag target/);
}
await assert.rejects(availability([missingRelease,
  { path: refPath, status: 200, payload: { ref: "refs/tags/v9.9.9", object: target("commit", checkoutCommit) } }]), /tag reference/);
await assert.rejects(availability([missingRelease, refResponse(target("tag", tagSha(1))),
  { path: `/git/tags/${tagSha(1)}`, status: 200, payload: { sha: tagSha(2), object: target("commit", checkoutCommit) } }]), /annotated release tag identity/);
for (const status of [401, 403, 429, 500, 503]) {
  await assert.rejects(availability([{ path: releasePath, status }]), new RegExp(`HTTP ${status}`));
}
for (const status of [403, 500]) {
  await assert.rejects(availability([missingRelease, { path: refPath, status }]), new RegExp(`HTTP ${status}`));
}
for (const status of [404, 403, 500]) {
  await assert.rejects(availability([missingRelease, refResponse(target("tag", tagSha(1))),
    { path: `/git/tags/${tagSha(1)}`, status }]), new RegExp(`HTTP ${status}`));
}
await assert.rejects(availability([{ path: releasePath, status: 200, payload: { tag_name: "v9.9.9" } }]), /identity/);
for (const prefix of [[], [missingRelease], [missingRelease, refResponse(target("tag", tagSha(1)))]]) {
  const nextPath = prefix.length === 0 ? releasePath : prefix.length === 1 ? refPath : `/git/tags/${tagSha(1)}`;
  await assert.rejects(availability([...prefix, { path: nextPath, error: new Error("synthetic network failure") }]), /synthetic network failure/);
  await assert.rejects(availability([...prefix, { path: nextPath, status: 200, jsonError: true }]), /invalid JSON/);
}
for (const invalid of [{ repository: "invalid-repository" }, { token: "" }, { tauriVersion: "2.0.0" }, { refName: "v9.9.9" },
  { commit: undefined }, { commit: "a".repeat(39) }, { commit: `${checkoutCommit}\n` }, { commit: "g".repeat(40) }]) {
  await assert.rejects(availability([], invalid));
}
console.log(`Workflow security: ${actual.checks} structural checks passed; ${mutations} unsafe YAML/script mutations rejected; ${availabilityChecks} release preflight cases verified with ${httpChecks} isolated HTTP fixtures.`);
