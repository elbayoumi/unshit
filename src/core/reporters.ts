import type { Finding, ScoreBreakdown } from '../contracts.js';
import { VERSION } from '../version.js';

export type OutputFormat = 'human' | 'json' | 'sarif' | 'markdown';

export function formatScanOutput(
  findings: Finding[],
  score: ScoreBreakdown,
  format: OutputFormat,
): string {
  if (format === 'json') {
    return JSON.stringify({ score, findings }, null, 2);
  }

  if (format === 'sarif') {
    return JSON.stringify(
      {
        $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
        version: '2.1.0',
        runs: [
          {
            tool: { driver: { name: 'unshit', version: VERSION } },
            results: findings.map((f) => ({
              ruleId: f.ruleId,
              level: f.severity === 'error' ? 'error' : f.severity === 'warn' ? 'warning' : 'note',
              message: { text: f.message },
              locations: [
                {
                  physicalLocation: {
                    artifactLocation: { uri: f.file },
                    region: { startLine: f.span.line, startColumn: f.span.column },
                  },
                },
              ],
            })),
          },
        ],
      },
      null,
      2,
    );
  }

  if (format === 'markdown') {
    const lines = [
      `# unshit Report — Score: **${score.score}/100 (${score.grade})**`,
      '',
      `Scanned **${score.totalFiles}** files (${score.totalLines} lines) · **${score.totalFindings}** findings`,
      '',
      '| Severity | Rule | Location | Message |',
      '|---|---|---|---|',
      ...findings.slice(0, 100).map(
        (f) => `| ${f.severity} | \`${f.ruleId}\` | \`${f.file}:${f.span.line}\` | ${f.message} |`,
      ),
    ];
    return lines.join('\n');
  }

  const header = [
    `unshit · Health Score: ${score.score}/100 (Grade ${score.grade})`,
    `Files: ${score.totalFiles} | Lines: ${score.totalLines} | Findings: ${score.totalFindings} (error:${score.bySeverity.error}, warn:${score.bySeverity.warn}, info:${score.bySeverity.info})`,
    '',
  ];
  const rows = findings.slice(0, 60).map(
    (f) => `  ${f.severity.toUpperCase().padEnd(5)} ${f.ruleId.padEnd(24)} ${f.file}:${f.span.line}:${f.span.column} — ${f.message}`,
  );
  if (findings.length > 60) {
    rows.push(`  ... and ${findings.length - 60} more (use --format json or markdown for full list)`);
  }
  return [...header, ...rows].join('\n');
}
