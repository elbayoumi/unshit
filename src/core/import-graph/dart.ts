import path from 'node:path';
import ts from 'typescript';
import type { FileEntry } from '../../contracts.js';
import type { PubspecInfo, ResolvedImport } from './types.js';
import { normalizeRel, findNearestConfigFile, resolveFromBase, toRel } from './util.js';

export function loadPubspecInfo(
  startDir: string,
  rootDir: string,
  pubspecCache: Map<string, PubspecInfo | null>,
): PubspecInfo | null {
  const dirKey = path.resolve(startDir);
  if (pubspecCache.has(dirKey)) return pubspecCache.get(dirKey) ?? null;

  const configPath = findNearestConfigFile(dirKey, rootDir, 'pubspec.yaml');
  let info: PubspecInfo | null = null;
  if (configPath) {
    const text = ts.sys.readFile(configPath) ?? '';
    const nameMatch = /^\s*name:\s*['"]?([^\s'"#]+)/m.exec(text);
    const rootRel = toRel(rootDir, path.dirname(configPath));
    if (nameMatch?.[1] && rootRel !== null) {
      info = { rootRel: normalizeRel(rootRel), name: nameMatch[1] };
    }
  }
  pubspecCache.set(dirKey, info);
  return info;
}

function isInternalDartSpec(spec: string, pubspec: PubspecInfo | null): boolean {
  const match = /^package:([^/]+)/.exec(spec);
  if (match) return !!pubspec && match[1] === pubspec.name;
  if (/^[a-z][a-z\d+.-]*:/i.test(spec)) return false; // dart:, http:, ...
  // Dart relative URIs may omit a leading "./".
  return true;
}

function resolveDartSpec(
  spec: string,
  fromRel: string,
  pubspec: PubspecInfo | null,
  fileSet: Set<string>,
): string | null {
  const clean = spec.split('?')[0] ?? spec;
  const match = /^package:([^/]+)(?:\/(.+))?$/.exec(clean);
  if (match) {
    if (!pubspec || match[1] !== pubspec.name || !match[2]) return null;
    return resolveFromBase(
      path.posix.join(pubspec.rootRel, 'lib'), match[2], fileSet, ['', '.dart'],
    );
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(clean)) return null;
  return resolveFromBase(path.posix.dirname(fromRel), clean, fileSet, ['', '.dart']);
}

export function parseDartImports(
  file: FileEntry,
  pubspec: PubspecInfo | null,
  fileSet: Set<string>,
): ResolvedImport[] {
  const results: ResolvedImport[] = [];
  for (let i = 0; i < file.lines.length; i++) {
    const trimmed = (file.lines[i] ?? '').trim();
    const match = /^(?:import|export)\s+r?(['"])([^'"]+)\1/.exec(trimmed);
    const spec = match?.[2];
    if (!spec) continue;
    const internal = isInternalDartSpec(spec, pubspec);
    results.push({
      spec,
      target: internal ? resolveDartSpec(spec, file.relPath, pubspec, fileSet) : null,
      line: i + 1,
      internal,
    });
  }
  return results;
}