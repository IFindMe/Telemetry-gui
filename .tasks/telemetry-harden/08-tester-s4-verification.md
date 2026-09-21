# Task 08 — Tester S4 verification: robustness matrix

- **Objective:** Prove Task-07 hardening: missing-ID, early-call, and empty-history cases no longer kill a packet's render.
- **Depends-on:** 07 (S4 fix landed).
- **Suggested owner:** Tester (single specialist, no prod-code edits).
- **Scope fence (in):** three cases only — (a) one referenced ID absent → rest of packet still renders; (b) `refreshStatus()` before `simulating` declaration point → no TDZ/ReferenceError; (c) empty/short history → charts + numerics render without throw.
- **Out-of-scope:** perf measurement (Task 10), hotfix regression (Task 02 — already covered), new fixes.
- **Inputs to read:**
  - `AgentsReport/explorer/2026-09-21_system-map-and-practices.md` §§ Step 2, Step 5 S4
  - Task-07 diff, `frontend/app.js:47,57-129,318,342-407,755-849`
- **Output format:** test script + run log: 3-row matrix (case × {no-throw, render-completes}) PASS/FAIL.
- **Verification:** all 3 rows PASS; each row fails on pre-07 code (or cite the exact guard that makes it pass).
