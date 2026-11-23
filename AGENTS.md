# Agent parity

This repo ships the same tool for more than one coding agent:

| Agent | Where |
| --- | --- |
| Claude Code | `claude/` (the marketplace manifest stays in the root `.claude-plugin/`) |
| GitHub Copilot in VS Code | `vscode/` |

## Presentation is per agent

How data is shown depends on the agent's surface, so each agent keeps its presentation in its own files, and nothing presentational is shared across the folders. Where a way of showing something differs, it lives in that agent's presentation folder and is listed below and under "Known exceptions".

| Agent | Presentation files | How a row's details show |
| --- | --- | --- |
| Claude Code | `claude/src/pane/` (`row`, `section`, `bar`, `details`, `block`, `report`, `toolbar`, `widget`, `theme`, ...) | inline, under the row |
| GitHub Copilot in VS Code | `vscode/src/view/` (`rows`, `modal`, `blocks`, `report`, `toolbar`, `text`, `format`, `context`, ...), drawn by `vscode/media/` | in a modal over the view |

What is recorded, folded, counted (tokens) and summed up (a finished prompt's summary, `stats.ts`) is the same in both, and each agent keeps its own copy of that logic in its own language. A new way to show data goes in the presentation folder of the agent it is for, with a row in this table.

## The rule

**Everything developed for one agent must exist for the others.** A feature, fix or behavior change made for one target is not done until every other target has it too, or the gap is listed under "Known exceptions" below.

- **Same features first.** Targets start with the same features. The UI may differ to fit each agent's surface (a pane in Claude Code, a side bar view in VS Code), but what a person can see and do must match: the same views, the same data, the same actions.
- **Exceptions are told, never silent.** If a feature cannot or should not exist on a target (the agent gives no hook for it, an API is missing), say so in "Known exceptions" with the reason, and in that target's README. Do not leave it for someone to discover.
- **Same change, same time.** Make the change for every target in one piece of work, ideally one commit. If one target must wait, add it to "Known exceptions" as a gap to close, with what is missing.
- **New agent, same bar.** A new target starts with the full feature set of the existing ones, and its gaps are listed here.
- **Docs follow.** Each target's README (`claude/README.md`, `vscode/README.md`) and the root README say how to use it and what differs. Keep the feature lists in step.

## Checklist for a change

1. What does the change add or alter, in terms a person sees?
2. Does each target do it? If not, do it, or write the exception.
3. Tests: each target tests it in its own way (`claude/` has `ai-call-tree.test.tsx`, `vscode/` has `npm test`).
4. READMEs and this file are up to date.

## Known exceptions

| Feature | Target without it | Why |
| --- | --- | --- |
| Reading the chat's earlier messages into the tree when the tool loads | GitHub Copilot (`vscode/`) | Copilot hooks give no access to the chat's history; only what happens after the hooks are installed is recorded. Logs of earlier recorded sessions do come back after a reload. |
| Exact pairing of a tool call with its result | GitHub Copilot (`vscode/`) | Some Copilot hosts give no tool-call id, so a result is paired by tool and arguments, oldest first. |
| The built-in `general-purpose` subagent drawn as a row | GitHub Copilot (`vscode/`) | Per GitHub's docs it fires no subagent start or stop hooks. |
| `/call-tree` opens the pane | GitHub Copilot (`vscode/`) | Replaced by the **Call Tree: Open Call Tree** command and `@calltree`, which prints the tree as text. Same purpose, different surface. |
| The model each prompt and subagent ran on | GitHub Copilot (`vscode/`) | No Copilot hook event carries the model (not the prompt's, not a subagent's), per GitHub's hooks reference and VS Code's docs. Gap to close if a hook ever gives it, or if the host's transcript (`transcript_path`) turns out to name it. |
| Token counts the API reported (not estimated) for a prompt and its subagents, with the cache split | GitHub Copilot (`vscode/`) | Copilot's hooks carry no token usage, so every figure there is an estimate. The Claude Code mod estimates only what it cannot get: the calls' own text. |
| Details in a modal | Claude Code | The engine has no modal API: a pane is docked or inline, and a box placed over the rows is clipped to the pane. Details open inline under the row instead, with the same content and actions (input, output, sizes, who it ran with, show all, copy). |
| Install step for hooks (`Call Tree: Install Copilot Hooks`) | Claude Code | Not needed: a Claude Code plugin loads its hooks itself. |
