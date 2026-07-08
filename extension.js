const vscode = require('vscode');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

// event key -> { sound file, base label, prominence }
const EVENTS = {
  stop:       { sound: '/System/Library/Sounds/Glass.aiff', label: 'Claude finished — your turn', warn: false },
  ask:        { sound: '/System/Library/Sounds/Ping.aiff',  label: 'Claude is asking you a question', warn: true },
  permission: { sound: '/System/Library/Sounds/Ping.aiff',  label: 'Claude needs your permission', warn: true },
};

// AskUserQuestion/ExitPlanMode also raise a PermissionRequest; the /ask toast
// already covers those, so skip the permission toast for them to avoid doubles.
const ASK_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode']);

// Shared drop box. One window binds the port and drops each event here; EVERY
// window watches it and shows the toast, so you see it whichever window is focused.
const EVENTS_DIR = path.join(os.tmpdir(), 'claude-code-notifier-events');
const POLL_MS = 750;
const REAP_MS = 8000; // owner deletes event files older than this

function cfg() { return vscode.workspace.getConfiguration('claudeNotifier'); }

function play(file) {
  if (process.platform !== 'darwin') return; // afplay is macOS-only for now
  execFile('/usr/bin/afplay', [file], () => {});
}

// Project folder name, so the toast says which Claude Code instance fired.
function projectName(payload) {
  const cwd = payload && payload.cwd;
  return cwd ? path.basename(cwd) : '';
}

// Question text from an AskUserQuestion tool_input (shape confirmed live).
function questionText(payload) {
  const q = payload && payload.tool_input && payload.tool_input.questions;
  if (Array.isArray(q) && q[0]) return q[0].question || q[0].header || '';
  return '';
}

// What a PermissionRequest is asking to run, e.g. "Bash — Read the log".
function permissionDetail(payload) {
  const name = payload && payload.tool_name;
  if (!name) return '';
  const ti = payload.tool_input || {};
  const extra = ti.description || ti.command || ti.file_path || '';
  return extra ? `${name} — ${extra}` : name;
}

// Build the toast text. Returns null to suppress the toast entirely.
function label(evtKey, payload) {
  const proj = projectName(payload);
  const tag = proj ? `[${proj}] ` : '';

  if (evtKey === 'ask') {
    const q = questionText(payload);
    return q ? `${tag}${q}` : `${tag}${EVENTS.ask.label}`;
  }
  if (evtKey === 'permission') {
    if (payload && ASK_TOOLS.has(payload.tool_name)) return null; // covered by /ask
    const detail = permissionDetail(payload);
    return detail ? `${tag}Claude needs permission: ${detail}` : `${tag}${EVENTS.permission.label}`;
  }
  return proj ? `${EVENTS.stop.label} — ${proj}` : EVENTS.stop.label; // stop
}

// Show the toast in this window; play the sound only if withSound (owner only,
// so N windows don't stack N Pings for one event).
function present(evtKey, payload, withSound) {
  const evt = EVENTS[evtKey];
  if (!evt) return;
  const text = label(evtKey, payload);
  if (text === null) return; // suppressed (e.g. duplicate permission for a question)
  const c = cfg();
  if (withSound && c.get('sound', true)) play(evt.sound);
  if (c.get('notification', true)) {
    try {
      if (evt.warn) vscode.window.showWarningMessage(text);
      else vscode.window.showInformationMessage(text);
    } catch (err) {
      console.error('[claude-notifier] toast failed', err);
    }
  }
}

function activate(context) {
  const port = cfg().get('port', 47000);
  try { fs.mkdirSync(EVENTS_DIR, { recursive: true }); } catch (_) {}

  let isOwner = false;
  let seq = 0;
  let server = null;

  // Port owner: receive hooks and drop each event as a file for all windows.
  function onRequest(req, res) {
    const key = (req.url || '').replace(/^\/+/, '').split('?')[0].toLowerCase();
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
      let payload = {};
      if (body) { try { payload = JSON.parse(body); } catch (_) {} }
      payload.__evt = key;
      const name = `evt-${Date.now()}-${seq++}.json`;
      try { fs.writeFileSync(path.join(EVENTS_DIR, name), JSON.stringify(payload)); } catch (e) {
        console.error('[claude-notifier] write event failed', e);
      }
    });
  }

  // Try to become the port owner. Non-owners retry, so when the current owner's
  // window closes and frees the port, another window takes over automatically.
  function tryBind() {
    if (isOwner) return;
    if (server) { try { server.close(); } catch (_) {} }
    const s = http.createServer(onRequest);
    server = s;
    s.on('error', (e) => {
      if (e.code !== 'EADDRINUSE') console.error('[claude-notifier]', e);
      isOwner = false;
      if (server === s) { try { s.close(); } catch (_) {} server = null; }
    });
    s.on('listening', () => { isOwner = true; });
    s.on('close', () => { if (server === s) { isOwner = false; server = null; } });
    try { s.listen(port, '127.0.0.1'); } catch (_) {}
  }

  tryBind();
  const bindTimer = setInterval(tryBind, 3000);
  context.subscriptions.push({ dispose: () => { clearInterval(bindTimer); if (server) try { server.close(); } catch (_) {} } });

  // Every window watches the drop box and shows every event's toast.
  // The owner also plays the sound (once) and reaps old files.
  const seen = new Set();
  function poll() {
    let files;
    try { files = fs.readdirSync(EVENTS_DIR); } catch (_) { return; }
    const now = Date.now();
    const jsons = files.filter((n) => n.endsWith('.json'));

    for (const name of jsons) {
      if (seen.has(name)) continue;
      seen.add(name);
      let payload;
      try { payload = JSON.parse(fs.readFileSync(path.join(EVENTS_DIR, name), 'utf8')); } catch (_) { continue; }
      present(payload.__evt, payload, isOwner);
    }

    if (isOwner) {
      for (const name of jsons) {
        const full = path.join(EVENTS_DIR, name);
        let stat; try { stat = fs.statSync(full); } catch (_) { continue; }
        if (now - stat.mtimeMs > REAP_MS) { try { fs.unlinkSync(full); } catch (_) {} }
      }
    }
    for (const n of seen) if (!jsons.includes(n)) seen.delete(n);
  }

  const timer = setInterval(poll, POLL_MS);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
  try {
    const watcher = fs.watch(EVENTS_DIR, () => poll());
    context.subscriptions.push({ dispose: () => watcher.close() });
  } catch (_) { /* fs.watch unsupported — poll still covers it */ }
}

function deactivate() {}

module.exports = { activate, deactivate };
