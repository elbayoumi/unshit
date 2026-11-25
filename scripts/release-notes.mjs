#!/usr/bin/env node
// Prints the CHANGELOG.md section for a version; used as the GitHub Release body.
import { readFileSync } from 'node:fs';
import { sectionBody } from './changelog.mjs';

const version = process.argv[2];
const notes = version ? sectionBody(readFileSync('CHANGELOG.md', 'utf8'), version) : '';
if (!notes) {
  console.error(`release-notes: CHANGELOG.md has no notes for version "${version ?? ''}"`);
  process.exit(1);
}
console.log(notes);
