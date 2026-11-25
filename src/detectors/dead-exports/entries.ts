import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { DetectorContext, FileEntry } from '../../contracts.js';
import {
  safeReaddir,
  readManifest,
  resolveSpecToFile,
  posixDirname,
  addPkgEntryTargets,
  addScriptEntryTargets,
  isPluginOrIntegrationFile,
  isFrameworkEntryPath,
  isTestConventionEntry,
  isRootEntry,
  CONFIG_FILE_RE,
  CONFIG_SETUP_RE,
  CONFIG_SETUP_QUOTED_RE,
  SCRIPT_RUNNER_RE,
} from './utils.js';

function manifestEntryFiles(ctx: DetectorContext, files: Set<string>): Set<string> {
  const entries = new Set<string>();
  const rels = new Set<string>(ctx.manifests ?? []);
  rels.add('package.json');
  for (const rel of rels) {
    const pkg = readManifest(ctx.rootDir, rel);
    if (!pkg) continue;
    const dir = posixDirname(rel);
    addPkgEntryTargets(entries, files, dir, pkg);
    addScriptEntryTargets(entries, files, dir, pkg);
  }
  return entries;
}

function configSetupEntryFiles(files: FileEntry[], fileSet: Set<string>): Set<string> {
  const entries = new Set<string>();
  for (const file of files) {
    if (!CONFIG_FILE_RE.test(file.relPath)) continue;
    const dir = posixDirname(file.relPath);
    for (const m of file.content.matchAll(CONFIG_SETUP_RE)) {
      if (m[2] !== undefined) {
        for (const qm of m[2].matchAll(CONFIG_SETUP_QUOTED_RE)) {
          const target = resolveSpecToFile(dir, (qm[1] ?? '').replace(/^<rootDir>\/?/, ''), fileSet);
          if (target) entries.add(target);
        }
      } else {
        const target = resolveSpecToFile(dir, m[3] ?? m[4] ?? '', fileSet);
        if (target) entries.add(target);
      }
    }
  }
  return entries;
}

function moduleMapperEntryFiles(files: FileEntry[]): Set<string> {
  const entries = new Set<string>();
  const patternsByFile = new Map<string, RegExp[]>();
  const patternRe = /['"`]([^'"`]+)['"`]/g;
  for (const file of files) {
    if (!CONFIG_FILE_RE.test(file.relPath)) continue;
    const patterns: RegExp[] = [];
    for (const m of file.content.matchAll(patternRe)) {
      const pattern = m[1] ?? '';
      if (!pattern.startsWith('^') || !pattern.endsWith('$')) continue;
      try {
        patterns.push(new RegExp(pattern));
      } catch {
        // Invalid pattern: skip it instead of failing the whole scan.
      }
    }
    if (patterns.length > 0) patternsByFile.set(file.relPath, patterns);
  }
  for (const file of files) {
    const patterns = patternsByFile.get(file.relPath);
    if (!patterns) continue;
    const base = file.relPath.replace(/\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$/, '');
    if (!patterns.some((re) => re.test(base))) continue;
    entries.add(file.relPath);
  }
  return entries;
}

function htmlScriptEntryFiles(ctx: DetectorContext, files: Set<string>): Set<string> {
  const targets = new Set<string>();
  const process = (relPath: string, content: string): void => {
    const re = /<script\b([^>]*)>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const attrs = m[1] ?? '';
      if (!/\btype\s*=\s*(?:"module"|'module'|module(?![\w-]))/i.test(attrs)) continue;
      const srcM = /\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i.exec(attrs);
      const spec = srcM?.[1] ?? srcM?.[2] ?? srcM?.[3];
      if (!spec) continue;
      const target = resolveSpecToFile(posixDirname(relPath), spec, files);
      if (target) targets.add(target);
    }
  };
  const walk = (dir: string): void => {
    const entries = safeReaddir(dir);
    if (!entries) return;
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && /\.html$/i.test(entry.name)) {
        const rel = relative(ctx.rootDir, full).replaceAll('\\', '/');
        process(rel, readFileSync(full, 'utf8'));
      }
    }
  };
  walk(ctx.rootDir);
  return targets;
}

function workflowScriptEntryFiles(ctx: DetectorContext, files: Set<string>): Set<string> {
  const entries = new Set<string>();
  const list = safeReaddir(join(ctx.rootDir, '.github', 'workflows'));
  if (!list) return entries;
  for (const entry of list) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    if (!entry.isFile() || !/\.ya?ml$/i.test(entry.name)) continue;
    const full = join(ctx.rootDir, '.github', 'workflows', entry.name);
    let content = '';
    try {
      content = readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    for (const m of content.matchAll(SCRIPT_RUNNER_RE)) {
      const raw = m[1] ?? '';
      if (!raw || raw.startsWith('-')) continue;
      const target = resolveSpecToFile('', raw, files);
      if (target) entries.add(target);
    }
  }
  return entries;
}

export function entryPointFileSet(ctx: DetectorContext, files: FileEntry[]): Set<string> {
  const fileSet = new Set(files.map((f) => f.relPath));
  const entries = new Set<string>([
    ...manifestEntryFiles(ctx, fileSet),
    ...configSetupEntryFiles(files, fileSet),
    ...moduleMapperEntryFiles(files),
    ...htmlScriptEntryFiles(ctx, fileSet),
    ...workflowScriptEntryFiles(ctx, fileSet),
  ]);
  for (const file of files) {
    if (isRootEntry(file.relPath)
      || isPluginOrIntegrationFile(file.relPath)
      || isFrameworkEntryPath(file.relPath)
      || isTestConventionEntry(file.relPath)) {
      entries.add(file.relPath);
    }
  }
  return entries;
}