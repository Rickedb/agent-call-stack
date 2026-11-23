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
2. **A VS Code extension** (`src/extension.ts`) that tails those logs and draws the pane in the Panel (next to Terminal), with the same Tree / Waterfall views, folding, details, "Show all" and copy buttons.

What maps to what:

| Claude Code mod | Copilot port |
| --- | --- |
| `turn.start` / `turn.complete` | `UserPromptSubmit` / `Stop` |
| `tool.call` | `PreToolUse` / `PostToolUse` / `PostToolUseFailure` |
| `agent.spawn` | `SubagentStart` / `SubagentStop` (plus the spawn tool's description) |
| `ui.open` pane, `/call-tree` | Panel view, `Call Tree: Open Call Tree`, and `@calltree` in chat (text tree) |
| State atoms | Extension host state (view mode is remembered) |

## Tokens

Each row shows the size of its output in tokens (`~340 tok`, hover for what it means), and a row's details show both the input and the output. These are estimates, at four characters a token, from the whole text: Copilot's hooks give no token counts. The Claude Code mod shows the same figures, estimated the same way.

## Use

1. Build and install the extension (see Develop).
2. Run **Call Tree: Install Copilot Hooks** and choose *All workspaces* (`~/.copilot/hooks/ai-call-tree.json`) or *This workspace* (`.github/hooks/ai-call-tree.json`). Pick one: both would record every call twice. The workspace file holds an absolute path to your machine, so do not commit it.
3. Start a new Copilot agent chat. The pane opens from the Panel (**Call Tree** tab) or with **Call Tree: Open Call Tree**.

Requirements: VS Code 1.95+, `node` on your `PATH` (hooks are run as `node record.cjs <Event>`), and agent hooks enabled in VS Code. Agent hooks are a preview feature; if nothing shows up, check the `chat.useHooks` setting and that hooks are not disabled by your organization.

Other commands: **Remove Copilot Hooks**, **Clear Recorded Calls**. Setting `aiCallTree.defaultView` picks Tree or Waterfall at first.

## Differences from the Claude Code mod

- **No history backfill.** The mod read the chat's earlier messages when it loaded. Here only what happens after the hooks are installed is recorded (the log does survive reloads, so earlier recorded sessions come back).
- **Call pairing is best effort.** Some Copilot hosts give tool calls no id. Then a result is paired with its call by tool and arguments, oldest first, which can swap two identical parallel calls.
- **Subagents.** Copilot's start event may carry no subagent id. Calls inside a subagent are bound to the oldest subagent still waiting for one. The built-in `general-purpose` agent may fire no start/stop events at all (per GitHub's docs), and then it is not drawn.
- A call denied by policy never gets a result; it is drawn as failed when its prompt ends.
- Several concurrent chats each have a session; use the drop-down to switch (default: the newest one in this workspace).

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
