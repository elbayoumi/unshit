# Known gaps in the frozen rule suite

This file documents every case that is excluded from the frozen suite's pass
gate. Exclusions are **explicit and machine-readable** in
[`known-gaps.json`](./known-gaps.json); the runner rejects stale entries that
no longer correspond to a current miss or false positive. Only the six rules
added in round 9 may be listed, so the original unused-code gates are
unchanged.

For each gap: the case, the expected/actual finding key (`ruleId`, `file`,
`symbol`), why the detector misses or over-reports, and the owner/status. A gap
is a report for the detector owner, never a label edit: frozen fixtures and
their `expected.json` stay intact. When a detector is fixed, remove the gap
entry in the same commit and confirm the suite still prints `RESULT: PASS`.

Eval cases are informational (not gated), so their misses are documented here
but are not listed in `known-gaps.json`.

## Current gaps

None. All three previously documented `arch/import-cycle` gaps were fixed in
round 10 and their entries removed from `known-gaps.json`:

- `holdout/cy-lazy-three` (gated): dynamic `import()` now emits a graph edge, so
  the lazy `a -> b` edge closes the `b -> c -> a` static chain.
- `eval/cy-dynamic` (informational): same fix closes the two-module lazy cycle.
- `eval/cy-self-import` (informational): self imports are recorded as one-node
  cycles without changing import reachability for other detectors.

Evidence and the corpus false-positive check are in
[`docs/research/import-cycle-dynamic.md`](../../docs/research/import-cycle-dynamic.md).
