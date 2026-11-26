function countUnshit(findings) {
  const byRule = {};
  for (const f of findings) byRule[f.ruleId] = (byRule[f.ruleId] || 0) + 1;
  const sum = (ids) => ids.reduce((a, id) => a + (byRule[id] || 0), 0);
  return {
    total: findings.length,
    unusedExports: sum(['ts/unused-export', 'ts/unused-type-export']),
    unusedFiles: byRule['ts/unused-file'] || 0,
    unusedDependencies: byRule['deps/unused-dependency'] || 0,
    unlistedDependencies: byRule['deps/unlisted-dependency'] || 0,
    duplicateBlocks: byRule['code/duplicate-block'] || 0,
    importCycles: byRule['arch/import-cycle'] || 0,
    highComplexity: byRule['code/high-complexity'] || 0,
    godFiles: byRule['react/god-file'] || 0,
    byRule,
  };
}

function countKnip(json) {
  if (!json || !Array.isArray(json.issues)) {
    return { total: 0, issues: 0, unusedFiles: 0, unusedExports: 0, unusedTypes: 0, unusedDependencies: 0, unusedDevDependencies: 0, unlisted: 0, unresolved: 0, binaries: 0, error: 'unparseable' };
  }
  let unusedFiles = 0;
  let unusedExports = 0;
  let unusedTypes = 0;
  let unusedDependencies = 0;
  let unusedDevDependencies = 0;
  let unlisted = 0;
  let unresolved = 0;
  let binaries = 0;
  let duplicates = 0;
  let enumMembers = 0;
  let namespaceMembers = 0;
  let total = 0;
  for (const issue of json.issues) {
    const files = issue.files || [];
    const exports = issue.exports || [];
    const types = issue.types || [];
    const deps = issue.dependencies || [];
    const devDeps = issue.devDependencies || [];
    const unlistedItems = issue.unlisted || [];
    const unresolvedItems = issue.unresolved || [];
    const binaryItems = issue.binaries || [];
    const duplicateItems = issue.duplicates || [];
    const enumItems = issue.enumMembers || [];
    const nsItems = issue.namespaceMembers || [];
    unusedFiles += files.length;
    unusedExports += exports.length;
    unusedTypes += types.length;
    unusedDependencies += deps.length;
    unusedDevDependencies += devDeps.length;
    unlisted += unlistedItems.length;
    unresolved += unresolvedItems.length;
    binaries += binaryItems.length;
    duplicates += duplicateItems.length;
    enumMembers += enumItems.length;
    namespaceMembers += nsItems.length;
    total += files.length + exports.length + types.length + deps.length + devDeps.length + unlistedItems.length + unresolvedItems.length + binaryItems.length + duplicateItems.length + enumItems.length + nsItems.length + (issue.subpaths || []).length + (issue.catalog || []).length + (issue.catalogReferences || []).length + (issue.optionalPeerDependencies || []).length;
  }
  return {
    total,
    issues: json.issues.length,
    unusedFiles,
    unusedExports: unusedExports + unusedTypes,
    unusedExportsOnly: unusedExports,
    unusedTypes,
    unusedDependencies: unusedDependencies + unusedDevDependencies,
    unusedDependenciesOnly: unusedDependencies,
    unusedDevDependencies,
    unlisted,
    unresolved,
    binaries,
  };
}

function countJscpd(json) {
  if (!json || !json.statistics || !json.statistics.total) return { clones: 0, duplicatedLines: 0, error: 'no report' };
  const t = json.statistics.total;
  return { clones: t.clones || 0, duplicatedLines: t.duplicatedLines || 0, duplicatedTokens: t.duplicatedTokens || 0, sources: t.sources || 0 };
}

function countDepcruise(json) {
  if (!json || !json.summary) return { total: 0, error: 'unparseable' };
  const vs = json.summary.violations || [];
  const byRule = {};
  for (const v of vs) {
    const name = (v.rule && (v.rule.name || v.rule)) || v.rule || 'unknown';
    byRule[name] = (byRule[name] || 0) + 1;
  }
  return {
    total: vs.length,
    modules: json.summary.totalCruised || 0,
    dependencies: json.summary.totalDependenciesCruised || 0,
    importCycles: byRule['no-circular'] || 0,
    orphans: byRule['no-orphans'] || 0,
    unresolvable: byRule['not-to-unresolvable'] || 0,
    byRule,
  };
}

function countOxlint(json) {
  if (!json || !Array.isArray(json.diagnostics)) return { total: 0, error: 'unparseable' };
  const bySeverity = {};
  for (const d of json.diagnostics) bySeverity[d.severity] = (bySeverity[d.severity] || 0) + 1;
  return { total: json.diagnostics.length, bySeverity, files: json.number_of_files || 0, rules: json.number_of_rules || 0 };
}

function countBiome(json) {
  if (!json) return { total: 0, error: 'unparseable' };
  const diags = Array.isArray(json.diagnostics) ? json.diagnostics.length : 0;
  const s = json.summary || {};
  return { total: diags, diagnostics: diags, errors: s.errors || 0, warnings: s.warnings || 0, infos: s.infos || 0 };
}


export { countUnshit, countKnip, countJscpd, countDepcruise, countOxlint, countBiome };
