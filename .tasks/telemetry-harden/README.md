# Goal: harden + improve rocket Telemetry-gui

**Goal statement:** Harden and improve the rocket Telemetry-gui mission-control project (FastAPI + vanilla-JS): land the in-flight SIM-mode freeze hotfix, resolve architect-level altitude/derived-state ownership, fix structural risks S1–S5, spike research recommendations R1–R5, and refresh stale docs — with explicit ordering so no Builder work on derived-state paths starts before Architect decides.

**How to read this breakdown:**
- Start at `00-overview.md` — the ordered plan (one line per task: what + depends-on + role hint) plus dependency chains and the next executable task.
- Each `NN-<slug>.md` is self-contained: an Orchestrator can dispatch it to one specialist reading only that file (+ its listed inputs). Do not re-feed the whole goal.
- `flag.json` is execution state (`pending|in-progress|done` per task). Only the Orchestrator flips `in-progress`/`done`; any structural change (split/merge/add/rescope) returns to Breakdowner.
- Sources of truth for this tree: Detective `2026-09-21_sim-mode-freeze.md` + Explorer `2026-09-21_system-map-and-practices.md`. No broad repo re-exploration was performed.
- Detailed plan rationale lives at `AgentsReport/breakdowner/2026-09-21_harden-tree.md`.
