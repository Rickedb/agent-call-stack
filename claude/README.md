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

## Tokens

Each row shows the size of its output in tokens (`~340 tok`), and a row's details show both the input and the output. These are estimates, at four characters a token, from the whole text. The engine gives no count per call, so every row is estimated alike. The [Copilot port](../vscode/README.md) does the same.

## Use

The pane opens at session start. Run `/call-tree` to open it again.

## Develop

Validate and type-check:

```bash
claude plugin validate .
```

Run it from this folder (`claude/`). Load it in a session with `claude --plugin-dir <this folder>`.

Install from the marketplace at the repo root:

```
/plugin install ai-call-tree --marketplace Rickedb/ai-call-tree
```
