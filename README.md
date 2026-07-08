# Claude Code Notifier

Sound + VS Code toast when a Claude Code instance **stops**, **asks a question**, or **needs permission**. Works across multiple Claude Code instances — they all POST to one listener.

## How it works

Extension runs a localhost HTTP server (default `127.0.0.1:47000`). Claude Code `http` hooks POST to it per event; the extension plays a sound and shows a toast. VS Code renders its own notifications, so they show even on macOS 26 where CLI banners are dropped.

## Install (dev)

1. Open this folder in VS Code.
2. Press `F5` → launches an Extension Development Host with it loaded.

## Install (permanent)

```
npm i -g @vscode/vsce
cd claude-code-notifier
vsce package
code --install-extension claude-code-notifier-0.0.1.vsix
```

## Wire up Claude Code hooks

Add to `~/.claude/settings.json` (replaces the `afplay` hooks):

```json
"hooks": {
  "PreToolUse": [
    { "matcher": "AskUserQuestion|ExitPlanMode",
      "hooks": [{ "type": "http", "url": "http://127.0.0.1:47000/ask" }] }
  ],
  "PermissionRequest": [
    { "hooks": [{ "type": "http", "url": "http://127.0.0.1:47000/permission" }] }
  ],
  "Stop": [
    { "hooks": [{ "type": "http", "url": "http://127.0.0.1:47000/stop" }] }
  ]
}
```

Reload Claude Code (`/hooks` or restart) after editing.

## Settings

- `claudeNotifier.port` — listener port (default 47000). Match the hook URLs.
- `claudeNotifier.sound` — play sound (default true).
- `claudeNotifier.notification` — show toast (default true).

## Notes

- Sound uses macOS `afplay`. Other platforms: toast only (add a player in `extension.js` `play()`).
- If VS Code isn't running, hooks fail silently — no sound. Keep `afplay` hooks too if you want sound when VS Code is closed.
