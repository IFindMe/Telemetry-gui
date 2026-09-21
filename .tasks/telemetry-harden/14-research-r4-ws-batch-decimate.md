# Task 14 — [OPTIONAL] Research R4: WS batch + chart decimation

- **WHY (from Explorer R4):** 50 Hz × per-packet JSON + full 1200 history burst (backend) vs 180 frontend buffer + full redraw every rAF burns CPU and makes the stream unreadable on replay connect.
- **Objective:** Spike ~10–20 Hz wire batching (full-rate disk recording kept), chart min/max-per-pixel decimation, single configured history-cap constant (`MAX`/deque/burst aligned).
- **Depends-on:** 03 (informative; may run after Task 09 to avoid conflicting with S5 fix — follow Orchestrator ordering).
- **Suggested owner:** Builder (spike; single specialist).
- **Scope fence (in):** prototype only — `backend/server.py:24,251-262`, `frontend/app.js:755-849,872`, `backend/log_writer.py:68` (buffered/interval flush note, file rotation/size caps per R7).
- **Out-of-scope:** production cutover, S5 fix itself (Task 09).
- **Inputs to read:** Explorer § Step 4 R4 (+R7 recording note); Tasks 03/09 records.
- **Output format:** spike note (batch Hz, decimation rule, cap constant, writer buffering) + optional throwaway diff.
- **Verification:** spike demo at 50 Hz sim shows lower CPU/message-rate with charts still faithful (Tester-style numbers, no formal gate).
