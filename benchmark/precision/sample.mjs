#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyCorpusToTmp, sampleStratified, scanCorpus, stableFindingId } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const BIN = join(REPO_ROOT, 'bin', 'unshit.js');
const DIST_ENTRY = join(REPO_ROOT, 'dist', 'src', 'cli.js');
const CORPUS_DIR = resolve(process.env.UNSHIT_BENCH_CORPUS ?? '/Volumes/data/projects/unshit-bench/corpus');
const CORPORA = ['hono', 'zod', 'execa', 'fastify', 'commander.js'];
const SEED = 20261128;
const PER_RULE_PER_CORPUS = 15;
const OUT = join(HERE, 'sample.json');

function die(msg) {
  console.error(`precision-sample: ${msg}`);
  process.exit(2);
}

if (!existsSync(CORPUS_DIR)) die(`missing corpus dir ${CORPUS_DIR}`);
for (const c of CORPORA) {
  if (!existsSync(join(CORPUS_DIR, c))) die(`missing corpus ${c} in ${CORPUS_DIR}`);
}

if (!existsSync(DIST_ENTRY)) {
  console.error('dist missing; building...');
  execFileSync('pnpm', ['run', 'build'], { cwd: REPO_ROOT, stdio: 'inherit' });
}
if (!existsSync(BIN)) die(`missing CLI entry ${BIN}`);

const allFindings = [];
const perCorpusCounts = {};

for (const corpus of CORPORA) {
  const src = join(CORPUS_DIR, corpus);
  const { base, work } = copyCorpusToTmp(src);
  console.error(`scanning ${corpus}...`);
  try {
    const findings = scanCorpus(BIN, work, REPO_ROOT);
    perCorpusCounts[corpus] = { total: findings.length, byRule: {} };
    for (const f of findings) {
      perCorpusCounts[corpus].byRule[f.ruleId] = (perCorpusCounts[corpus].byRule[f.ruleId] ?? 0) + 1;
      allFindings.push({
        corpus,
        ruleId: f.ruleId,
        file: f.file,
        line: f.span?.line ?? 1,
        column: f.span?.column ?? 1,
        endLine: f.span?.endLine ?? f.span?.line ?? 1,
        endColumn: f.span?.endColumn ?? f.span?.column ?? 1,
        message: f.message ?? '',
        evidence: f.evidence ?? '',
        severity: f.severity,
        category: f.category,
        tier: f.tier,
        fixability: f.fixability,
      });
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

const sampled = sampleStratified(allFindings, { seed: SEED, perRulePerCorpus: PER_RULE_PER_CORPUS, corpora: CORPORA });
const sample = sampled.map((f) => ({
  id: stableFindingId(f),
  corpus: f.corpus,
  ruleId: f.ruleId,
  file: f.file,
  line: f.line,
  message: f.message,
  evidence: f.evidence,
}));

const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  seed: SEED,
  perRulePerCorpus: PER_RULE_PER_CORPUS,
  corpora: CORPORA,
  corpusDir: CORPUS_DIR,
  totalFindings: allFindings.length,
  sampledCount: sample.length,
  perCorpusCounts,
  sample,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(output, null, 2) + '\n');
console.error(`wrote ${OUT} (${sample.length} sampled from ${allFindings.length})`);

// Summary by rule
const byRule = {};
for (const s of sample) {
  byRule[s.ruleId] = (byRule[s.ruleId] ?? 0) + 1;
}
console.log(JSON.stringify({ seed: SEED, perRulePerCorpus: PER_RULE_PER_CORPUS, totalFindings: allFindings.length, sampled: sample.length, byRule }, null, 2));
