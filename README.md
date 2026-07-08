# Claude Code Notifications

Sound and toast when Claude Code either: needs a permission, asks you a question, or finishes. Fires in every open Cursor/VS Code window, so you catch it wherever you're looking.

## 1. Install the extension

```sh
cd claude-code-notifications
npx @vscode/vsce package --allow-missing-repository
cursor --install-extension claude-code-notifications-0.2.2.vsix   # or: code --install-extension …
```

Then reload each window: `Cmd+Shift+P` → Reload Window.

## 2. Wire up the hooks

Paste this into Claude Code and it'll do it for you:

> Add HTTP hooks to my `~/.claude/settings.json`, merging into any existing `hooks` block:
> - `PreToolUse` matching `AskUserQuestion|ExitPlanMode` → POST `http://127.0.0.1:47000/ask`
> - `PermissionRequest` → POST `http://127.0.0.1:47000/permission`
> - `Stop` → POST `http://127.0.0.1:47000/stop`

Reload Claude Code with `/hooks` and you're done.

## Settings

- `claudeNotifier.port` — listener port (default 47000). Match your hook URLs if you change it.
- `claudeNotifier.sound` — play sound (default true; macOS `afplay` only).
- `claudeNotifier.notification` — show toast (default true).
