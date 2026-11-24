# Agent parity

This repo ships the same tool for more than one coding agent:

| Agent | Where |
| --- | --- |
| Claude Code | `claude/` (the marketplace manifest stays in the root `.claude-plugin/`) |
| GitHub Copilot in VS Code | `vscode/` |
| Claude Code in VS Code | `claude-vscode/` (its own extension: it is not the Copilot one, and does not need the Claude Code mod) |

## Presentation is per agent

How data is shown depends on the agent's surface, so each agent keeps its presentation in its own files, and nothing presentational is shared across the folders. Where a way of showing something differs, it lives in that agent's presentation folder and is listed below and under "Known exceptions".

| Agent | Presentation files | How a row's details show |
| --- | --- | --- |
| Claude Code | `claude/src/pane/` (`row`, `section`, `bar`, `details`, `block`, `report`, `resource`, `touched`, `toolbar`, `widget`, `theme`, ...) | inline, under the row |
| GitHub Copilot in VS Code | `vscode/src/view/` (`rows`, `modal`, `blocks`, `report`, `touched`, `toolbar`, `text`, `format`, `context`, ...), drawn by `vscode/media/` | in a modal over the view |
| Claude Code in VS Code | `claude-vscode/src/view/` (the same files, less `text`, plus `tags`), drawn by `claude-vscode/media/` | in a modal over the view |

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
3. Tests: each target tests it in its own way (`claude/` has `ai-call-stack.test.tsx`, `vscode/` has `npm test`).
4. READMEs and this file are up to date.

## Known exceptions

| Feature | Target without it | Why |
| --- | --- | --- |
| Reading the chat's earlier messages into the tree when the tool loads | GitHub Copilot (`vscode/`) | Copilot hooks give no access to the chat's history; only what happens after the hooks are installed is recorded. Logs of earlier recorded sessions do come back after a reload. |
| Exact pairing of a tool call with its result | GitHub Copilot (`vscode/`) | Some Copilot hosts give no tool-call id, so a result is paired by tool and arguments, oldest first. |
| The built-in `general-purpose` subagent drawn as a row | GitHub Copilot (`vscode/`) | Per GitHub's docs it fires no subagent start or stop hooks. |
| `/call-tree` opens the pane | GitHub Copilot (`vscode/`) | Replaced by the **Call Tree: Open Call Tree** command and `@calltree`, which prints the tree as text. Same purpose, different surface. |
| The model of each *subagent*, and a model that is certain | GitHub Copilot (`vscode/`) | No Copilot hook event carries a model. The prompt's model is read from VS Code's own chat log (`chatSessions/<session id>.jsonl`, an undocumented format) and matched to prompts by order from the newest end, so it can be missing or wrong; a subagent's is not in it, and says only which model called it. |
| Token counts the API reported (not estimated) for a prompt and its subagents, with the cache split | GitHub Copilot (`vscode/`) | Copilot's hooks carry no token usage, so every figure there is an estimate. The Claude Code mod estimates only what it cannot get: the calls' own text. |
| Permission verdicts on a tool call (allowed, asked, denied, which rule) and the time it waited for the person's answer, apart from the time the tool ran | GitHub Copilot (`vscode/`) | Copilot's `PreToolUse` hook carries no verdict (`permissionDecision` is what a hook returns, and ours returns none), and its `permissionRequest` event is Copilot CLI only. A call that waits for the person to approve it shows the wait as part of its time. |
| What a compaction did (size before and after, messages, what the summarizing request cost, its length, the summary it left) | GitHub Copilot (`vscode/`) | Its `PreCompact` hook fires before and says only what set it off (`manual` or `auto`) and the custom instructions; nothing fires after. The row is an instant, with those two. |
| Why a turn failed: the API's error kind (`rate_limit`, `overloaded`, ...), a refusal's category and explanation, a reply cut off at the output limit or the context window | GitHub Copilot (`vscode/`) | Copilot's hooks carry none of it. They give an `ErrorOccurred` event (message, name, stack, context, recoverable) and a `SessionEnd` reason (`abort`, `error`, `timeout`), which the port draws. VS Code's own docs do not list `ErrorOccurred`; whether VS Code fires it is not confirmed. |
| Permission verdicts for every call (allowed by which rule, denied by which rule) | Claude Code in VS Code (`claude-vscode/`) | Hooks tell of a call only when the person is asked (`PermissionRequest`) or a classifier refuses it (`PermissionDenied`, with its reason): the rest ran unasked, with no rule named. A call's wait for the answer is told from the tool's own time (`duration_ms`), as in the mod. |
| Why a turn failed: a refusal's category, a reply cut off at the output limit or the context window | Claude Code in VS Code (`claude-vscode/`) | `StopFailure` gives the API's error kind and details, which the extension draws, but no hook tells of a refusal or of a cut-off reply. |
| What a compaction cost: the summarizing request's tokens, the messages before and after | Claude Code in VS Code (`claude-vscode/`) | `PreCompact` and `PostCompact` give the trigger, the instructions and the summary, and the transcript the size before and after; the summarizer's usage and the message counts are not in them. |
| Model and token counts of a turn from the API itself, at once | Claude Code in VS Code (`claude-vscode/`) | The hooks carry neither. They are read from Claude Code's transcript (a format Claude Code does not document), which is written asynchronously, so a turn's figures show a moment after it ends, and may be missing if the format changes. A subagent's show once it has stopped (its transcript's path comes with its stop). |
| `/call-tree` opens the pane (and `@calltree` as text) | Claude Code in VS Code (`claude-vscode/`) | Claude Code's extension is not a chat participant host. The view's own icon, and **Claude Call Tree: Open Call Tree**, open it. |
| Details in a modal | Claude Code | The engine has no modal API: a pane is docked or inline, and a box placed over the rows is clipped to the pane. Details open inline under the row instead, with the same content and actions (input, output, sizes, who it ran with, show all, copy). |
| Install step for hooks (`Call Tree: Install Copilot Hooks`) | Claude Code | Not needed: a Claude Code plugin loads its hooks itself. |
| Hooks that need no install | Claude Code in VS Code (`claude-vscode/`) | Claude Code has no folder of hook files, so the extension merges its hooks into `~/.claude/settings.json` (or the workspace's `.claude/settings.local.json`) on a click, keeps a backup of the file the first time, and removes only its own entries. |
| Cut-off replies as rows, the engine's verdict on every call, the cost of a compaction | Claude Code in VS Code (`claude-vscode/`) | Those come from the mod's engine events (`turn.step`, `tool.check`, `session.compact`), which a hook cannot see. |
