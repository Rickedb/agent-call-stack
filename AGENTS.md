# Agent parity

This repo ships the same tool for more than one coding agent:

| Agent | Where |
| --- | --- |
| Claude Code | the repo root (`.claude-plugin/`, `hooks/`, `types/`) |
| GitHub Copilot in VS Code | `vscode/` |

## The rule

**Everything developed for one agent must exist for the others.** A feature, fix or behavior change made for one target is not done until every other target has it too, or the gap is listed under "Known exceptions" below.

- **Same features first.** Targets start with the same features. The UI may differ to fit each agent's surface (a pane in Claude Code, a Panel view in VS Code), but what a person can see and do must match: the same views, the same data, the same actions.
- **Exceptions are told, never silent.** If a feature cannot or should not exist on a target (the agent gives no hook for it, an API is missing), say so in "Known exceptions" with the reason, and in that target's README. Do not leave it for someone to discover.
- **Same change, same time.** Make the change for every target in one piece of work, ideally one commit. If one target must wait, add it to "Known exceptions" as a gap to close, with what is missing.
- **New agent, same bar.** A new target starts with the full feature set of the existing ones, and its gaps are listed here.
- **Docs follow.** Each target's README says how to use it and what differs. Keep the feature lists in the READMEs in step.

## Checklist for a change

1. What does the change add or alter, in terms a person sees?
2. Does each target do it? If not, do it, or write the exception.
3. Tests: each target tests it in its own way (the root has `ai-call-tree.test.tsx`, `vscode/` has `npm test`).
4. READMEs and this file are up to date.

## Known exceptions

| Feature | Target without it | Why |
| --- | --- | --- |
| Reading the chat's earlier messages into the tree when the tool loads | GitHub Copilot (`vscode/`) | Copilot hooks give no access to the chat's history; only what happens after the hooks are installed is recorded. Logs of earlier recorded sessions do come back after a reload. |
| Exact pairing of a tool call with its result | GitHub Copilot (`vscode/`) | Some Copilot hosts give no tool-call id, so a result is paired by tool and arguments, oldest first. |
| The built-in `general-purpose` subagent drawn as a row | GitHub Copilot (`vscode/`) | Per GitHub's docs it fires no subagent start or stop hooks. |
| `/call-tree` opens the pane | GitHub Copilot (`vscode/`) | Replaced by the **Call Tree: Open Call Tree** command and `@calltree`, which prints the tree as text. Same purpose, different surface. |
| Install step for hooks (`Call Tree: Install Copilot Hooks`) | Claude Code | Not needed: a Claude Code plugin loads its hooks itself. |
