import type { DetectorContext, FileEntry, Finding, LayerRule, UnshitConfig } from '../contracts.js';
import { buildImportGraph } from '../core/import-graph.js';
import inferShape, { type ProjectShape } from '../core/project-shape.js';
import type { ScanResult } from '../core/scanner.js';
import { computeStructureVerdict } from '../core/structure-verdict.js';
import { mcpRelativePath } from './rel-path.js';

interface FileArchitecture {
  path: string;
  layer: string | null;
  mayImport: string[];
  mayImportFiles: string[];
  imports: string[];
  importedBy: string[];
  feature: ReturnType<ProjectShape['featureOf']>;
  bucket: ReturnType<ProjectShape['bucketOf']>;
  findings: Finding[];
}

type ArchitectureExplainOutput =
  | { error: string }
  | {
      layers: LayerRule[];
      structure: UnshitConfig['structure'] | null;
      shape: {
        packages: string[];
        sourceRoots: string[];
        archetype: string;
        layout: string;
        featureContainers: string[];
        largestFlatDir: ProjectShape['largestFlatDir'];
      };
      verdict: ReturnType<typeof computeStructureVerdict>;
      file?: FileArchitecture;
    };

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const pattern = escaped
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\u0000/g, '.*');
  return new RegExp(`^${pattern}$`);
}

function layerFor(layers: LayerRule[] | undefined, relPath: string): LayerRule | null {
  for (const layer of layers ?? []) {
    if (layer.include.some((glob) => globToRegExp(glob).test(relPath))) return layer;
  }
  return null;
}

function allowedFiles(layers: LayerRule[] | undefined, files: FileEntry[], layer: LayerRule | null): string[] {
  const allowed = new Set(layer?.allowImportsFrom ?? []);
  if (layer) allowed.add(layer.name);
  const paths: string[] = [];
  for (const file of files) {
    const name = layerFor(layers, file.relPath)?.name;
    if (name && allowed.has(name)) paths.push(file.relPath);
  }
  return paths;
}

function touchingFindings(findings: Finding[], path: string): Finding[] {
  return findings.filter((finding) =>
    (finding.category === 'architecture' || finding.ruleId.startsWith('structure/'))
    && (finding.file === path || finding.evidence.includes(path)));
}

function contextOf(scan: ScanResult): DetectorContext {
  return { rootDir: scan.rootDir, config: scan.config, files: scan.files, manifests: scan.manifests };
}

/** Read-only layer map plus, for one file, its layer, import neighbours and architecture findings. */
export function explainArchitecture(scan: ScanResult, rawPath?: string): ArchitectureExplainOutput {
  const ctx = contextOf(scan);
  const shape = inferShape(ctx);
  const map = {
    layers: scan.config.layers ?? [],
    structure: scan.config.structure ?? null,
    shape: {
      packages: shape.packages,
      sourceRoots: shape.sourceRoots,
      archetype: shape.archetype,
      layout: shape.layout,
      featureContainers: shape.featureContainers,
      largestFlatDir: shape.largestFlatDir,
    },
    verdict: computeStructureVerdict(ctx, scan.findings),
  };
  if (typeof rawPath !== 'string' || rawPath.length === 0) return map;

  const path = mcpRelativePath(scan.rootDir, rawPath);
  if (!scan.files.some((file) => file.relPath === path)) return { error: `Not a scanned file: ${rawPath}.` };

  const layer = layerFor(scan.config.layers, path);
  const graph = buildImportGraph(ctx);
  return {
    ...map,
    file: {
      path,
      layer: layer?.name ?? null,
      mayImport: layer?.allowImportsFrom ?? [],
      mayImportFiles: allowedFiles(scan.config.layers, scan.files, layer),
      imports: graph.get(path) ?? [],
      importedBy: graph.incomingOf(path) ?? [],
      feature: shape.featureOf(path),
      bucket: shape.bucketOf(path),
      findings: touchingFindings(scan.findings, path),
    },
  };
}
