# Agent instructions

`unshit` is a TypeScript CLI (Node >= 22, pnpm). The only runtime dependency is `typescript`; do not add more.

## Commands

- Install: `pnpm install --frozen-lockfile`
- Check: `pnpm run typecheck && pnpm test`

## Working rules

- Keep scanning read-only and `fix` dry-run by default (invariants in `ARCHITECTURE.md`).
- Add a test for every new rule or bug fix.
- Add every user-visible change under `## [Unreleased]` in `CHANGELOG.md`, in the same commit.
- Use Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`).
- `package.json` is the only place the version lives. Code reads it through `src/version.ts`.
- The working tree may contain another agent's unfinished work. Do not discard, stash, or commit changes you did not make.

## Releasing

When asked to release, publish, tag, or ship a version (including "رفع", "ارفع نسخة", "اعمل ريليز"), read [RELEASING.md](./RELEASING.md) and follow it exactly.

- Use `pnpm release` only. Never run `npm publish`, `npm version`, `git tag`, or `gh release create` yourself.
- Run the dry run first and show the user the version and notes. Add `--yes` only if the user asked for the release itself.
- A request to "push" or "commit" is not a request to release. If the Arabic "رفع" could mean either, ask.
- Report success only after the workflow, the GitHub Release, and npm all show the new version.
