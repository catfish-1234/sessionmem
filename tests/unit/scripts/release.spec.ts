import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
// @ts-expect-error -- plain ESM script without type declarations
import { changelogSection, changelogVersions, compareVersions, githubRepo, planRelease, unreleasedEntries } from '../../../scripts/release.mjs';

const SCRIPT = resolve('scripts/release.mjs');

const changelog = (unreleased: string, versions: Array<[string, string | null]>) =>
  `# Changelog\n\n## [Unreleased]\n${unreleased ? `\n${unreleased}\n` : ''}\n`
  + versions.map(([v, d]) => `## [${v}]${d ? ` - ${d}` : ''}\n\n### Added\n\n- Things in ${v}.\n`).join('\n');

describe('release planning', () => {
  it('reads versions, dates and the unreleased section', () => {
    const text = changelog('### Fixed\n\n- A bug.', [['2.1.0', '2026-11-19'], ['2.0.0', '2026-11-18'], ['1.0.0-rc.1', null]]);
    expect(changelogVersions(text)).toEqual([
      { version: '2.1.0', date: '2026-11-19' }, { version: '2.0.0', date: '2026-11-18' }, { version: '1.0.0-rc.1', date: null },
    ]);
    expect(unreleasedEntries(text)).toBe('### Fixed\n\n- A bug.');
    expect(unreleasedEntries(changelog('', [['2.1.0', '2026-11-19']]))).toBe('');
    expect(changelogSection(text, '2.0.0')).toBe('### Added\n\n- Things in 2.0.0.');
  });

  it('orders versions numerically, with prereleases below their release', () => {
    const sorted = ['1.10.0', '1.9.0', '2.0.0', '2.0.0-rc.1', '1.10.1'].sort(compareVersions);
    expect(sorted).toEqual(['1.9.0', '1.10.0', '1.10.1', '2.0.0-rc.1', '2.0.0']);
  });

  it('parses GitHub remotes', () => {
    expect(githubRepo('https://github.com/catfish-1234/proctor.git')).toBe('catfish-1234/proctor');
    expect(githubRepo('git@github.com:catfish-1234/proctor.git')).toBe('catfish-1234/proctor');
    expect(githubRepo('https://gitlab.com/a/b.git')).toBeNull();
  });

  const commits: Record<string, string> = { '2.1.0': 'c210', '2.0.0': 'c200', '1.9.0': 'c190' };
  const releaseCommit = (v: string) => commits[v] ?? null;

  it('tags the current version at HEAD when nothing is unreleased, and only lists older gaps', () => {
    const plan = planRelease({
      version: '2.1.0', changelog: changelog('', [['2.1.0', '2026-11-19'], ['2.0.0', '2026-11-18'], ['1.9.0', '2026-11-01']]),
      tagged: new Set(['v1.9.0']), head: 'HEAD', releaseCommit,
    });
    expect(plan.errors).toEqual([]);
    expect(plan.current).toEqual({ version: '2.1.0', tag: 'v2.1.0', commit: 'HEAD' });
    expect(plan.backfill).toEqual([]);
    expect(plan.notes.join('\n')).toMatch(/Older versions without a tag: 2\.0\.0.*--backfill/);
  });

  it('backfills older versions oldest first, at the commit that introduced each', () => {
    const plan = planRelease({
      version: '2.1.0', changelog: changelog('', [['2.1.0', '2026-11-19'], ['2.0.0', '2026-11-18'], ['1.9.0', '2026-11-01']]),
      tagged: new Set(), head: 'HEAD', releaseCommit, backfill: true,
    });
    expect(plan.backfill.map((b: { tag: string; commit: string }) => [b.tag, b.commit])).toEqual([['v1.9.0', 'c190'], ['v2.0.0', 'c200']]);
  });

  it('tags the release commit instead of HEAD when CHANGELOG.md has unreleased entries', () => {
    const plan = planRelease({
      version: '2.1.0', changelog: changelog('- Unreleased work.', [['2.1.0', '2026-11-19']]),
      tagged: new Set(), head: 'HEAD', releaseCommit,
    });
    expect(plan.current.commit).toBe('c210');
    expect(plan.notes.join('\n')).toMatch(/unreleased entries/);
  });

  it('refuses a version that CHANGELOG.md does not describe or date', () => {
    expect(planRelease({ version: '3.0.0', changelog: changelog('', [['2.1.0', '2026-11-19']]), tagged: new Set(), head: 'H', releaseCommit })
      .errors.join()).toMatch(/no "## \[3\.0\.0\]" section/);
    expect(planRelease({ version: '2.1.0', changelog: changelog('', [['2.1.0', null]]), tagged: new Set(), head: 'H', releaseCommit })
      .errors.join()).toMatch(/no release date/);
  });

  it('has nothing to do for an already tagged version', () => {
    const plan = planRelease({ version: '2.1.0', changelog: changelog('', [['2.1.0', '2026-11-19']]), tagged: new Set(['v2.1.0']), head: 'H', releaseCommit });
    expect(plan.current).toBeNull();
    expect(plan.errors).toEqual([]);
  });
});

describe('npm run release against a real repository', () => {
  let root: string;
  let work: string;
  let origin: string;
  const run = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const release = (...args: string[]) => spawnSync('node', [SCRIPT, ...args], {
    cwd: work, encoding: 'utf8', input: '', env: { ...process.env, RELEASE_NO_GH: '1', GIT_TERMINAL_PROMPT: '0' },
  });
  const remoteTags = () => run(origin, 'tag', '-l').split('\n').filter(Boolean);
  const commit = (version: string, unreleased = '', versions: Array<[string, string]>) => {
    writeFileSync(join(work, 'package.json'), `${JSON.stringify({ name: 'demo', version }, null, 2)}\n`);
    writeFileSync(join(work, 'CHANGELOG.md'), changelog(unreleased, versions));
    run(work, 'add', '-A');
    run(work, 'commit', '-qm', `Release ${version}`);
    return run(work, 'rev-parse', 'HEAD');
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'sessionmem-release-'));
    origin = join(root, 'origin.git');
    work = join(root, 'work');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
    execFileSync('git', ['clone', '-q', origin, work], { stdio: 'ignore' });
    run(work, 'config', 'user.email', 'release@test');
    run(work, 'config', 'user.name', 'Release Test');
    run(work, 'checkout', '-q', '-b', 'main');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('pushes the current version at HEAD, and only that, by default', () => {
    commit('1.0.0', '', [['1.0.0', '2026-01-01']]);
    const head = commit('1.1.0', '', [['1.1.0', '2026-02-01'], ['1.0.0', '2026-01-01']]);
    run(work, 'push', '-q', 'origin', 'main');

    const dry = release('--dry-run');
    expect(dry.status).toBe(0);
    expect(dry.stdout).toMatch(/v1\.1\.0\s+\w{7}\s+Release 1\.1\.0/);
    expect(dry.stdout).toMatch(/Older versions without a tag: 1\.0\.0/);
    expect(remoteTags()).toEqual([]);

    const result = release('--yes');
    expect(result.status, result.stderr).toBe(0);
    expect(remoteTags()).toEqual(['v1.1.0']);
    expect(run(origin, 'rev-parse', 'v1.1.0^{commit}')).toBe(head);
    expect(run(origin, 'cat-file', '-t', 'v1.1.0')).toBe('tag'); // annotated

    expect(release('--yes').stdout).toMatch(/already tagged/);
  });

  it('with --backfill and no GitHub CLI, pushes only the older tags so the current one publishes last', () => {
    const first = commit('1.0.0', '', [['1.0.0', '2026-01-01']]);
    commit('1.1.0', '', [['1.1.0', '2026-02-01'], ['1.0.0', '2026-01-01']]);
    run(work, 'push', '-q', 'origin', 'main');

    const result = release('--backfill', '--yes');
    expect(result.status, result.stderr).toBe(0);
    expect(remoteTags()).toEqual(['v1.0.0']);
    expect(run(origin, 'rev-parse', 'v1.0.0^{commit}')).toBe(first);
    expect(result.stdout).toMatch(/Run `npm run release` again/);

    expect(release('--yes').status).toBe(0);
    expect(remoteTags()).toEqual(['v1.0.0', 'v1.1.0']);
  });

  it('in an Action repository without the GitHub CLI, says how to move the major tag after the run succeeds', () => {
    writeFileSync(join(work, 'action.yml'), 'name: demo\nruns: { using: composite, steps: [] }\n');
    const head = commit('2.0.0', '', [['2.0.0', '2026-03-01']]);
    run(work, 'push', '-q', 'origin', 'main');
    const result = release('--yes');
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`git tag -f v2 ${head.slice(0, 12)} && git push --force origin refs/tags/v2`);
    expect(remoteTags()).toEqual(['v2.0.0']);
  });

  it('tags the release commit when work after it is still unreleased', () => {
    const released = commit('1.1.0', '', [['1.1.0', '2026-02-01']]);
    commit('1.1.0', '- Not released yet.', [['1.1.0', '2026-02-01']]);
    run(work, 'push', '-q', 'origin', 'main');
    expect(release('--yes').status).toBe(0);
    expect(run(origin, 'rev-parse', 'v1.1.0^{commit}')).toBe(released);
  });

  it('refuses a dirty tree, another branch, unpushed commits, and an unconfirmed non-interactive run', () => {
    commit('1.0.0', '', [['1.0.0', '2026-01-01']]);
    run(work, 'push', '-q', 'origin', 'main');

    expect(release('--yes').status).toBe(0);
    commit('1.1.0', '', [['1.1.0', '2026-02-01'], ['1.0.0', '2026-01-01']]);
    const ahead = release('--yes');
    expect(ahead.status).toBe(1);
    expect(ahead.stderr).toMatch(/HEAD is not origin\/main/);

    run(work, 'push', '-q', 'origin', 'main');
    writeFileSync(join(work, 'package.json'), '{"name":"demo","version":"9.9.9"}\n');
    expect(release('--yes').stderr).toMatch(/uncommitted changes/);
    run(work, 'checkout', '-q', '--', 'package.json');

    const unconfirmed = release();
    expect(unconfirmed.status).toBe(1);
    expect(unconfirmed.stderr).toMatch(/rerun with --yes/);

    run(work, 'checkout', '-q', '-b', 'feature');
    expect(release('--yes').stderr).toMatch(/cut from main/);
    expect(remoteTags()).toEqual(['v1.0.0']);
  });
});
