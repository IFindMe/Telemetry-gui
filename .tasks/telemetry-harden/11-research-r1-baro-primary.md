# Task 11 — [OPTIONAL] Research R1: baro-primary altitude

- **WHY (from Explorer R1):** GPS altitude jitters ±m and drops under dynamics; velocity-from-GPS-delta (`backend/telemetry.py:86-89`) amplifies noise into false LIFTOFF/APOGEE flips. Reference pattern (TeleMega, fetched live): precision baro for altitude/events, GPS for position/tracking, accel for launch detect.
- **Objective:** Spike baro-primary altitude/velocity/phase with GPS as fallback/overlay; keep GPS lat/lon/groundSpeed display.
- **Depends-on:** 03 (altitude-ownership decision sets direction — spike implements or prototypes it).
- **Suggested owner:** Architect (spike + recommendation; single specialist).
- **Scope fence (in):** prototype or design only — `backend/telemetry.py:71-100`, `backend/simulator.py:168-219` (baro synthesis), pressure→altitude path. No production cutover required.
- **Out-of-scope:** production migration, event lockouts (Task 12), attitude (Task 15).
- **Inputs to read:** Explorer § Step 4 R1 + Step 1 backend paths; Task-03 record; `backend/telemetry.py`, `backend/simulator.py`.
- **Output format:** spike note in `AgentsReport/architect/` (approach, fallback rule, files to change, risk) + optional throwaway diff.
- **Verification:** spike shows baro-driven altitude/velocity stable vs GPS-delta noise on sim data, or documents why not.
