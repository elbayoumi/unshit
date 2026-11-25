import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { addFeedback, readFeedback, summarizeFeedback } from '../src/core/feedback.js';

test('feedback notes persist as JSONL and summarize by rule ordered by false positives', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'unshit-feedback-'));
  try {
    assert.deepEqual(await readFeedback(dir), []);
    await addFeedback(dir, { kind: 'improvement', rule: 'ts/unused-export', note: 'resolve barrel files' });
    await addFeedback(dir, { kind: 'false-positive', rule: 'react/god-file', file: 'a.tsx', note: 'generated' });
    await addFeedback(dir, { kind: 'false-positive', rule: 'react/god-file', note: 'test fixture' });
    const entries = await readFeedback(dir);
    assert.equal(entries.length, 3);
    const md = summarizeFeedback(entries);
    assert.ok(md.indexOf('react/god-file') < md.indexOf('ts/unused-export'));
    assert.match(md, /2 false-positive/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
