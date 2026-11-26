import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.js';
import { runScan } from '../src/core/scanner.js';

async function withTempProject(files: Record<string, string>, fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'unshit-css-nesting-r15-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(dir, name), content, 'utf8');
    }
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('css/duplicate-selector: nested & expands to match top-level (reproducer)', async () => {
  await withTempProject(
    {
      'style.scss': `.card {
  &:hover { color: inherit; }
}
.card:hover { color: inherit; }
`,
    },
    async (dir) => {
      const scan = await runScan(dir, { ...DEFAULT_CONFIG });
      const dups = scan.findings.filter((f) => f.ruleId === 'css/duplicate-selector');
      assert.equal(dups.length, 1);
    },
  );
});

test('css/duplicate-selector: nested & with selector list expands (cartesian)', async () => {
  await withTempProject(
    {
      'style.scss': `.a, .b {
  &:hover {}
}
.b:hover {}
`,
    },
    async (dir) => {
      const scan = await runScan(dir, { ...DEFAULT_CONFIG });
      const dups = scan.findings.filter((f) => f.ruleId === 'css/duplicate-selector');
      assert.equal(dups.length, 1);
    },
  );
});

test('css/duplicate-selector: nested selector without & becomes parent descendant', async () => {
  await withTempProject(
    {
      'style.scss': `.card {
  .title {}
}
.card .title {}
`,
    },
    async (dir) => {
      const scan = await runScan(dir, { ...DEFAULT_CONFIG });
      const dups = scan.findings.filter((f) => f.ruleId === 'css/duplicate-selector');
      assert.equal(dups.length, 1);
    },
  );
});

test('css/duplicate-selector: &__title (BEM) is not expanded (no false positive)', async () => {
  await withTempProject(
    {
      'style.scss': `.card {
  &__title { color: red; }
}
.card__title { color: red; }
`,
    },
    async (dir) => {
      const scan = await runScan(dir, { ...DEFAULT_CONFIG });
      const dups = scan.findings.filter((f) => f.ruleId === 'css/duplicate-selector');
      assert.equal(dups.length, 0);
    },
  );
});

test('css/duplicate-selector: same selector in different @media scopes does not duplicate', async () => {
  await withTempProject(
    {
      'style.css': `.card:hover { color: red; }
@media (max-width: 600px) {
  .card:hover { color: blue; }
}
`,
    },
    async (dir) => {
      const scan = await runScan(dir, { ...DEFAULT_CONFIG });
      const dups = scan.findings.filter((f) => f.ruleId === 'css/duplicate-selector');
      assert.equal(dups.length, 0);
    },
  );
});

test('css/duplicate-selector: nested native CSS in .css file is detected', async () => {
  await withTempProject(
    {
      'style.css': `.card {
  &:hover { color: inherit; }
}
.card:hover { color: inherit; }
`,
    },
    async (dir) => {
      const scan = await runScan(dir, { ...DEFAULT_CONFIG });
      const dups = scan.findings.filter((f) => f.ruleId === 'css/duplicate-selector');
      assert.equal(dups.length, 1);
    },
  );
});

test('css/duplicate-selector: existing flat duplicate case still reports 1', async () => {
  await withTempProject(
    {
      'style.css': `.card { padding: 8px; }
.card { padding: 8px; }
`,
    },
    async (dir) => {
      const scan = await runScan(dir, { ...DEFAULT_CONFIG });
      const dups = scan.findings.filter((f) => f.ruleId === 'css/duplicate-selector');
      assert.equal(dups.length, 1);
    },
  );
});

test('css/duplicate-selector: same nested & under different grandparents is not a duplicate', async () => {
  await withTempProject(
    {
      'style.scss': `.a {
  .b {
    &:hover { color: red; }
  }
}
.c {
  .b {
    &:hover { color: blue; }
  }
}
`,
    },
    async (dir) => {
      const scan = await runScan(dir, { ...DEFAULT_CONFIG });
      assert.equal(scan.findings.filter((f) => f.ruleId === 'css/duplicate-selector').length, 0);
    },
  );
});

test('css/duplicate-selector: BEM suffix under different parents is not a duplicate', async () => {
  await withTempProject(
    {
      'style.scss': `.x {
  &__title { color: red; }
}
.y {
  &__title { color: blue; }
}
.z {
  &__title { color: red; }
  &__title { color: blue; }
}
`,
    },
    async (dir) => {
      const scan = await runScan(dir, { ...DEFAULT_CONFIG });
      const dups = scan.findings.filter((f) => f.ruleId === 'css/duplicate-selector');
      // Only the repeated `&__title` inside `.z` is a duplicate.
      assert.equal(dups.length, 1);
      assert.equal(dups[0]?.span.line, 9);
    },
  );
});

test('css/duplicate-selector: deep nesting expands through every ancestor', async () => {
  await withTempProject(
    {
      'style.scss': `.a {
  .b {
    &:hover { color: red; }
  }
}
.a .b:hover { color: blue; }
`,
    },
    async (dir) => {
      const scan = await runScan(dir, { ...DEFAULT_CONFIG });
      assert.equal(scan.findings.filter((f) => f.ruleId === 'css/duplicate-selector').length, 1);
    },
  );
});
