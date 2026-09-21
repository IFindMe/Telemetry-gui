# Task 06 — Builder S3: replay fidelity + dead branch

- **Objective:** Make replay reproduce the recorded flight (verbatim derived columns) instead of silently recomputing divergent phases/velocities; remove or repair the dead branch.
- **Depends-on:** 03 (Architect replay-verbatim vs recompute decision — MUST be done first).
- **Suggested owner:** Builder (single specialist, backend only).
- **Scope fence (in):** `backend/log_replay.py:133-187` (`_row_to_sample`, dead `if "altitude" not in row` at `:161-162`) + `backend/server.py:38-44` (`sample_handler` recompute) + `backend/log_writer.py:16-19,32-68` (ALL_FIELDS contract).
- **Out-of-scope:** writer buffering/rotation (Task 14 unless 03 folds it here), global-state reset (Task 05), frontend replay controls.
- **Inputs to read:**
  - `.opencode/AgentsReport/explorer/2026-09-21_system-map-and-practices.md` §§ Step 1 (replay + writer paths), Step 4 R7 WHY, Step 5 S3
  - Task-03 decision record (verbatim vs recompute + toggle contract)
  - `backend/log_replay.py`, `backend/server.py`, `backend/log_writer.py`
- **Output format:** code diff + fidelity note (verbatim default? recompute toggle name/endpoint; dead branch removed or made live).
- **Verification:** record a short session (or use `logs/` CSV), replay it, diff replayed velocity/phase stream vs recorded columns — assert identical under default mode per 03-decision.
