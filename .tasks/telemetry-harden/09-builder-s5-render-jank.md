# Task 09 — Builder S5: render / fan-out jank

- **Objective:** Remove guaranteed jank: full chart redraw every rAF + ~20 DOM writes per packet + 1200-item join burst.
- **Depends-on:** 07 (serialize same-file `app.js` edits after S4 fix).
- **Suggested owner:** Builder (single specialist, frontend + minimal backend burst cap if needed).
- **Scope fence (in):** `frontend/app.js:342-407` (per-packet DOM fan-out), `:755-849` (drawChart full-clear+glow, rAF `:844-849`, short-buffer stretch `x=j/(MAX-1)*w`), `backend/server.py:24,251-262` + `frontend/app.js:872` (history burst 1200 vs MAX 180, reconnect) — decouple or cap only as needed.
- **Out-of-scope:** WS batching/decimation design (Task 14 spike), S4 guards (Task 07 — already landed), gauge/horizon math.
- **Inputs to read:**
  - `AgentsReport/explorer/2026-09-21_system-map-and-practices.md` §§ Step 1 (WS+history), Step 2 (charts, health), Step 5 S5
  - `frontend/app.js`, `backend/server.py:24,251-262`
- **Output format:** code diff — redraw only on new data (or dirty-flag/throttle), reduced per-packet DOM churn, join-burst cap/decouple so connect at 50 Hz doesn't freeze.
- **Verification:** Builder self-check — 50 Hz sim + fresh connect shows no sustained freeze; quantitative proof deferred to Task 10.
