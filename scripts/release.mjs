#!/usr/bin/env node
// The only supported way to cut a release. Dry-run by default; see RELEASING.md.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { cutRelease, sectionBody } from './changelog.mjs';

const USAGE = 'Usage: pnpm release <patch|minor|major|X.Y.Z> [--yes]';
const args = process.argv.slice(2).filter((a) => a !== '--');
const confirmed = args.includes('--yes');
const bump = args.find((a) => !a.startsWith('-'));

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

const capture = (cmd, argv) => execFileSync(cmd, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const run = (cmd, argv) => execFileSync(cmd, argv, { stdio: 'inherit' });
const parse = (v) => /^(\d+)\.(\d+)\.(\d+)$/.exec(v)?.slice(1).map(Number);

if (!bump) fail(USAGE);

const pkgText = readFileSync('package.json', 'utf8');
const pkg = JSON.parse(pkgText);
const current = parse(pkg.version);
if (!current) fail(`current version "${pkg.version}" is not X.Y.Z`);

const [major, minor, patch] = current;
const next = { major: `${major + 1}.0.0`, minor: `${major}.${minor + 1}.0`, patch: `${major}.${minor}.${patch + 1}` }[bump] ?? bump;
const target = parse(next);
if (!target) fail(USAGE);
const diff = target.map((n, i) => n - current[i]).find((d) => d !== 0) ?? 0;
if (diff <= 0) fail(`${next} is not greater than the current version ${pkg.version}`);
const tag = `v${next}`;

// Preflight: every check runs before anything is modified.
if (capture('git', ['branch', '--show-current']) !== 'main') fail('releases are cut from main only');
if (capture('git', ['status', '--porcelain'])) fail('working tree is not clean (commit or move unfinished work first; do not discard it)');
run('git', ['fetch', '--quiet', '--tags', 'origin', 'main']);
const head = capture('git', ['rev-parse', 'HEAD']);
if (head !== capture('git', ['rev-parse', 'origin/main'])) fail('main differs from origin/main (push or pull first)');
if (capture('git', ['tag', '--list', tag])) fail(`tag ${tag} already exists`);

const ci = JSON.parse(capture('gh', ['run', 'list', '--workflow', 'ci.yml', '--commit', head, '--limit', '1', '--json', 'status,conclusion']))[0];
if (ci?.conclusion !== 'success') fail(`CI is not green for ${head.slice(0, 7)} (${ci ? ci.conclusion || ci.status : 'no run found'})`);

let published = '';
try {
  published = capture('npm', ['view', `${pkg.name}@${next}`, 'version']);
} catch (err) {
  if (!String(err.stderr).includes('E404')) fail(`could not query npm: ${err.stderr}`);
}
if (published) fail(`${pkg.name}@${next} is already on npm`);

const changelog = readFileSync('CHANGELOG.md', 'utf8');
const notes = sectionBody(changelog, 'Unreleased');
if (!notes) fail('CHANGELOG.md has nothing under [Unreleased]');

run('pnpm', ['install', '--frozen-lockfile']);
run('pnpm', ['run', 'typecheck']);
run('pnpm', ['test']);
run('pnpm', ['run', 'build:pkg']);
run('npm', ['pack', '--dry-run']);

console.log(`\n${pkg.name} ${pkg.version} -> ${next}\n\n${notes}\n`);
if (!confirmed) {
  console.log(`Dry run: all checks passed, nothing changed. Re-run with --yes to push ${tag}.`);
  process.exit(0);
}

const repo = pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, '');
const updatedChangelog = cutRelease(changelog, next, new Date().toISOString().slice(0, 10)).replace(
  /^\[Unreleased\]: .*$/m,
  `[Unreleased]: ${repo}/compare/${tag}...HEAD\n[${next}]: ${repo}/compare/v${pkg.version}...${tag}`,
);
writeFileSync('CHANGELOG.md', updatedChangelog);
writeFileSync('package.json', pkgText.replace(`"version": "${pkg.version}"`, `"version": "${next}"`));

run('git', ['add', 'package.json', 'CHANGELOG.md']);
run('git', ['commit', '-m', `chore(release): ${tag}`]);
run('git', ['tag', '-a', tag, '-m', tag]);
// --atomic: the commit and the tag land together or not at all.
run('git', ['push', '--atomic', 'origin', 'main', `refs/tags/${tag}`]);

console.log(`\nPushed ${tag}. The Release workflow now publishes npm and the GitHub Release:\n${repo}/actions/workflows/release.yml`);
