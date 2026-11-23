# ai-call-tree for Claude Code

The Claude Code target of [ai-call-tree](../README.md). A Claude Code mod that adds a live "Call tree" pane beside the chat. It shows what Claude is doing as a tree, like a stack trace: each prompt, the subagents it started, and the tool calls inside them, with status and duration. Running calls are listed at the top as the current stack, innermost first.

```
Stack (innermost first)
  at 🔧 Bash(npm test)  2.1s
  at 🤖 Explore: find auth code  8.4s

💬 ✓ Prompt 1                               12.3s
├─ 🤖 ● Explore: find auth code             8.4s
│  ├─ 🔧 ✓ Grep(auth)                       0.2s
│  └─ 🔧 ● Bash(npm test)                   2.1s
└─ 🔧 ✓ Edit(src/login.ts)                  0.1s
```

## Reading the tree

- **Nesting.** A subagent is a row, and the calls it makes are its children. Guide lines (`├─ └─`) draw the branches. Neither Copilot's hooks nor the engine say which tool call started another, so a tool that calls other tools shows as siblings, not as parent and child; only subagents nest.
- **At the same time.** Calls under one parent whose spans overlap are one parallel group (a call still running lasts until now; calls that touch end to start are in sequence). Each is marked `∥ ×N` and drawn with its own double connector (`╞═ ╘═ ║`) in a different color, and a row's details name who it ran with. In the waterfall, the overlapping bars show it too.

## Tokens

Each row shows the size of its output in tokens (`~340 tok`), and a row's details show both the input and the output. These are estimates, at four characters a token, from the whole text. The engine gives no count per call, so every row is estimated alike. The [Copilot port](../vscode/README.md) does the same.

## Use

The pane opens at session start. Run `/call-tree` to open it again.

Rows draw in columns (output tokens, time) with a single colored status glyph. In the waterfall each call is one line, with its bar in a column at the right end, drawn with boxes (no text to wrap, whatever the surface's font); the bar column is a quarter of the width (8 to 32 cells) and is always there. A pane narrower than 72 columns gives up the `+start` text and the "slowest" label first (the bar already shows where a call started), and the name truncates last. The newest prompt is on top. When a prompt starts, the ones before it fold away (open any again with its arrow, or use *fold all* / *unfold all*).

Details open inline, under the row you click. (The engine has no modal API; the VS Code port opens them in a modal. See `AGENTS.md`.)

## Layout

```
hooks/hooks.json      names the one hooks module
hooks/register.tsx    wires the three parts below
src/lifecycle.tsx     opening the pane, /call-tree, the button that reopens it
src/recording.ts      turns, subagents and tool calls into rows
src/pane/             drawing the rows: index (reads state, picks the view),
                      toolbar, section, row, bar, details, block, widget, theme,
                      cells (the right-hand columns), parallel (calls at the same time)
src/state.ts          every atom, and every read and write of the state
src/history.ts        reads the chat's earlier messages into rows
src/nodes.ts          row bookkeeping: upsert, patch, keep (cut text to a file), guard
src/format.ts         text helpers: clip, describe, durations, token estimates
src/config.ts         limits and names
types/index.d.ts      the row type and the state the mod declares
```

The engine reads a hooks module by scanning its source, which sets two rules for splitting it:

- `$` may be passed to another file only into a `function` declaration, never an arrow function in a `const`, and never stored in an object. So helpers that take `$` are declared with `function`, and the pane parts take `$` as their first argument next to the context they draw from.
- The state scan wants each atom beside the `update` that writes it, so `src/state.ts` holds all the atoms and the rest of the mod calls its functions (`setMode($, ...)`, `toggleFolded($, id)`) instead of `read` and `update`.

`claude plugin validate .` reports a break of either rule, naming the file and line.

## Develop

Validate and type-check:

```bash
claude plugin validate .   # checks the manifest and reads the hooks module as the engine will
claude plugin test .       # runs ai-call-tree.test.tsx
```

Run it from this folder (`claude/`). Load it in a session with `claude --plugin-dir <this folder>`.

Install from the marketplace at the repo root:

```
/plugin install ai-call-tree --marketplace Rickedb/ai-call-tree
```
