// Minimal Keep a Changelog helpers shared by release.mjs and release-notes.mjs.

/** Returns the body of the `## [name]` section, or '' when it is missing or empty. */
export function sectionBody(changelog, name) {
  const lines = changelog.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`## [${name}]`));
  if (start === -1) return '';
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## [') || /^\[[^\]]+\]: /.test(line));
  return rest.slice(0, end === -1 ? undefined : end).join('\n').trim();
}

/** Moves the Unreleased entries under a new `## [version] - date` heading. */
export function cutRelease(changelog, version, date) {
  return changelog.replace('## [Unreleased]', `## [Unreleased]\n\n## [${version}] - ${date}`);
}
