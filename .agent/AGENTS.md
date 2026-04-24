# Repo Agent Entry

Customize this file to match the read order and rules for this repo.
This file is deployed on bootstrap and is not overwritten by sync.

## Config
- `.agent/project.toml` — phase, commands, paths (machine-readable source of truth)

## Memory (read in this order)
- `.agent/memory/personal/PREFERENCES.md` — stable user conventions
- `.agent/memory/semantic/LESSONS.md` — distilled patterns
- `.agent/memory/episodic/` — recent session captures (top few by recency)

## Protocols
- `.agent/protocols/repo-rules.md` — repo constraints and editing rules
- `.agent/protocols/rpi.md` — Research / Plan / Implement phase gates

## Agents
- `.agent/agents/` — available subagent role specs (load on demand by trigger)

## Rules
1. Read `project.toml` first — `phase` determines RPI mode and valid verify commands.
2. Check `LESSONS.md` before decisions you have been corrected on before.
3. Session receipts and runtime state go under `.agent/state/`, not repo root.
4. Never hand-edit `LESSONS.md` — use episodic capture first; review before graduating.
5. If `completed_stages` in RPI state is incomplete, do not skip to Implement.
6. Long output and temp logs go to `.agent/logs/` or `.agent/state/`, not main conversation.
