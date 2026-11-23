# ai-call-tree

A live "Call tree" pane for coding agents. It shows what the agent is doing as a tree, like a stack trace: each prompt, the subagents it started, and the tool calls inside them, with status, duration and the size of each output in tokens. Running calls are listed at the top as the current stack, innermost first. The pane draws as a tree or a waterfall, and a row opens its input and output.

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

## One folder per agent

| Agent | Folder | What it is |
| --- | --- | --- |
| Claude Code | [`claude/`](claude/README.md) | A Claude Code mod: hooks on the engine's events and a pane beside the chat. |
| GitHub Copilot in VS Code | [`vscode/`](vscode/README.md) | A hook script that records the agent's events, and an extension that draws the same pane. |
| Claude Code in VS Code | [`claude-vscode/`](claude-vscode/README.md) | The same idea for Claude Code's VS Code extension: a hook script records Claude Code's events, and a separate extension draws the pane and reads the model and token counts from Claude Code's transcript. |

The targets keep the same features; what differs is listed in [AGENTS.md](AGENTS.md), which is also the rule for changing any of them.

The Claude Code marketplace manifest stays in `.claude-plugin/` at the root and points at `claude/`.
