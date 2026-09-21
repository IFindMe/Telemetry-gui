# Task 12 — [OPTIONAL] Research R2: event lockouts + persistence

- **WHY (from Explorer R2):** 5-sample hysteresis (`backend/telemetry.py:101-117`) still chatters when velocity oscillates around 0/−2 near apogee; real stacks latch events (liftoff lockout, apogee delay, main-deploy altitude) and decide pyro/reset on latched state.
- **Objective:** Spike minimum-time-in-phase, apogee commit (no return to ASCENT), RECOVERY-requires-prior-DESCENT + low-alt, all transitions to event log.
- **Depends-on:** 03 (phase-authority decision sets direction).
- **Suggested owner:** Architect (spike + recommendation; single specialist).
- **Scope fence (in):** design/prototype only — `backend/telemetry.py:101-117`, event-log hook. No pyro hardware work.
- **Out-of-scope:** production cutover, baro fusion (Task 11), recording changes (Task 14).
- **Inputs to read:** Explorer § Step 4 R2; Task-03 record; `backend/telemetry.py`.
- **Output format:** spike note (lockout values, latch diagram or table, log format) + optional throwaway diff.
- **Verification:** oscillating-velocity fixture near apogee produces exactly one APOGEE latch + logged transition in the spike.
