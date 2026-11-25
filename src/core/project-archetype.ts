import type { FileEntry } from '../contracts.js';
import { basenameOf, normalizeRelPath } from './project-paths.js';

export type ProjectArchetype =
  | 'next-app'
  | 'vite-react'
  | 'node-lib'
  | 'flutter'
  | 'python'
  | 'rust'
  | 'monorepo'
  | 'unknown';

const NEXT_CONFIG_RE = /(^|\/)next\.config\.[cm]?[jt]s$/i;
const NEXT_ROUTE_RE =
  /(^|\/)app\/(layout|page|error|loading|template|default)\.[cm]?[jt]sx?$|(^|\/)pages\/(_app|_document|index)\.[cm]?[jt]sx?$/i;
const VITE_CONFIG_RE = /(^|\/)vite\.config\.[cm]?[jt]s$/i;
const REACT_IMPORT_RE = /\bfrom\s*['"]react['"]|\brequire\(\s*['"]react['"]\s*\)/;

interface LanguageSignals {
  webCount: number;
  dartCount: number;
  rustCount: number;
  pythonCount: number;
  nextSignals: number;
  viteSignals: number;
}

function countSignalsForFile(file: FileEntry, signals: LanguageSignals): void {
  const lower = normalizeRelPath(file.relPath).toLowerCase();
  const base = basenameOf(lower);
  const ext = file.ext.toLowerCase();

  if (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') {
    signals.webCount += 1;
    if (REACT_IMPORT_RE.test(file.content?.slice(0, 4000) ?? '')) signals.viteSignals += 1;
  } else if (ext === '.dart') {
    signals.dartCount += 1;
  } else if (ext === '.rs') {
    signals.rustCount += 1;
  } else if (ext === '.py') {
    signals.pythonCount += 1;
  }

  if (NEXT_CONFIG_RE.test(lower) || NEXT_ROUTE_RE.test(lower)) signals.nextSignals += 1;
  if (
    VITE_CONFIG_RE.test(lower)
    || base === 'main.tsx'
    || base === 'app.tsx'
    || base === 'index.html'
  ) {
    signals.viteSignals += 1;
  }
}

function collectLanguageSignals(files: FileEntry[]): LanguageSignals {
  const signals: LanguageSignals = {
    webCount: 0,
    dartCount: 0,
    rustCount: 0,
    pythonCount: 0,
    nextSignals: 0,
    viteSignals: 0,
  };
  for (const file of files) countSignalsForFile(file, signals);
  return signals;
}

function bestLanguageArchetype(
  signals: LanguageSignals,
  manifestNames: Set<string>,
): { archetype: ProjectArchetype; score: number } | null {
  const languageScores: { archetype: ProjectArchetype; score: number }[] = [
    {
      archetype: 'flutter',
      score: signals.dartCount + (manifestNames.has('pubspec.yaml') ? 50 : 0),
    },
    { archetype: 'rust', score: signals.rustCount + (manifestNames.has('cargo.toml') ? 50 : 0) },
    {
      archetype: 'python',
      score: signals.pythonCount
        + (manifestNames.has('pyproject.toml') || manifestNames.has('requirements.txt') ? 50 : 0),
    },
  ];

  let best: { archetype: ProjectArchetype; score: number } | null = null;
  for (const candidate of languageScores) {
    if (best === null || candidate.score > best.score) best = candidate;
  }
  return best && best.score > 0 ? best : null;
}

export function inferArchetype(
  files: FileEntry[],
  packageCount: number,
  manifestNames: Set<string>,
): ProjectArchetype {
  if (packageCount > 0) return 'monorepo';

  const signals = collectLanguageSignals(files);
  const best = bestLanguageArchetype(signals, manifestNames);
  if (best && (signals.webCount === 0 || best.score >= signals.webCount / 2)) return best.archetype;

  if (signals.nextSignals > 0) return 'next-app';
  if (signals.viteSignals > 0) return 'vite-react';
  if (signals.webCount > 0 || manifestNames.has('package.json')) return 'node-lib';
  return 'unknown';
}
