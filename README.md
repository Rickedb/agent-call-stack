# ai-call-tree

A Claude Code mod that adds a live "Call tree" pane beside the chat. It shows what Claude is doing as a tree, like a stack trace: each prompt, the subagents it started, and the tool calls inside them, with status and duration. Running calls are listed at the top as the current stack, innermost first.

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

## Use

The pane opens at session start. Run `/call-tree` to open it again.

## Develop

Validate and type-check:

```bash
claude plugin validate .
```

Load it in a session with `claude --plugin-dir <this folder>`.
