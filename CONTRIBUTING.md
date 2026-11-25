# Contributing

Thanks for helping keep codebases clean.

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
```

1. Branch from `main` and keep each pull request focused.
2. Add a test for every new rule or bug fix.
3. Add user-visible changes under `## [Unreleased]` in `CHANGELOG.md`.
4. Use [Conventional Commits](https://www.conventionalcommits.org/).

New rules belong in `src/detectors/` and are registered in `src/detectors/index.ts`. Read [ARCHITECTURE.md](./ARCHITECTURE.md) first.
Maintainers release with [RELEASING.md](./RELEASING.md).
