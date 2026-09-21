# Task 07 — Builder S4: frontend fragile globals/DOM

- **Objective:** Harden the frontend update path so one missing element, early call, or absent history key cannot abort a whole packet's render.
- **Depends-on:** 01 (hotfix lands first — same `history`/`app.js` area; avoids edit conflict).
- **Suggested owner:** Builder (single specialist, frontend only).
- **Scope fence (in):** `frontend/app.js:9-25` (state), `:47` (`val()` null-guard), `:76-77` vs `:318` (TDZ-adjacent `simulating`), `:360` (implicit `velocity` key — coordinate with 01), `frontend/index.html` IDs only to confirm.
- **Out-of-scope:** chart decimation/rAF (Task 09), gauge ticks/horizon math (Tasks 14/15), backend.
- **Inputs to read:**
  - `.opencode/AgentsReport/explorer/2026-09-21_system-map-and-practices.md` §§ Step 2 (state, fan-out, ordering hazard), Step 5 S4
  - `.opencode/AgentsReport/detective/2026-09-21_sim-mode-freeze.md` § Step 3 (val/ID/TDZ analysis)
  - `frontend/app.js`, Task-01 diff
- **Output format:** code diff — null-guard in `val()`, safe `simulating` init ordering (declare-before-use or guarded read), explicit history-key init (no implicit keys).
- **Verification:** Builder self-check — remove one element ID / call `refreshStatus` early / start from empty history; assert packet render degrades gracefully, no throw (full matrix in Task 08).
