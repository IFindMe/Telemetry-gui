# Task 13 — [OPTIONAL] Research R3: time-source discipline

- **WHY (from Explorer R3):** mixing `micros()` serial time, sim elapsed, `time.time()` IMU stamps, and CSV times through one dedup (`frontend/app.js:344`) causes false duplicate-drops (IMU burst shares one `now`) and MET jumps across source switches.
- **Objective:** Spike monotonic ingress sequence numbers; dedup/ordering on seq, physics `dt` on source time, freeze/link-health on arrival wall-clock.
- **Depends-on:** 03 (seq-scheme decision sets direction).
- **Suggested owner:** Builder (spike; single specialist).
- **Scope fence (in):** prototype only — ingress (`backend/serial_reader.py`, `backend/android_imu.py`, `backend/simulator.py`, `backend/log_replay.py`), `sample_handler`, `frontend/app.js:344-355,745-752` (MET/freeze).
- **Out-of-scope:** production migration of all sources, S2 reset (Task 05) beyond seq contract.
- **Inputs to read:** Explorer § Step 4 R3 + Step 1 source paths; Task-03 record.
- **Output format:** spike note (seq assignment point, dedup rule, MET rule) + optional throwaway diff.
- **Verification:** IMU burst with shared timestamps no longer false-dedups; source switch shows no MET jump in the spike.
