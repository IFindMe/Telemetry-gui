# Task 04 — Builder S1: silent IMU discard

- **Objective:** Make Phyphox Android IMU altitude/velocity actually reach the browser (today silently discarded).
- **Depends-on:** 03 (Architect altitude/derived-state decisions — MUST be done first).
- **Suggested owner:** Builder (single specialist, backend only).
- **Scope fence (in):** `backend/android_imu.py:204-251` (dead `_altitude_locked` at `:218`, `_vel_z`/`_alt_imu` integration at `:221-234`, overwrite at `:240`) + `backend/telemetry.py:71-99` (overwrite path `:86-89`) as constrained by Task-03 decisions.
- **Out-of-scope:** global-state reset (Task 05), replay (Task 06), frontend, attitude filter (Task 15), fire-and-forget ordering/backpressure redesign beyond what 03 mandates.
- **Inputs to read:**
  - `AgentsReport/explorer/2026-09-21_system-map-and-practices.md` §§ Step 1 (IMU path), Step 5 S1
  - Task-03 decision record (altitude ownership + derived authority)
  - `backend/android_imu.py`, `backend/telemetry.py`
- **Output format:** code diff + 5-line behavior note (which 03-decision implemented, what the browser now receives for an IMU sample).
- **Verification:** feed one synthetic IMU triple through the IMU→`sample_handler` path; assert emitted dict carries non-overwritten IMU-derived velocity/alt per 03-decision (Tester or Builder-run check; full Tester pass deferred to integration).
