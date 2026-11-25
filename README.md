# Agent Call Stack

See what a coding agent is doing while it works, as a live call stack: each prompt, what the model thought and replied between calls, the subagents it started and the tool calls inside them, with status, duration and the size of each output in tokens. Running calls are listed at the top as the current stack, innermost first. The view draws as a tree or a waterfall, and a row opens its input and output.

It exists for three agents, with the same features in each:

<p align="center">
  <img src="vscode/docs/images/waterfall-dark.png" width="340" alt="Agent Call Stack for GitHub Copilot: the waterfall of a session">
  <img src="claude-vscode/docs/images/waterfall-dark.png" width="340" alt="Agent Call Stack for Claude in VS Code: the same session, with models, tokens and approvals">
</p>
<p align="center"><sub>Left: GitHub Copilot in VS Code. Right: Claude Code in VS Code, which also shows the model, the tokens the API counted and the approvals. The same made-up session in both, drawn by the extensions' own code.</sub></p>

## Pick your agent

| Agent | Folder | What it is | Install |
| --- | --- | --- | --- |
| GitHub Copilot in VS Code | [`vscode/`](vscode/README.md) | A hook script that records the agent's events, and an extension that draws the pane in the side bar. | The extension, then **Install Copilot Hooks** in its view. |
| Claude Code in VS Code | [`claude-vscode/`](claude-vscode/README.md) | The same idea for Claude Code's VS Code extension: a hook script records Claude Code's events, and a separate extension draws the pane and reads the model and token counts from Claude Code's transcript. | The extension, then **Add to your settings** in its view. |
| Claude Code (terminal and desktop) | [`claude/`](claude/README.md) | A Claude Code mod: hooks on the engine's events and a pane beside the chat. | `/plugin install agent-call-stack --marketplace Rickedb/agent-call-stack` |

The targets keep the same features; what differs is listed in [AGENTS.md](AGENTS.md), which is also the rule for changing any of them. The Claude Code marketplace manifest stays in `.claude-plugin/` at the root and points at `claude/`.

## What you see

- **The stack.** What runs right now, innermost first.
- **A tree or a waterfall.** The same rows nested with status marks, or as bars on a time axis that show what overlapped.
- **What the model wrote.** A `Thinking` and a `Reply` row in order among the calls.
- **Subagents** as rows holding their own calls, and what each call involved (files, addresses, commands, searches), named by what it ran (`npm`, not `cd`).
- **Details of a row**: state, timing, sizes, and its input and output, with *Show all* and copy.
- **A summary of each finished prompt**: calls, failures, time, a line per tool, the slowest and heaviest call, tokens, and a markdown copy for a ticket or a PR.
- **Errors and compactions** as rows of their own.

<p align="center">
  <img src="claude-vscode/docs/images/tree-dark.png" width="340" alt="The tree view, with a subagent holding its calls">
  <img src="claude-vscode/docs/images/details-dark.png" width="340" alt="A failed call's details, in a modal">
</p>

Each README has a tour with more pictures: [Copilot](vscode/README.md#a-tour) and [Claude Code in VS Code](claude-vscode/README.md#a-tour). The terminal pane of the [Claude Code mod](claude/README.md) is text, so its README shows the layout as an illustration.

## Pictures in the READMEs

The pictures are generated, not drawn: [`scripts/screenshots/shots.cjs`](scripts/screenshots/shots.cjs) builds one made-up session ("fix the failing login test") with each extension's own model, renders it with the extension's own view code and stylesheet in a dark and a light theme, and captures the page with Electron into each extension's `docs/images/`. To redo them after a change to a view:

```bash
(cd vscode && npm install && npm run build)
(cd claude-vscode && npm install && npm run build)
ELECTRON=/path/to/electron node scripts/screenshots/shots.cjs
```

`ELECTRON` is an Electron binary: your distro's `electron`, or the one `npm i -D electron` installs. The images are kept out of the `.vsix` (`.vscodeignore`); the Marketplace page loads them from the repository.

## Icons

The artwork's full-size sources are in [`assets/`](assets/) (1254 px). The sizes each marketplace takes are made from them (cropped square to the artwork, Lanczos resize, transparent background: the source's dark backdrop is taken out, the panels are kept solid and the glow fades to transparent):

| File | Size | Used by |
| --- | --- | --- |
| `vscode/media/icon.png` | 256 × 256 | the Copilot extension's `icon` (VS Code Marketplace asks for at least 128 px, PNG, no SVG) |
| `claude-vscode/media/icon.png` | 256 × 256 | the Claude Code extension's `icon` (orange variant) |
| `vscode/media/icon.svg`, `claude-vscode/media/icon.svg` | 24 × 24 viewBox | the side bar (activity bar) icon. It has to be a single-colour SVG that takes the theme's colour, so the glowing artwork is redrawn flat: the top bar with its emblem (the Copilot robot for Copilot, a starburst for Claude) and the stack of bars below. |
| `claude/icon.png` | 512 × 512 | the Claude Code plugin (orange variant). Claude Code's plugin and marketplace manifests have no icon field, so the file sits beside the plugin for listings that ask for one. |

## Releasing the VS Code extensions

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) tests and packs both extensions, and runs the Claude Code plugin's tests (`claude plugin test`), on every push to `master` and every pull request. [`.github/workflows/publish.yml`](.github/workflows/publish.yml) publishes `vscode/` and `claude-vscode/` to the Visual Studio Marketplace (and to Open VSX, if you set a token) and attaches the `.vsix` files to a GitHub release.

One-time setup:

1. Create a publisher at <https://marketplace.visualstudio.com/manage> and put its ID in `publisher` in both `vscode/package.json` and `claude-vscode/package.json` (it is `local` now, and the workflow refuses to publish with it).
2. Create an Azure DevOps personal access token (organization: *All accessible organizations*, scope: *Marketplace > Manage*) and save it as the repository secret `VSCE_PAT`.
3. Optional: a token from <https://open-vsx.org> as the secret `OVSX_PAT` (the publisher name must be claimed there first). Without it the Open VSX step is skipped.
4. Optional: in *Settings > Environments*, add required reviewers to the `marketplace` environment so each publish waits for an approval.

To release: raise `version` in both `package.json` files, commit, then

```bash
git tag v0.1.1 && git push origin v0.1.1
```

The tag must equal the version (without the `v`) or the build fails. To try the pipeline without publishing, run the workflow by hand from the Actions tab with *dry run* ticked, or pick a single extension to publish.
