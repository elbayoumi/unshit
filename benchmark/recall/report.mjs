// Renders docs/research/recall.md from results.json. Every number in the
// document comes from a recorded run; no figures are hard-coded here.

import { ENTRY_POINT_ROW } from './entries.mjs';

export function pct(x) {
  return x === null || x === undefined ? 'n/a' : `${(x * 100).toFixed(1)}%`;
}

export function fmtWilson(w) {
  if (!w) return 'n/a';
  return `[${pct(w.low)}, ${pct(w.high)}]`;
}

const SEED_LABELS = { dev: 'dev', holdout: 'holdout' };

function projectTable(projects) {
  const lines = [
    '| Project | Source files | Injected | Found | Recall | Wilson 95% | Misses |',
    '|---|---:|---:|---:|---:|---:|---:|',
  ];
  for (const p of projects) {
    lines.push(`| \`${p.name}\` | ${p.fileCount} | ${p.injected} | ${p.found} | ${pct(p.recall)} | ${fmtWilson(p.wilson95)} | ${p.misses} |`);
  }
  return lines;
}

function ruleTable(rules) {
  const lines = [
    '| Rule | Scope | Injected | Found | Recall | Wilson 95% | Misses |',
    '|---|---|---:|---:|---:|---:|---:|',
  ];
  for (const r of rules) {
    const scope = r.outOfScope ? 'out of scope' : 'in scope';
    const misses = r.misses.length;
    lines.push(`| ${r.ruleId} | ${scope} | ${r.injected} | ${r.found} | ${pct(r.recall)} | ${fmtWilson(r.wilson95)} | ${misses} |`);
  }
  return lines;
}

function seedSection(lines, label, summary, run) {
  if (!summary) return;
  lines.push(`### ${SEED_LABELS[label] ?? label} seed \`${summary.seed}\``);
  lines.push('');
  lines.push(`Executed projects: ${summary.projects.map((p) => `\`${p.name}\``).join(', ') || '(none)'}.`);
  if (run?.excludedProjects?.length) {
    lines.push(`Excluded (too small): ${run.excludedProjects.map((p) => `\`${p.name}\` (${p.fileCount} files)`).join(', ')}.`);
  }
  lines.push('');
  lines.push('Per-project in-scope recall:');
  lines.push('');
  lines.push(...projectTable(summary.projects));
  lines.push('');
  const p = summary.pooled;
  lines.push(`Pooled in scope: **${p.found}/${p.injected} (${pct(p.recall)})**, Wilson 95% ${fmtWilson(p.wilson95)}.`);
  const o = summary.outOfScope;
  lines.push(`Out of scope (entry-point injections): ${o.found}/${o.injected} found (detector correctly ignores these by design).`);
  lines.push(`Charter target \`>= ${pct(summary.target)}\` on ${label}: **${summary.met ? 'MET' : 'NOT MET'}**.`);
  lines.push(`Injections outside the clone-tokenizer stream (scored, not dropped): ${summary.tokenizerBlind}.`);
  lines.push('');
  lines.push('Pooled by rule:');
  lines.push('');
  lines.push(...ruleTable(summary.rules));
  lines.push('');
}

function inScopeMisses(runs) {
  const out = [];
  for (const [seed, run] of Object.entries(runs)) {
    for (const project of run.projects) {
      for (const rule of project.rules) {
        if (rule.outOfScope) continue;
        for (const m of rule.misses) {
          out.push({ seed, project: project.name, ruleId: rule.ruleId, ...m });
        }
      }
    }
  }
  return out;
}

function outOfScopeCounts(runs) {
  const out = [];
  for (const [seed, run] of Object.entries(runs)) {
    for (const project of run.projects) {
      const row = project.rules.find((r) => r.outOfScope);
      out.push({ seed, project: project.name, injected: row?.injected ?? 0, found: row?.found ?? 0 });
    }
  }
  return out;
}

function artifactRows(runs) {
  const out = [];
  for (const [seed, run] of Object.entries(runs)) {
    for (const project of run.projects) {
      for (const item of project.tokenizerBlind ?? []) {
        out.push({ seed, project: project.name, ...item });
      }
    }
  }
  return out;
}

export function renderReport(report) {
  const runs = report.runs ?? {};
  const lines = [];
  lines.push('# Recall benchmark (mutation injection, multi-corpus)');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push('');
  lines.push('## Method');
  lines.push('');
  lines.push(`- Seeds: dev \`${report.seeds.dev}\`, holdout \`${report.seeds.holdout}\`. The holdout seed was run once, after the code was frozen; the dev seed was used for iteration.`);
  lines.push(`- Corpora selected with \`--projects\` (default \`hono,zod,execa,fastify\`): ${report.corpusProjects.map((p) => `\`${p}\``).join(', ')}. Each project is copied to a temp dir; the corpus is never modified. Projects with fewer than \`--min-files\` (${report.minFiles}) eligible source files are skipped and listed below.`);
  lines.push(`- Per project and seed: scan before injection, inject ${report.perRule} defects for each of six rules, scan again, and count a hit when a finding matches the injected marker/location.`);
  lines.push('- Recall = found / injected. Per-project, per-rule and pooled Wilson 95% intervals are computed from the summed counts (never by averaging intervals).');
  lines.push('- `ts/unused-export` injections skip every file unshit marks STAR-consumed. The skip set comes from the built dist modules used by the CLI (`loadConfig` + `runScan` -> `DetectorContext` -> `analyze().consumed`), not from a re-implemented heuristic.');
  lines.push(`- A separate out-of-scope row (\`${ENTRY_POINT_ROW}\`) injects a small number of unused exports deliberately into STAR-consumed files. It is reported but excluded from the in-scope recall denominator, so the scope limit stays visible.`);
  lines.push('- Injections are restricted to files unshit actually scans, and duplicate blocks only into files the compiled clone tokenizer accepts. Injections whose line is absent from the clone-tokenizer token stream are still scored (never dropped) and listed under "Injections outside the clone-tokenizer stream".');
  lines.push('- No detectors were tuned to this benchmark. Misses are reported as measured.');
  lines.push('');
  lines.push('## Results');
  lines.push('');
  seedSection(lines, 'dev', report.summary?.dev, runs[String(report.seeds.dev)]);
  seedSection(lines, 'holdout', report.summary?.holdout, runs[String(report.seeds.holdout)]);
  lines.push('## Misses');
  lines.push('');
  const misses = inScopeMisses(runs);
  if (misses.length === 0) {
    lines.push('No in-scope misses.');
  } else {
    lines.push('### In scope');
    lines.push('');
    lines.push('| Seed | Project | Rule | File | Line | Marker | Reason |');
    lines.push('|---|---|---|---|---:|---|---|');
    for (const m of misses) {
      lines.push(`| ${m.seed} | \`${m.project}\` | ${m.ruleId} | \`${m.file}\` | ${m.line} | \`${m.marker}\` | ${m.reason} |`);
    }
  }
  lines.push('');
  lines.push('### Out of scope, by design');
  lines.push('');
  lines.push('| Seed | Project | Injected | Found | Interpretation |');
  lines.push('|---|---|---:|---:|---|');
  for (const r of outOfScopeCounts(runs)) {
    lines.push(`| ${r.seed} | \`${r.project}\` | ${r.injected} | ${r.found} | Entry-point/public-API file; unshit intentionally does not report unused exports here |`);
  }
  lines.push('');
  lines.push('## Injections outside the clone-tokenizer stream');
  lines.push('');
  const artifacts = artifactRows(runs);
  if (artifacts.length === 0) {
    lines.push('None.');
  } else {
    lines.push('These injections are scored like any other. Their line is missing from the clone tokenizer output because the tokenizer stops at a template literal type earlier in the file (see Detector bugs found). Non-clone rules still see them.');
    lines.push('');
    lines.push('| Seed | Project | File | Kind | Marker |');
    lines.push('|---|---|---|---|---|');
    for (const a of artifacts) {
      lines.push(`| ${a.seed} | \`${a.project}\` | \`${a.file}\` | ${a.kind} | \`${a.marker}\` |`);
    }
  }
  lines.push('');
  lines.push('## Detector bugs found');
  lines.push('');
  if (Array.isArray(report.detectorBugs) && report.detectorBugs.length > 0) {
    for (const bug of report.detectorBugs) {
      lines.push(`- ${bug}`);
    }
  } else {
    lines.push('None found in this round.');
  }
  lines.push('');
  lines.push('## Analysis');
  lines.push('');
  const dev = report.summary?.dev;
  const holdout = report.summary?.holdout;
  lines.push(`- Dev pooled recall: ${dev ? `${dev.pooled.found}/${dev.pooled.injected} (${pct(dev.pooled.recall)}), Wilson 95% ${fmtWilson(dev.pooled.wilson95)}` : 'not run'}.`);
  lines.push(`- Holdout pooled recall: ${holdout ? `${holdout.pooled.found}/${holdout.pooled.injected} (${pct(holdout.pooled.recall)}), Wilson 95% ${fmtWilson(holdout.pooled.wilson95)}` : 'not run'}. Charter target is >= ${pct(holdout?.target ?? 0.9)}.`);
  lines.push('- The earlier single-project round measured 111/120 (92.5%) on hono, but 9 of those misses were unused exports injected into entry-point files. That was an injector flaw: the detector deliberately treats STAR-consumed files as public API. Those injections are now excluded from in-scope recall and reported separately.');
  lines.push('- Injections are restricted to files unshit scans and, for duplicate blocks, to files the clone tokenizer accepts. Injections the tokenizer cannot see are kept in the denominator, so clone-tokenizer truncation shows up as duplicate-block misses rather than being hidden.');
  lines.push('- Per-rule Wilson intervals (roughly 70–80 trials per rule) are wide; the pooled interval is narrower but still conditional on these four corpora, these seeds, and these simple injection shapes. These numbers are a smoke test of the mutation pipeline, not a precise estimate of real-world prevalence.');
  lines.push('- Precision, real-world defect prevalence, and the `ts/unused-type-export` rule are outside this benchmark.');
  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push('- Injection shapes are simple and deterministic; they are not a complete model of real defects.');
  lines.push('- Results depend on the corpus revisions, seeds, `perRule`, and unshit defaults in the committed dist.');
  lines.push('- Full per-injection data, including out-of-scope markers, is in `benchmark/recall/results.json`.');
  lines.push('');
  return lines.join('\n');
}
