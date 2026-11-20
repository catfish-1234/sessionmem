#!/usr/bin/env node
// Tag and publish a release from a clean, up-to-date main: `npm run release`.
//
// Pushing a v* tag runs .github/workflows/release.yml, which builds, tests and publishes that
// version to npm and creates its GitHub release. This command is the safe way to push that tag:
//
//   npm run release                    tag the version in package.json and push it
//   npm run release -- --dry-run       show what would be tagged and pushed, change nothing
//   npm run release -- --backfill      also tag older CHANGELOG versions that were never tagged
//   npm run release -- --yes           do not ask for confirmation (for scripts)
//
// In a repository that is also a GitHub Action (it has action.yml), the moving major tag that
// Action users pin (`v2`) is re-pointed at the new release, but only after its release run
// succeeds: a `v2` on a commit whose publish failed would send every consumer to a half release.
//
// Why it exists instead of `git tag && git push --tags`:
//
// - A tag runs the release workflow of the commit it points at. An older tag runs an older
//   workflow, which publishes with npm's `latest` dist-tag. Pushed together, those runs race and
//   whichever finishes last becomes `latest`, possibly an old version. So older versions are
//   pushed first, one at a time, and the current version only after their runs have finished.
// - GitHub creates no workflow events at all when more than three tags arrive in one push, so
//   each tag is pushed on its own.
// - The current version is tagged at HEAD only when CHANGELOG.md has no unreleased entries.
//   Otherwise HEAD holds work that version does not describe, and the tag goes on the commit that
//   first carried the version instead.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";

const WORKFLOW = "release.yml";
const WAIT_TIMEOUT_MS = 45 * 60 * 1000;
const POLL_MS = 15 * 1000;

// ------------------------------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ------------------------------------------------------------------------------------------------

/** Versions with a `## [x.y.z] - date` heading, in file order (newest first by convention). */
export function changelogVersions(text) {
  return [...text.matchAll(/^## \[(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\](?:\s*-\s*(\d{4}-\d{2}-\d{2}))?/gm)]
    .map((m) => ({ version: m[1], date: m[2] ?? null }));
}

/** The body of the `## [Unreleased]` section, trimmed; empty when there is nothing unreleased. */
export function unreleasedEntries(text) {
  const match = /^## \[Unreleased\][^\n]*\n([\s\S]*?)(?=^## \[|(?![\s\S]))/m.exec(text);
  return match ? match[1].replace(/^\[[^\]]+\]:.*$/gm, "").trim() : "";
}

/** Compare two semver strings: negative, zero or positive. A prerelease sorts below its release. */
export function compareVersions(a, b) {
  const parse = (v) => {
    const [core, pre = ""] = v.split("-", 2);
    return { nums: core.split(".").map(Number), pre };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    if (x.nums[i] !== y.nums[i]) return x.nums[i] - y.nums[i];
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

/**
 * What to tag. `releaseCommit(version)` returns the commit that first carried a version, or null.
 * Returns `{ current, backfill, notes, errors }`; `backfill` is oldest first.
 */
export function planRelease({ version, changelog, tagged, head, releaseCommit, backfill = false }) {
  const errors = [];
  const notes = [];
  const versions = changelogVersions(changelog);
  const entry = versions.find((v) => v.version === version);
  let current = null;
  if (!entry) {
    errors.push(`CHANGELOG.md has no "## [${version}]" section for the version in package.json.`);
  } else if (!entry.date) {
    errors.push(`CHANGELOG.md's "## [${version}]" section has no release date.`);
  } else if (tagged.has(`v${version}`)) {
    notes.push(`v${version} is already tagged; nothing new to release for the current version.`);
  } else {
    const unreleased = unreleasedEntries(changelog);
    if (unreleased) {
      const commit = releaseCommit(version);
      if (!commit) errors.push(`CHANGELOG.md has unreleased entries and no commit introduces version ${version}.`);
      else {
        current = { version, tag: `v${version}`, commit };
        notes.push(`CHANGELOG.md has unreleased entries, so v${version} goes on the commit that introduced it, not HEAD.`);
      }
    } else {
      current = { version, tag: `v${version}`, commit: head };
    }
  }

  const older = [];
  const missing = versions
    .filter((v) => compareVersions(v.version, version) < 0 && !tagged.has(`v${v.version}`))
    .sort((a, b) => compareVersions(a.version, b.version));
  if (backfill) {
    for (const v of missing) {
      const commit = releaseCommit(v.version);
      if (commit) older.push({ version: v.version, tag: `v${v.version}`, commit });
      else notes.push(`v${v.version} is in CHANGELOG.md but no commit introduces it; skipped.`);
    }
  } else if (missing.length > 0) {
    notes.push(`Older versions without a tag: ${missing.map((v) => v.version).join(", ")}. `
      + "Add --backfill to tag and publish them first.");
  }
  return { current, backfill: older, notes, errors };
}

/** The CHANGELOG.md section for a version, without its heading: the GitHub release notes. */
export function changelogSection(text, version) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
  if (start < 0) return "";
  const end = lines.findIndex((l, i) => i > start && /^## \[/.test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim();
}

/** `owner/repo` from a GitHub remote URL, or null. */
export function githubRepo(url) {
  const match = /github\.com[:/]+([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url.trim());
  return match ? `${match[1]}/${match[2]}` : null;
}

// ------------------------------------------------------------------------------------------------
// Git and GitHub
// ------------------------------------------------------------------------------------------------

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function tryGit(...args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function ghAvailable() {
  if (process.env.RELEASE_NO_GH === "1") return false;
  const result = spawnSync("gh", ["auth", "status"], { encoding: "utf8" });
  return result.status === 0;
}

function gh(...args) {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** The first commit on HEAD whose package.json carries `version`. */
function firstCommitWithVersion(version) {
  const pattern = `"version": "${version.replace(/[.]/g, "\\.")}"`;
  const out = tryGit("log", "--format=%H", "--reverse", "-G", pattern, "--", "package.json");
  if (!out) return null;
  for (const sha of out.split("\n")) {
    const pkg = tryGit("show", `${sha}:package.json`);
    try {
      if (pkg && JSON.parse(pkg).version === version) return sha;
    } catch { /* not valid JSON at that commit */ }
  }
  return null;
}

/** Check runs on a commit that have not succeeded, or null when they cannot be read. */
function failingChecks(repo, sha) {
  try {
    const raw = gh("api", `repos/${repo}/commits/${sha}/check-runs?per_page=100`, "--jq",
      ".check_runs[] | [.name, .status, (.conclusion // \"\")] | @tsv");
    return raw.split("\n").filter(Boolean).map((line) => line.split("\t"))
      .filter(([, status, conclusion]) => status !== "completed" || !["success", "skipped", "neutral"].includes(conclusion))
      .map(([name, status, conclusion]) => `${name} (${conclusion || status})`);
  } catch {
    return null;
  }
}

/** Wait for the release runs of `tags`; resolves to a map of tag to conclusion. */
async function waitForReleaseRuns(repo, tags, why) {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  const pending = new Set(tags);
  const conclusions = new Map();
  console.log(`Waiting for the release runs of ${tags.join(", ")} to finish ${why}.`);
  while (pending.size > 0) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${[...pending].join(", ")}. Run \`npm run release\` again once they finish.`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    let runs;
    try {
      runs = JSON.parse(gh("run", "list", "-R", repo, "--workflow", WORKFLOW, "--limit", "50",
        "--json", "headBranch,status,conclusion,url"));
    } catch { continue; }
    for (const tag of pending) {
      const run = runs.find((r) => r.headBranch === tag);
      if (run && run.status === "completed") {
        pending.delete(tag);
        conclusions.set(tag, run.conclusion);
        console.log(`  ${tag}: ${run.conclusion} ${run.url}`);
      }
    }
  }
  return conclusions;
}

// ------------------------------------------------------------------------------------------------
// Command
// ------------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const options = { dryRun: false, backfill: false, yes: false, help: false, branch: "main", majorTag: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run" || arg === "-n") options.dryRun = true;
    else if (arg === "--backfill") options.backfill = true;
    else if (arg === "--yes" || arg === "-y") options.yes = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--branch") options.branch = argv[++i];
    else if (arg === "--no-major-tag") options.majorTag = false;
    else throw new Error(`Unknown option ${arg}. Try --help.`);
  }
  return options;
}

const HELP = `Usage: npm run release [-- options]

Tag the version in package.json and push the tag, which runs the release workflow
(build, test, publish to npm, GitHub release).

  -n, --dry-run   show the plan and change nothing
      --backfill  also tag older CHANGELOG.md versions that were never tagged; they
                  are pushed first, one at a time, and the current version waits
                  for their release runs so it is published last
  -y, --yes       do not ask for confirmation
      --branch    release branch (default: main)
      --no-major-tag
                  in a GitHub Action repository, leave the moving major tag
                  (v2) alone; by default it is moved to the new release once
                  the release run succeeds`;

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim());
  } finally {
    rl.close();
  }
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(HELP);
    return 0;
  }

  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  if (branch !== options.branch) throw new Error(`Releases are cut from ${options.branch}; this checkout is on ${branch}.`);
  if (git("status", "--porcelain", "--untracked-files=no")) {
    throw new Error("The working tree has uncommitted changes. Commit or stash them first.");
  }
  git("fetch", "--quiet", "--tags", "origin", options.branch);
  const head = git("rev-parse", "HEAD");
  const upstream = git("rev-parse", `origin/${options.branch}`);
  if (head !== upstream) {
    throw new Error(`HEAD is not origin/${options.branch}. Push or pull first, so the tag points at what is on GitHub.`);
  }

  const version = JSON.parse(readFileSync("package.json", "utf8")).version;
  const changelog = readFileSync("CHANGELOG.md", "utf8");
  const remoteTags = new Set((tryGit("ls-remote", "--tags", "origin") ?? "").split("\n")
    .map((line) => line.split("refs/tags/")[1]).filter(Boolean).map((t) => t.replace(/\^\{\}$/, "")));
  const plan = planRelease({ version, changelog, tagged: remoteTags, head, releaseCommit: firstCommitWithVersion, backfill: options.backfill });

  for (const note of plan.notes) console.log(note);
  if (plan.errors.length > 0) throw new Error(plan.errors.join("\n"));
  const all = [...plan.backfill, ...(plan.current ? [plan.current] : [])];
  if (all.length === 0) {
    console.log("Nothing to release.");
    return 0;
  }

  // A local tag the remote does not have must agree with the plan, or pushing it would publish
  // something other than what is shown here.
  for (const item of all) {
    const local = tryGit("rev-parse", "--verify", "--quiet", `refs/tags/${item.tag}^{commit}`);
    if (local && local !== item.commit) {
      throw new Error(`A local tag ${item.tag} already points at ${local.slice(0, 7)}, not ${item.commit.slice(0, 7)}. `
        + `Delete it with \`git tag -d ${item.tag}\` if it is stale.`);
    }
  }

  const repo = githubRepo(git("remote", "get-url", "origin"));
  const useGh = repo !== null && ghAvailable();
  if (plan.current && useGh) {
    const failing = failingChecks(repo, plan.current.commit);
    if (failing === null) console.log("Could not read CI results for that commit; the release workflow runs the tests before publishing.");
    else if (failing.length > 0) {
      const message = `CI is not green on ${plan.current.commit.slice(0, 7)}: ${failing.join(", ")}.`;
      if (!options.dryRun) throw new Error(`${message} Wait for it, or fix it, before releasing.`);
      console.log(`Warning: ${message} A real run would stop here.`);
    }
    else console.log(`CI is green on ${plan.current.commit.slice(0, 7)}.`);
  } else if (plan.current) {
    console.log("GitHub CLI not available or not signed in: CI status not checked (the release workflow runs the tests before publishing).");
  }

  console.log("\nPlan (each tag publishes its version when pushed):");
  for (const item of all) {
    const subject = git("log", "-1", "--format=%s", item.commit);
    console.log(`  ${item.tag.padEnd(10)} ${item.commit.slice(0, 7)}  ${subject}${item === plan.current ? "  (current, pushed last)" : ""}`);
  }
  if (plan.backfill.length > 0 && plan.current && !useGh) {
    console.log("\nWithout the GitHub CLI this run pushes only the older tags. Run `npm run release` again"
      + " once their release runs finish, so the current version is published last.");
  }
  if (options.dryRun) {
    console.log("\nDry run: nothing was tagged or pushed.");
    return 0;
  }
  if (!options.yes) {
    if (!process.stdin.isTTY) throw new Error("Not a terminal: rerun with --yes to confirm.");
    if (!(await confirm("\nCreate and push these tags?"))) {
      console.log("Cancelled.");
      return 1;
    }
  }

  const push = (item) => {
    if (!tryGit("rev-parse", "--verify", "--quiet", `refs/tags/${item.tag}`)) {
      git("tag", "-a", item.tag, "-m", `Release ${item.tag}`, item.commit);
    }
    // One tag per push: GitHub creates no events when more than three tags arrive at once.
    git("push", "--quiet", "origin", `refs/tags/${item.tag}`);
    console.log(`Pushed ${item.tag}.`);
  };
  for (const item of plan.backfill) push(item);
  if (plan.current) {
    if (plan.backfill.length > 0) {
      if (!useGh) return 0;
      await waitForReleaseRuns(repo, plan.backfill.map((item) => item.tag), "before pushing the current version");
    }
    push(plan.current);
    if (repo) console.log(`\nRelease workflow: https://github.com/${repo}/actions/workflows/${WORKFLOW}`);
    if (options.majorTag && existsSync("action.yml") && !plan.current.version.includes("-")) {
      const major = `v${plan.current.version.split(".")[0]}`;
      const move = `git tag -f ${major} ${plan.current.commit.slice(0, 12)} && git push --force origin refs/tags/${major}`;
      if (!useGh) {
        console.log(`\nOnce that run succeeds, move the ${major} tag Action users pin:\n  ${move}`);
        return 0;
      }
      const conclusion = (await waitForReleaseRuns(repo, [plan.current.tag], `before moving ${major}`)).get(plan.current.tag);
      if (conclusion !== "success") {
        console.log(`The ${plan.current.tag} release run did not succeed (${conclusion}), so ${major} was left where it is.`);
        return 1;
      }
      git("tag", "-f", major, plan.current.commit);
      git("push", "--quiet", "--force", "origin", `refs/tags/${major}`);
      console.log(`Moved ${major} to ${plan.current.tag}.`);
    }
    return 0;
  }
  if (repo) console.log(`\nRelease workflow: https://github.com/${repo}/actions/workflows/${WORKFLOW}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code), (error) => {
    console.error(`release: ${error.message}`);
    process.exit(1);
  });
}
