# Releasing

One command cuts the release; GitHub Actions publishes it.

```text
pnpm release <bump> --yes
  -> preflight -> bump version + CHANGELOG -> commit -> annotated tag -> atomic push
  -> release.yml: CI again -> verify tag -> npm publish (provenance) -> GitHub Release
```

## Steps

1. Make sure every user-visible change since the last tag is listed under `## [Unreleased]` in `CHANGELOG.md`. Compare with `git log "$(git describe --tags --abbrev=0)..HEAD" --oneline`.
2. Commit, push `main`, and wait for CI to pass.
3. Choose the bump (while the version is `0.x`):

   | Change | Bump |
   |---|---|
   | Bug fixes, docs, internal work | `patch` |
   | New command, rule, or option; any breaking change (list it under `### Changed` or `### Removed`) | `minor` |
   | Declaring the API stable | `major` |

4. Dry run (changes nothing): `pnpm release patch`
5. Release: `pnpm release patch --yes`
6. Verify. The release is done only when all three succeed:

   ```bash
   gh run watch "$(gh run list --workflow release.yml --limit 1 --json databaseId -q '.[0].databaseId')" --exit-status
   gh release view "v$(node -p "require('./package.json').version")"
   npm view unshit version
   ```

## Rules

- Never run `npm publish`, `npm version`, `git tag`, or `gh release create` by hand.
- Never move, delete, or reuse a pushed tag. A bad release is fixed by a new patch release.
- Never bypass a failed check. Fix the cause.

## When something fails

| Where | What to do |
|---|---|
| Preflight | Nothing was changed. Fix what it reports and run again. |
| `git push` | The commit and tag exist only locally. Fix the cause, then run `git push --atomic origin main refs/tags/vX.Y.Z`. |
| Workflow, transient error | `gh run rerun <id> --failed`. Publish and Release steps skip work already done. |
| Workflow, code error | Fix it on `main` and cut the next patch version. |

## One-time setup (maintainer)

The workflow publishes with [npm trusted publishing](https://docs.npmjs.com/trusted-publishers), so no token is stored in the repo.
On npmjs.com open the `unshit` package, then **Settings → Trusted Publisher → GitHub Actions**:

- Organization or user: `elbayoumi`
- Repository: `unshit`
- Workflow filename: `release.yml`
