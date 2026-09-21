# Task 15 — [OPTIONAL] Research R5: real attitude estimate

- **WHY (from Explorer R5):** horizon/3D treat instantaneous gyro rates as orientation (`frontend/app.js:668-669` ×1.5), so any spin reads as permanent tilt and drift is invisible — users distrust the prettiest panel first.
- **Objective:** Spike minimum-viable attitude: gyro integration + accel-leveling on slow timescale (complementary/quaternion), horizon + 3D driven from it, scripted turbulence as decoration only.
- **Depends-on:** 03 (informative only).
- **Suggested owner:** Builder (spike; single specialist).
- **Scope fence (in):** prototype only — `frontend/app.js:409-684` (rocket, horizon), no backend change unless 03 requires.
- **Out-of-scope:** production cutover, gauge ticks, apogee prediction (R6 — explicitly out of the R1–R5 set).
- **Inputs to read:** Explorer § Step 4 R5 + Step 2 (3D/horizon); `frontend/app.js:547-684`.
- **Output format:** spike note (filter choice, leveling timescale, quaternion→horizon/3D mapping) + optional throwaway diff/demo.
- **Verification:** sustained gyro rate no longer latches as permanent tilt in the spike; level flight returns to level horizon.
