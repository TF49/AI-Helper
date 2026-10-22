import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const validSha = (value) => typeof value === "string" && value.length === 40 && /^[0-9a-f]{40}$/i.test(value);

export function releaseIdentity({ version, tauriVersion, refType, refName }) {
  if (typeof version !== "string" || version.match(/^\d+\.\d+\.\d+$/)?.[0] !== version || version !== tauriVersion) {
    throw new Error("Package and Tauri release versions must match.");
  }
  const tag = `v${version}`;
  if (refType === "tag" && refName !== tag) {
    throw new Error("GitHub trigger tag must match the configured release version.");
  }
  return tag;
}

export async function checkReleaseAvailability(options, request = fetch) {
  const tag = releaseIdentity(options);
  if (typeof options.repository !== "string" || options.repository.match(/^[\w.-]+\/[\w.-]+$/)?.[0] !== options.repository || !options.token) {
    throw new Error("A valid repository and GitHub token are required for release checks.");
  }
  if (!validSha(options.commit)) throw new Error("Release checkout commit must be a full 40-character Git SHA.");
  const commit = options.commit.toLowerCase();
  const apiRoot = `https://api.github.com/repos/${options.repository}`;
  const get = (endpoint) => request(`${apiRoot}${endpoint}`, {
    headers: {
      Authorization: `Bearer ${options.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  const response = await get(`/releases/tags/${encodeURIComponent(tag)}`);
  if (response.status === 200) {
    const release = await response.json();
    if (release?.tag_name !== tag) throw new Error("Unexpected release identity returned by GitHub.");
    return { tag, shouldRelease: false };
  }
  if (response.status !== 404) {
    throw new Error(`Unable to establish release availability (HTTP ${response.status}).`);
  }

  // --target only controls the creation of a missing tag. An existing tag must
  // already resolve to the checkout whose artifacts we are about to publish.
  const referenceResponse = await get(`/git/ref/tags/${encodeURIComponent(tag)}`);
  if (referenceResponse.status === 404) return { tag, shouldRelease: true };
  if (referenceResponse.status !== 200) {
    throw new Error(`Unable to establish release tag identity (HTTP ${referenceResponse.status}).`);
  }
  const reference = await referenceResponse.json();
  if (reference?.ref !== `refs/tags/${tag}`) throw new Error("Unexpected release tag reference returned by GitHub.");
  let target = reference.object;
  const seen = new Set();
  while (true) {
    if (!target || !validSha(target.sha) || !["commit", "tag"].includes(target.type)) {
      throw new Error("Invalid release tag target returned by GitHub.");
    }
    const sha = target.sha.toLowerCase();
    if (target.type === "commit") {
      if (sha !== commit) throw new Error("Release tag commit does not match the checked-out commit.");
      return { tag, shouldRelease: true };
    }
    if (seen.has(sha) || seen.size >= 8) throw new Error("Release tag chain is cyclic or exceeds eight annotated tags.");
    seen.add(sha);
    // Ignore response-supplied URLs; resolve only verified SHA paths in this
    // repository on the fixed GitHub API origin that receives our token.
    const annotatedResponse = await get(`/git/tags/${sha}`);
    if (annotatedResponse.status !== 200) {
      throw new Error(`Unable to resolve annotated release tag (HTTP ${annotatedResponse.status}).`);
    }
    const annotated = await annotatedResponse.json();
    if (!validSha(annotated?.sha) || annotated.sha.toLowerCase() !== sha) {
      throw new Error("Unexpected annotated release tag identity returned by GitHub.");
    }
    target = annotated.object;
  }
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const tauri = JSON.parse(fs.readFileSync(path.join(root, "src-tauri/tauri.conf.json"), "utf8"));
  const result = await checkReleaseAvailability({
    version: pkg.version,
    tauriVersion: tauri.version,
    refType: process.env.GITHUB_REF_TYPE,
    refName: process.env.GITHUB_REF_NAME,
    // A tag event's GITHUB_SHA can describe the tag object; HEAD is the commit
    // actually checked out by actions/checkout and used by all build jobs.
    commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    repository: process.env.GITHUB_REPOSITORY,
    token: process.env.GH_TOKEN,
  });
  if (!process.env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT is required.");
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `tag=${result.tag}\nshould_release=${result.shouldRelease}\n`);
  console.log(result.shouldRelease
    ? `Release ${result.tag} does not exist; build all required platforms.`
    : `Release ${result.tag} already exists; preserve all published assets and skip publishing.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
