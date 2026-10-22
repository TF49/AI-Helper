#!/usr/bin/env node
// Real DMG mounting and updater signing on a disposable macOS CI runner.
// This does not install/launch AI Helper or test Apple signing/notarization.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

assert.equal(process.platform, "darwin", "this regression requires real macOS tools");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = mkdtempSync(path.join(tmpdir(), "ai-helper-macos-release-test-"));
const temporary = path.join(fixture, "tmp");
const bin = path.join(fixture, "bin");
const keyPath = path.join(fixture, "fixture-only.key");
const publicKeyPath = `${keyPath}.pub`;
const cli = path.join(repo, "node_modules/@tauri-apps/cli/tauri.js");
const packageJson = JSON.parse(readFileSync(path.join(repo, "package.json"), "utf8"));
const config = JSON.parse(readFileSync(path.join(repo, "src-tauri/tauri.conf.json"), "utf8"));
const tag = `v${packageJson.version}`;
const assetRoot = path.join(fixture, "release", tag);
const baseEnv = { ...process.env };
// pnpm/Node can enable the compile cache automatically. Keep that unrelated
// cache out of TMPDIR, whose emptiness proves the DMG mount was cleaned up.
baseEnv.NODE_COMPILE_CACHE = path.join(fixture, "node-compile-cache");
baseEnv.NODE_DISABLE_COMPILE_CACHE = "1";
for (const name of [
  "TAURI_SIGNING_PRIVATE_KEY",
  "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
  "TAURI_PRIVATE_KEY",
  "TAURI_PRIVATE_KEY_PATH",
  "TAURI_PRIVATE_KEY_PASSWORD",
]) {
  delete baseEnv[name];
}

function run(command, args, { env = baseEnv, reject = false, quietError = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: repo,
    env,
    encoding: "utf8",
    input: "",
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (reject) {
    assert.notEqual(result.status, 0, `unexpected success: ${path.basename(command)}`);
  } else if (result.status !== 0) {
    throw new Error(
      `${path.basename(command)} failed (${result.status})${quietError ? "" : `:\n${result.stdout}${result.stderr}`}`,
    );
  }
  return result;
}

function xml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  })[character]);
}

function sourceDmg(target, architecture) {
  return path.join(
    fixture, "src-tauri/target", target, "release/bundle/dmg",
    `${config.productName}_${packageJson.version}_${architecture}.dmg`,
  );
}

function publishedDmg(architecture) {
  return path.join(assetRoot, `AI-Helper-${tag}-macOS-${architecture}.dmg`);
}

function createDmg(label, binaryArchitecture, version = packageJson.version) {
  const contents = path.join(fixture, "sources", label, `${config.productName}.app/Contents`);
  const executable = "ai-helper-fixture";
  mkdirSync(path.join(contents, "MacOS"), { recursive: true });
  mkdirSync(path.join(contents, "Resources"));
  const source = path.join(fixture, "fixture-main.c");
  writeFileSync(source, "int main(void) { return 0; }\n");
  run("xcrun", [
    "--sdk", "macosx", "clang", "-arch", binaryArchitecture,
    "-mmacosx-version-min=11.0", source, "-o", path.join(contents, "MacOS", executable),
  ]);
  assert.equal(run("lipo", ["-archs", path.join(contents, "MacOS", executable)]).stdout.trim(), binaryArchitecture);
  writeFileSync(path.join(contents, "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleDisplayName</key><string>${xml(config.productName)}</string>
<key>CFBundleIdentifier</key><string>${xml(config.identifier)}</string>
<key>CFBundleShortVersionString</key><string>${xml(version)}</string>
<key>CFBundleVersion</key><string>${xml(version)}</string>
<key>CFBundleExecutable</key><string>${executable}</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>\n`);
  copyFileSync(path.join(repo, "LICENSE"), path.join(contents, "Resources/LICENSE.txt"));
  copyFileSync(path.join(repo, "THIRD_PARTY_NOTICES.md"), path.join(contents, "Resources/THIRD_PARTY_NOTICES.md"));
  const dmg = path.join(fixture, `${label}.dmg`);
  run("hdiutil", [
    "create", "-quiet", "-fs", "HFS+", "-format", "UDZO", "-volname", "AI Helper regression",
    "-srcfolder", path.dirname(path.dirname(contents)), dmg,
  ]);
  return dmg;
}

function placeDmg(dmg, target, architecture) {
  const destination = sourceDmg(target, architecture);
  mkdirSync(path.dirname(destination), { recursive: true });
  copyFileSync(dmg, destination);
}

function packageDmg(target, env, reject = false) {
  const result = run("bash", [path.join(fixture, "scripts/package-macos.sh"), tag, target], { env, reject });
  assert.deepEqual(readdirSync(temporary), [], "packaging left a validation mount or temporary directory");
  return result;
}

function verifyDmg(dmg, signature = `${dmg}.sig`, reject = false) {
  const result = run("cargo", [
    "run", "--quiet", "--locked", "--manifest-path", path.join(repo, "src-tauri/Cargo.toml"),
    "--example", "verify-update-artifact", "--", dmg, signature, publicKeyPath,
  ], { reject });
  if (reject) assert.ok(result.stderr.includes("更新签名验证失败"), "the production verifier must reject the signature");
}

try {
  mkdirSync(temporary);
  mkdirSync(bin);
  mkdirSync(path.join(fixture, "scripts"));
  mkdirSync(path.join(fixture, "src-tauri"));
  for (const name of ["package.json", "LICENSE", "THIRD_PARTY_NOTICES.md"]) {
    copyFileSync(path.join(repo, name), path.join(fixture, name));
  }
  copyFileSync(path.join(repo, "src-tauri/tauri.conf.json"), path.join(fixture, "src-tauri/tauri.conf.json"));
  copyFileSync(path.join(repo, "scripts/package-macos.sh"), path.join(fixture, "scripts/package-macos.sh"));
  // The fixture deliberately has no node_modules. Forward the *real* package
  // manager to this checkout's locked CLI; no signer or macOS tool is mocked.
  const actualPnpm = run("/bin/sh", ["-c", "command -v pnpm"]).stdout.trim();
  assert.ok(path.isAbsolute(actualPnpm), "pnpm must resolve to an executable path");
  const wrapper = path.join(bin, "pnpm");
  writeFileSync(wrapper, '#!/usr/bin/env bash\nset -euo pipefail\nexec "$AI_HELPER_TEST_PNPM" --dir "$AI_HELPER_TEST_SOURCE_ROOT" "$@"\n');
  chmodSync(wrapper, 0o755);
  const cliPackage = JSON.parse(readFileSync(path.join(repo, "node_modules/@tauri-apps/cli/package.json"), "utf8"));
  assert.equal(cliPackage.version, "2.8.1", "update this regression when the locked Tauri CLI changes");
  const password = randomBytes(16).toString("hex");
  run(process.execPath, [cli, "signer", "generate", "--write-keys", keyPath, "--password", password, "--ci"], { quietError: true });
  chmodSync(keyPath, 0o600);
  assert.ok(statSync(publicKeyPath).size > 0);
  const packageEnv = {
    ...baseEnv,
    PATH: `${bin}${path.delimiter}${baseEnv.PATH}`,
    TMPDIR: `${temporary}/`,
    GITHUB_REF_TYPE: "branch",
    GITHUB_REF_NAME: "isolated-artifact-regression",
    AI_HELPER_TEST_PNPM: actualPnpm,
    AI_HELPER_TEST_SOURCE_ROOT: repo,
  };
  const signingEnv = {
    ...packageEnv,
    TAURI_SIGNING_PRIVATE_KEY: keyPath,
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password,
  };
  const arm = createDmg("correct-arm64", "arm64");
  const intel = createDmg("correct-x86_64", "x86_64");
  for (const [target, architecture, dmg] of [
    ["aarch64-apple-darwin", "aarch64", arm],
    ["x86_64-apple-darwin", "x64", intel],
  ]) {
    placeDmg(dmg, target, architecture);
    packageDmg(target, signingEnv);
    const published = publishedDmg(architecture);
    assert.deepEqual(readFileSync(published), readFileSync(dmg));
    assert.ok(statSync(`${published}.sig`).size > 0);
    verifyDmg(published);
  }
  const tampered = path.join(fixture, "tampered.dmg");
  writeFileSync(tampered, Buffer.concat([readFileSync(publishedDmg("aarch64")), Buffer.from("tampered")]));
  verifyDmg(tampered, `${publishedDmg("aarch64")}.sig`, true);
  verifyDmg(publishedDmg("aarch64"), `${publishedDmg("x64")}.sig`, true);

  const wrongVersion = createDmg("wrong-version", "arm64", "0.0.0");
  const armSignature = `${publishedDmg("aarch64")}.sig`;
  const intelSignature = readFileSync(`${publishedDmg("x64")}.sig`);
  for (const [dmg, env, expectedMessage] of [
    [wrongVersion, signingEnv, "version/product identity"],
    [intel, signingEnv, "target architecture"],
    [arm, packageEnv, null],
  ]) {
    placeDmg(dmg, "aarch64-apple-darwin", "aarch64");
    writeFileSync(armSignature, "obsolete-signature-must-not-survive");
    const result = packageDmg("aarch64-apple-darwin", env, true);
    if (expectedMessage) assert.ok(`${result.stdout}${result.stderr}`.includes(expectedMessage));
    assert.ok(!existsSync(armSignature), "failed packaging retained an old updater signature");
    assert.deepEqual(readFileSync(`${publishedDmg("x64")}.sig`), intelSignature, "a failed arm64 retry must preserve the x64 signature");
  }
  console.log("Real macOS DMG regressions passed: arm64/x86_64, application identity, real Tauri signing and Rust verification, tampering and failed packaging.");
} finally {
  // Never recursively traverse a validation directory if hdiutil failed to
  // detach it. The package script normally empties this directory via its trap.
  rmSync(keyPath, { force: true });
  if (existsSync(temporary) && readdirSync(temporary).length !== 0) {
    console.error(`Validation directory remains; preserving isolated fixture: ${fixture}`);
  } else {
    rmSync(fixture, { recursive: true, force: true });
  }
}
