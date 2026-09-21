# Task 16 — Docs: README refresh (stale contract + port)

- **Objective:** Fix the stale README so new operators get the right packet contract and port on first read.
- **Depends-on:** none (free anytime; re-verify numbers at end).
- **Suggested owner:** Writer (exactly one owner — chosen because README is user-facing documentation, not a code-convention fix; Maintainer explicitly out).
- **Scope fence (in):** `README.md` only — 10-field CSV (`:41-43`) → 14-field (`backend/telemetry.py:4-8`), port 8080 (`:80-82`) → 8181 (`run.py:5`), bind advice (`:108`) → `0.0.0.0` (`run.py:5`).
- **Out-of-scope:** any code change, R6/R7 additions, architecture docs, `AgentsReport/` edits.
- **Inputs to read:**
  - `README.md:41-43,80-82,108`
  - `backend/telemetry.py:4-8` (FIELDS), `run.py:5` (port/bind), `requirements.txt`
  - `AgentsReport/explorer/2026-09-21_system-map-and-practices.md` § Step 3 (stale-doc evidence)
- **Output format:** `README.md` diff (three corrections, no restructuring).
- **Verification:** grep README for `8080` → zero hits (outside history notes), field-count example matches 14, port/bind match `run.py:5`.
