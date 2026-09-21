# Task 02 — Regression: synthetic packet across all 4 sources

- **Objective:** Prove the Task-01 hotfix holds for every source (serial/sim/imu/replay), not just sim.
- **Depends-on:** 01 (hotfix landed).
- **Suggested owner:** Tester (single specialist, no prod-code edits except test harness).
- **Scope fence (in):** a regression test/harness feeding ONE synthetic full-field packet through `update()` per source path; assert (a) no throw, (b) a numeric DOM write (e.g. velocity/altitude element changes from init), (c) `updateRocket` invoked.
- **Out-of-scope:** fixing code (send back to Builder on failure), perf measurement (Task 10), S4 robustness cases (Task 08).
- **Inputs to read:**
  - `.opencode/AgentsReport/detective/2026-09-21_sim-mode-freeze.md` §§ Step 4, Handoff (payload field list, "verify all four sources post-fix")
  - `frontend/app.js:342-407` (update fan-out order), `frontend/index.html` element IDs
  - Task 01 diff (what was fixed)
- **Output format:** test file or script + run log: per-source PASS/FAIL table (serial/sim/imu/replay × {no-throw, numeric-write, updateRocket-called}).
- **Verification:** all 4 rows PASS; harness fails on pre-fix code (guard against false-positive — e.g. stash `velocity: []` and re-run, or cite Detective's Node repro).
