# Task 01 — Hotfix: velocity-history TypeError

- **Objective:** Stop `update()` aborting on every packet by fixing the missing `velocity` key in the frontend `history` store.
- **Depends-on:** none (already in flight by Builder; exempt from Architect gate per Detective scope boundary).
- **Suggested owner:** Builder (single specialist, single file).
- **Scope fence (in):** `frontend/app.js` only — `history` literal `:9-13`, `push()` helper `:337-340`, throw site `:360`.
- **Out-of-scope:** any backend change, any altitude/phase redesign, S1–S5 fixes, chart/perf rework. Do not touch `backend/`.
- **Inputs to read:**
  - `.opencode/AgentsReport/detective/2026-09-21_sim-mode-freeze.md` §§ Step 3, Handoff (fix sketch + blast-radius ALL sources)
  - `frontend/app.js:9-13`, `:337-340`, `:342-407`, `:786` (existing `drawChart` guard to mirror)
- **Expected output:** code diff — (a) add `velocity: []` to `history`, AND/OR (b) guard `push()` (`if (!history[k]) return` or init-on-demand) mirroring `:786`. Keep `MAX=180` semantics unchanged.
- **Verification (by Tester in Task 02, but Builder self-checks):** load page or harness, feed one synthetic full-field packet through `update()`, confirm no throw and a numeric DOM write occurs; `node` repro of old TypeError now passes.
