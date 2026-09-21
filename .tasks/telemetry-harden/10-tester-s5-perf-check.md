# Task 10 — Tester S5 perf check: timed run

- **Objective:** Quantify Task-09 improvement with a timed run (no perf numbers exist today — Explorer §6).
- **Depends-on:** 09 (S5 fix landed).
- **Suggested owner:** Tester (single specialist, measurement only).
- **Scope fence (in):** measure — frame time / fps during 50 Hz sim, WS message Hz at client, join-burst behavior (time-to-interactive on connect with full history), packet-rate readout sanity.
- **Out-of-scope:** further optimization (send back to Builder), correctness regression (Tasks 02/08).
- **Inputs to read:**
  - `AgentsReport/explorer/2026-09-21_system-map-and-practices.md` §§ Step 2 (charts, health `:821-861`), Step 5 S5, §6 (no perf numbers)
  - Task-09 diff, `frontend/app.js:844-849`, `backend/server.py:24,251-262`
- **Output format:** perf note + raw log: before/after (or post-fix absolute + method) for frame-time, WS Hz, join time; PASS thresholds stated (e.g. no multi-second join freeze at 50 Hz).
- **Verification:** measurements recorded with method + commit hash; jank symptom (join freeze / sustained dropped frames) absent post-fix.
