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
- **Parallel calls are not marked.** Neither the engine nor Copilot's hooks say which calls were started together, and overlap in time alone cannot tell parallel from coincidence, so the tree does not guess. In the waterfall, overlapping bars still show what ran at the same moment.

## Tokens

Two kinds of figure, told apart in the pane:

- **Reported** (`4.8k tok`, no `~`): what the API counted for a prompt's turn and for each subagent's own turns, from `turn.complete`. A row's details say it (`reported in 4.8k tok (4.0k tok cached) · out 520 tok`); a prompt's excludes its subagents, which have their own rows. The summary adds them up (input counts what the cache served and wrote too) and says how much came from the cache.
- **Estimated** (`~340 tok`): what the API does not count per call, so a tool call's input and output, and the text of a prompt or subagent, at four characters a token from the whole text. Each row's output size and a row's details use these, and so does the summary's "Call text" line. A prompt with no reported usage (an interrupt, an API error) falls back to estimating all of it.

The [Copilot port](../vscode/README.md) estimates everything: its hooks carry no usage.

## Models

A prompt and each subagent show the model they ran on, in color after their name (`Prompt 1 opus-5-5`; the date a model id carries is dropped). A prompt's model is read from its first model response and settled at its end, from what the API says answered (a fallback can change it). A subagent's is the one its spawn resolved to. A tool call has none of its own: its details say which model called it, the model of the prompt or subagent it ran in. A finished prompt's summary lists the models used. The [Copilot port](../vscode/README.md) has no model: its hooks do not carry one.

## Summary of a finished prompt

When a prompt has finished and made at least one call, a summary ends its rows (not while it runs, when it is folded, or for a prompt read back from history):

- **Calls**: the tool calls, how many failed, how long the prompt took, and how much of that some call was running (overlaps count once).
- **By tool**: one line per tool, the most called first, with its calls, average time, total time and tokens, and its failures.
- **Average**, **slowest** and **heaviest** call (the one that moved the most text, in plus out).
- **Tokens**: in, out and total, as the API reported them for the prompt and its subagents; the **cache** line says how much input came from the cache, and **call text** the estimate of what the tools were given and returned. With no reported usage the tokens line is the estimate (the prompt and every call's input, the answer and every call's output).
- **Models**: the models the prompt and its subagents ran on.
- **Subagents**: how many, how many failed, and the longest. They are not counted as tool calls, and their time overlaps their own calls.

**Copy as markdown** (a button on the summary) puts the whole summary on the clipboard as markdown: a bullet list of the figures and a table with every tool, for a ticket, a PR or a chat. `src/pane/markdown.ts` builds it.

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
                      cells (the right-hand columns), report (the summary)
src/stats.ts          the summary's numbers, from a prompt's rows, and modelOf
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
