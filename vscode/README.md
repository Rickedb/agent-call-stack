# AI Call Tree for GitHub Copilot (VS Code)

The VS Code port of the [Claude Code mod](../claude/README.md): a live "Call tree" pane that shows what Copilot's agent is doing as a tree, like a stack trace. Each prompt, the subagents it started, and the tool calls inside them, with status and duration, in a tree or a waterfall.

```
Stack (innermost first)
  at 🔧 run_in_terminal(npm test)  2.1s
  at 🤖 Explore(find auth code)    8.4s

💬 ● Prompt 1                               12.3s
├─ 🤖 ● Explore  find auth code             8.4s
│  ├─ 🔧 ✓ grep_search  login               0.2s
│  └─ 🔧 ● run_in_terminal  npm test        2.1s
└─ 🔧 ✓ replace_string_in_file  src/login.ts  0.1s
```

## How it works

Copilot has no in-process plugin API like Claude Code's mods, so the port has two parts:

1. **A hook script** (`src/record.ts`, installed as `~/.copilot/ai-call-tree/record.cjs`). Copilot [agent hooks](https://code.visualstudio.com/docs/copilot/customization/hooks) run it on each event (`UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `SubagentStart`, ...). It appends one normalized line to `~/.copilot/ai-call-tree/events/<session>.jsonl`. It never blocks or denies anything, prints `{}`, and swallows its own errors. Texts over 8,000 characters are cut in the log and kept whole in `blobs/`.
2. **A VS Code extension** (`src/extension.ts`) that tails those logs and draws the pane in the side bar (the Activity Bar's **Call Tree** icon), with the same Tree / Waterfall views, folding, details, "Show all" and copy buttons.

What maps to what:

| Claude Code mod | Copilot port |
| --- | --- |
| `turn.start` / `turn.complete` | `UserPromptSubmit` / `Stop` |
| `tool.call` | `PreToolUse` / `PostToolUse` / `PostToolUseFailure` |
| `agent.spawn` | `SubagentStart` / `SubagentStop` (plus the spawn tool's description) |
| `ui.open` pane, `/call-tree` | Side bar view, `Call Tree: Open Call Tree`, and `@calltree` in chat (text tree) |
| State atoms | Extension host state (view mode is remembered) |

## Details

Click a row to open its details in a modal over the view: its state, timing, token sizes, who it ran with, and its input and output (*Show all*, *Copy*). The ✕, the Close button, a click outside it, or Esc closes it. Nothing expands inline, so rows never shift. (The Claude Code mod opens details inline: its engine has no modal.)

## Reading the tree

- **Nesting.** A subagent is a row, and the calls it makes are its children. Guide lines (`├─ └─`) draw the branches. Neither Copilot's hooks nor the engine say which tool call started another, so a tool that calls other tools shows as siblings, not as parent and child; only subagents nest.
- **At the same time.** Calls under one parent whose spans overlap are one parallel group (a call still running lasts until now; calls that touch end to start are in sequence). Each is marked `parallel ×N` and drawn with its own orange guide line, and a row's details name who it ran with. In the waterfall, the overlapping bars show it too.

## Tokens

Each row shows the size of its output in tokens (`~340 tok`, hover for what it means), and a row's details show both the input and the output. These are estimates, at four characters a token, from the whole text: Copilot's hooks give no token counts. The Claude Code mod shows the same figures, estimated the same way.

## Use

1. Build and install the extension (see Develop).
2. Open the **Call Tree** view (its icon in the Activity Bar, on the side, not in the bottom panel with Terminal). Until the hooks are installed it says so, with buttons: **Install for all workspaces** (`~/.copilot/hooks/ai-call-tree.json`) or **This workspace only** (`.github/hooks/ai-call-tree.json`). Pick one: both would record every call twice. The workspace file holds an absolute path to your machine, so do not commit it. A notification offers the same on first start, and the view's `…` menu and **Call Tree: Install Copilot Hooks** do too.
3. Start a new Copilot agent chat. The calls show up in the view (or open it with **Call Tree: Open Call Tree**).

The view sits in the Activity Bar by default. To put it beside Copilot Chat, drag its icon to the Secondary Side Bar: VS Code remembers where you put it.

The newest prompt is on top. When a prompt starts, the ones before it fold away (open any again with its arrow, or use *fold all* / *unfold all*).

Requirements: VS Code 1.95+, `node` on your `PATH` (hooks are run as `node record.cjs <Event>`), and agent hooks enabled in VS Code. Agent hooks are a preview feature; if nothing shows up, check the `chat.useHooks` setting and that hooks are not disabled by your organization.

Other commands: **Remove Copilot Hooks**, **Clear Recorded Calls**. Setting `aiCallTree.defaultView` picks Tree or Waterfall at first.

## Differences from the Claude Code mod

- **No history backfill.** The mod read the chat's earlier messages when it loaded. Here only what happens after the hooks are installed is recorded (the log does survive reloads, so earlier recorded sessions come back).
- **Call pairing is best effort.** Some Copilot hosts give tool calls no id. Then a result is paired with its call by tool and arguments, oldest first, which can swap two identical parallel calls.
- **Subagents.** Copilot's start event may carry no subagent id. Calls inside a subagent are bound to the oldest subagent still waiting for one. The built-in `general-purpose` agent may fire no start/stop events at all (per GitHub's docs), and then it is not drawn.
- A call denied by policy never gets a result; it is drawn as failed when its prompt ends.
- Several concurrent chats each have a session; use the drop-down to switch (default: the newest one in this workspace).

## Layout

The panel's drawing is one file a concern in `src/view/`, with `src/render.ts` as its one door:

```
src/view/index.ts     renderBody: toolbar, counts, a section per prompt (newest first), the modal
src/view/rows.ts      a prompt's rows: guide lines, parallel marks, bars
src/view/modal.ts     a row's details in the modal
src/view/blocks.ts    one input or output text, with Show all and Copy
src/view/toolbar.ts   the buttons, the counts, the empty state
src/view/text.ts      the tree as plain text, for @calltree
src/view/context.ts   what one draw works out once (children, parallel groups, times)
src/view/format.ts    escaping, durations, token estimates, status marks
src/view/types.ts     the view state the extension keeps, the draw context
media/                the webview's script (Esc, focus, redraws) and stylesheet
```

## Develop

```bash
cd vscode
npm install
npm test            # compiles, then runs the unit tests (hook script, model, renderer, log tail, installer)
npm run build
npx @vscode/vsce package   # makes a .vsix to install with "Install from VSIX..."
```

To run it from source, open the `vscode/` folder in VS Code and press F5 (Extension Development Host), then install the hooks in that window.

`src/record.ts` accepts both payload styles GitHub documents: snake_case (`PreToolUse`, `tool_name`, `tool_input`) and camelCase (`preToolUse`, `toolName`, `toolArgs`), so it also works if you copy the generated hook entries to a Copilot CLI setup.
