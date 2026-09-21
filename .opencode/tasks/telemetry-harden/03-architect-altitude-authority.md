# Task 03 — Architect: altitude ownership + derived-state authority

- **Objective:** Decide baro-vs-GPS altitude ownership and derived-state authority BEFORE any Builder work on S1/S2/S3, per Explorer handoff.
- **Depends-on:** none (runs parallel with Tasks 01–02).
- **Suggested owner:** Architect (single decision-maker; no implementation).
- **Scope fence (in):** three decisions only — (1) altitude ownership: baro-primary vs GPS-only (commit `6fca13f` intent + `bmpPressure` already plumbed but unused); (2) derived-state authority: backend-computes-once vs replay-verbatim (+ explicit recompute toggle); (3) ingress sequencing: monotonic seq-number scheme (R3) to replace `d.time === lastMcuTime` dedup.
- **Out-of-scope:** writing Builder code, workflow/FSM modeling (Workflow Architect if needed), S4/S5 frontend, R-spikes, docs.
- **Inputs to read:**
  - `.opencode/AgentsReport/explorer/2026-09-21_system-map-and-practices.md` §§ Step 1 (IMU/replay/serial paths), Step 4 (R1–R3 WHY), Step 5 (S1/S2/S3), §8 handoff
  - `backend/telemetry.py:48-55,71-117`, `backend/android_imu.py:218-251`, `backend/log_replay.py:142-187`, `backend/server.py:31-49,136,194`, `frontend/app.js:344`
- **Output format:** decision record in `.opencode/AgentsReport/architect/` (per-team convention): per decision — options considered, decision, WHY, affected files, constraints handed to Tasks 04/05/06 (+ R-tasks).
- **Verification:** record exists; Tasks 04/05/06 each cite which 03-decision they implement; Orchestrator gates 04/05/06 dispatch on 03 = `done`.
