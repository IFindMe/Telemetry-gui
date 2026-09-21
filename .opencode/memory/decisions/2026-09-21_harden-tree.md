# Breakdown Report — harden + improve Telemetry-gui (tree build)

## TL;DR
- Goal: harden + improve rocket Telemetry-gui → tree `.opencode/tasks/telemetry-harden/`, 16 tasks (01–16).
- Structure: hotfix chain (01→02) + Architect gate (03→{04,05,06}+{11–15}) + frontend serialize (01→07→08, 07→09→10) + free docs (16).
- Key calls: Architect 03 blocks all S1–S3 Builder work; S4+S5 are Builder+Tester pairs; R1–R5 optional spikes; docs owned solely by Writer.
- Open: Builder in-flight on 01; Architect 03 is the critical-path unblocker; R6/R7 explicitly deferred (not in R1–R5 set).
- Next: dispatch 01 + 03 + 16 in parallel; then 02; gate 04/05/06 on 03 done.

## Decision 1: tree shape from goal size [DONE]
- Evidence: goal spans 10+ files (`backend/server.py`, `telemetry.py`, `android_imu.py`, `simulator.py`, `log_replay.py`, `log_writer.py`, `serial_reader.py`, `frontend/app.js`, `index.html`, `README.md`), 5 structural risks S1–S5 + hotfix + 5 research spikes + docs; brief mandates full tree, goal is not trivial.
- Actions: chose 16-task tree over minimal (hotfix-only) and maximal (every risk as Builder+Tester pair) alternatives — S1–S3 single Builder tasks gated by Architect (they share one decision), S4/S5 as pairs (frontend correctness vs perf need separate verification), R-tasks as optional spikes.
- Result: `.opencode/tasks/telemetry-harden/` with README, 00-overview, 16 task files, flag.json.

## Decision 2: hotfix track first, exempt from gate [DONE]
- Evidence: Detective ROOT_CAUSE_ESTABLISHED — `frontend/app.js:360` vs `:9-13`, fix sketch add-`velocity: []`/guard `push()`; scope boundary "no architectural change, single-frontend-file".
- Actions: 01 (Builder hotfix) with no depends-on + 02 (Tester 4-source synthetic-packet regression: numeric DOM write + no throw).
- Result: chain A `01→02`; 02's source matrix (serial/sim/imu/replay) answers Detective's "sim-only reflects observation conditions" uncertainty.

## Decision 3: Architect gate before S1–S3 [DONE]
- Evidence: Explorer §8 handoff — "Architect decides baro-vs-GPS ownership, derived-state authority, seq scheme before any Builder fix (esp. S1–S3)".
- Actions: 03 (Architect, 3 decisions) with no depends-on so it parallels hotfix; 04/05/06 (Builder S1/S2/S3) each `depends-on: 03` with explicit out-of-scope fences between them.
- Result: chain B `03→{04,05,06}`; Orchestrator must not dispatch 04/05/06 until 03 done.

## Decision 4: S4+S5 as serialized Builder+Tester pairs [DONE]
- Evidence: Explorer S4 (fragile globals/DOM `app.js:76/318, :360, :47`) vs S5 (rAF redraw `:844-849`, ~20 DOM/packet, 1200-burst) — different failure modes, same file.
- Actions: 07→08 (S4 harden + robustness matrix) and 07→09→10 (S5 jank fix + timed run); 09 depends on 07 to serialize same-file edits; 07 depends on 01 to avoid history-area conflict.
- Result: chain C `01→07→08`, `07→09→10`.

## Decision 5: R1–R5 as separate optional spikes [DONE]
- Evidence: Explorer Step 4 R1–R5 each with distinct WHY (GPS noise, hysteresis chatter, time mixing, WS/CPU burn, rate-as-angle).
- Actions: 11–15, one per R with WHY quoted, all `depends-on: 03`, all `[OPTIONAL]`; owners split Architect (11 R1, 12 R2 — decision-flavored) / Builder (13 R3, 14 R4, 15 R5 — implementation-flavored). R6/R7 excluded per brief's R1–R5 set.
- Result: optional fan-out `03→{11,12,13,14,15}`.

## Decision 6: docs single-owner Writer [DONE]
- Evidence: Explorer Step 3 — README stale (10-field `:41-43` vs 14-field `telemetry.py:4-8`; 8080 `:80-82` vs 8181 `run.py:5`; bind `:108` vs `0.0.0.0`).
- Actions: 16 assigned solely to Writer (user-facing doc rationale; Maintainer explicitly out), `depends-on: none`, README-only fence.
- Result: chain D free task 16.

## Decision 7: validation invariant [DONE]
- Checks run (via python json + ls/grep): (1) README/00-overview/flag.json exist ✓; (2) flag.json parses, keys exactly goal/status/tasks ✓; (3) goal==telemetry-harden, statuses in enum ✓; (4) task keys {01..16} == files NN-*.md {01..16} ✓; (5) overview lists all 01..16 with files on disk ✓; (6) zero-padded ascending, no gaps, ≥1 task ✓.
- Result: invariant PASSES; tree handoff-ready, all flags `pending`, goal `pending`.

## Tree listing
```
.opencode/tasks/telemetry-harden/
├── README.md
├── 00-overview.md
├── 01-hotfix-velocity-history.md
├── 02-regression-4-sources.md
├── 03-architect-altitude-authority.md
├── 04-builder-s1-imu-discard.md
├── 05-builder-s2-global-state.md
├── 06-builder-s3-replay-fidelity.md
├── 07-builder-s4-frontend-fragility.md
├── 08-tester-s4-verification.md
├── 09-builder-s5-render-jank.md
├── 10-tester-s5-perf-check.md
├── 11-research-r1-baro-primary.md
├── 12-research-r2-event-lockouts.md
├── 13-research-r3-time-discipline.md
├── 14-research-r4-ws-batch-decimate.md
├── 15-research-r5-attitude-filter.md
├── 16-docs-readme-refresh.md
└── flag.json
```
