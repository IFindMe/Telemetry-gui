# Task 05 — Builder S2: leaky global flight state

- **Objective:** End cross-session leakage of phase/velocity/altitude from class-level mutable derived state with partial reset.
- **Depends-on:** 03 (Architect derived-authority + seq decisions — MUST be done first).
- **Suggested owner:** Builder (single specialist, backend only).
- **Scope fence (in):** `backend/telemetry.py:48-55` (class state `_prev_alt/_prev_time/_current_phase/_max_altitude`) + reset call sites `backend/server.py:31,136,194` (+ missing android-start `:146-166` and disconnect paths).
- **Out-of-scope:** IMU math (Task 04), replay verbatim mode (Task 06), frontend dedup (Task 13 unless 03 folds it here — follow 03).
- **Inputs to read:**
  - `AgentsReport/explorer/2026-09-21_system-map-and-practices.md` §§ Step 1 (status/API reset gaps), Step 5 S2
  - Task-03 decision record (who owns derived state, reset/seq contract)
  - `backend/telemetry.py`, `backend/server.py:63-84,89-247`
- **Output format:** code diff + reset matrix (source × start/disconnect → reset Y/N) showing android-start and disconnect gaps closed per 03-contract.
- **Verification:** start sim → switch to android → switch back (or call the reset paths); assert phase/velocity/`_max_altitude` do not leak across sessions (fresh-session values after each start).
