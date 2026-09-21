# Overview — telemetry-harden plan

Goal: harden + improve rocket Telemetry-gui. Sources: `.opencode/AgentsReport/detective/2026-09-21_sim-mode-freeze.md`, `.opencode/AgentsReport/explorer/2026-09-21_system-map-and-practices.md`.

## Ordered task list (description + depends-on + role hint)

- [ ] `01-hotfix-velocity-history.md` — land velocity-history hotfix in `frontend/app.js` (store + guard) — depends-on: none (already in flight) — owner: Builder
- [ ] `02-regression-4-sources.md` — regression: one synthetic packet through `update()` across serial/sim/imu/replay, assert numeric DOM write + no throw — depends-on: 01 — owner: Tester
- [ ] `03-architect-altitude-authority.md` — decide altitude ownership (baro-primary vs GPS) + derived-state authority (compute-once vs replay-verbatim) + seq scheme — depends-on: none (parallel with 01–02) — owner: Architect
- [ ] `04-builder-s1-imu-discard.md` — fix S1 silent IMU discard (Phyphox velocity/alt reaches browser) — depends-on: 03 — owner: Builder
- [ ] `05-builder-s2-global-state.md` — fix S2 leaky global flight state + partial reset — depends-on: 03 — owner: Builder
- [ ] `06-builder-s3-replay-fidelity.md` — fix S3 replay infidelity + dead branch — depends-on: 03 — owner: Builder
- [ ] `07-builder-s4-frontend-fragility.md` — fix S4 fragile globals/DOM (TDZ-adjacent `simulating`, implicit `velocity` key, unguarded `val()`) — depends-on: 01 — owner: Builder
- [ ] `08-tester-s4-verification.md` — verify S4: missing-ID / early-call / empty-history robustness — depends-on: 07 — owner: Tester
- [ ] `09-builder-s5-render-jank.md` — fix S5 render/fan-out mismatch (rAF redraw, per-packet DOM, 1200-burst) — depends-on: 07 — owner: Builder
- [ ] `10-tester-s5-perf-check.md` — verify S5: timed run (frame time, WS Hz, join-burst) — depends-on: 09 — owner: Tester
- [ ] `11-research-r1-baro-primary.md` — [OPTIONAL] spike R1 baro-primary altitude, GPS secondary — depends-on: 03 — owner: Architect
- [ ] `12-research-r2-event-lockouts.md` — [OPTIONAL] spike R2 phase lockouts + persistence + event log — depends-on: 03 — owner: Architect
- [ ] `13-research-r3-time-discipline.md` — [OPTIONAL] spike R3 seq-number ingress, MCU-time physics, wall-clock link health — depends-on: 03 — owner: Builder
- [ ] `14-research-r4-ws-batch-decimate.md` — [OPTIONAL] spike R4 WS batching + chart decimation + aligned caps — depends-on: 03 — owner: Builder
- [ ] `15-research-r5-attitude-filter.md` — [OPTIONAL] spike R5 real attitude estimate (complementary/quaternion) — depends-on: 03 — owner: Builder
- [ ] `16-docs-readme-refresh.md` — refresh README (10-field→14-field, 8080→8181, bind advice) — depends-on: none — owner: Writer

## Dependency chains

```
Chain A (hotfix, in flight):  01 → 02
Chain B (architecture gate):  03 → {04, 05, 06}   (04/05/06 parallel after 03)
                              03 → {11, 12, 13, 14, 15}  (optional, parallel after 03)
Chain C (frontend serialize): 01 → 07 → 08
                                    07 → 09 → 10   (09 serializes after 07: same-file app.js)
Chain D (docs, free):         16 (anytime; verify at end)
```

Architect gate (from Explorer handoff §8): no Builder work on 04/05/06 (S1/S2/S3) starts before 03 is `done`. Hotfix chain A is exempt (Detective scope boundary: single-frontend-file, no architectural change).

## Next executable tasks

- `01` (Builder, in flight — finish hotfix) and `03` (Architect — unblock chains B) can run in parallel now. `16` (Writer) is free anytime.
- Orchestrator: flip `01`/`03` to `in-progress` at dispatch; flip to `done` only with verified-completion evidence.

## Numbering stability

Numbers are stable and zero-padded ascending (01–16, no gaps). On re-plan: append next free number, never renumber, never silently reuse. A removed task leaves its line marked `[REMOVED]` here with reason.
