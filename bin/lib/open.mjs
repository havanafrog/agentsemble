// Bring a session's terminal window to the front, or reopen a closed one — from a click on the board.
//
// Finding the window: a session's pid doesn't lead to it on Windows (claude.exe and its cmd.exe both
// report MainWindowHandle 0; Windows Terminal owns the real window, one pid for every tab). What does
// work is the title: Claude Code puts the session name there. So a window is found by its /rename name.
//
// ponytail: Windows only. Elsewhere the board shows the command to copy. Add macOS (osascript) when asked.
import { execFile, spawn } from 'node:child_process';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The name goes in through an env var, never into the command string — names can hold quotes.
const PS = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;using System.Text;using System.Runtime.InteropServices;
public class AsFocus {
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern void SwitchToThisWindow(IntPtr h, bool alt);
  delegate bool EnumProc(IntPtr h, IntPtr p);
  public static string Go(string needle) {
    IntPtr hit = IntPtr.Zero;
    EnumWindows((h,p) => { if (!IsWindowVisible(h)) return true;
      var t = new StringBuilder(300); GetWindowText(h, t, 300);
      // Claude Code titles a window "<spinner> <name>". Match the whole name, not a substring —
      // a role called "ui" must not grab a browser tab that mentions "build".
      var s = t.ToString().Trim();
      if (s == needle || s.EndsWith(" " + needle)) { hit = h; return false; } return true; }, IntPtr.Zero);
    if (hit == IntPtr.Zero) return "notfound";
    return Front(hit);
  }
  public static string Front(IntPtr hit) {
    if (IsIconic(hit)) ShowWindow(hit, 9);
    SwitchToThisWindow(hit, true);   // SetForegroundWindow is ignored when a background process calls it
    return "ok";
  }
}
"@
$r = [AsFocus]::Go($env:AS_FOCUS_NEEDLE)
# Windows Terminal titles its window after the tab in front only. A session in a tab behind it is found
# by the tab's name (UI Automation), and the window holding it comes forward; the tab stays as it is.
if ($r -eq 'notfound') {
  Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
  $A = [System.Windows.Automation.AutomationElement]
  $wins = $A::RootElement.FindAll('Children', (New-Object System.Windows.Automation.PropertyCondition($A::ClassNameProperty, 'CASCADIA_HOSTING_WINDOW_CLASS')))
  $tab = New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::TabItem)
  $n = $env:AS_FOCUS_NEEDLE
  foreach ($w in $wins) {
    foreach ($t in $w.FindAll('Descendants', $tab)) {
      $s = $t.Current.Name.Trim()
      if ($s -eq $n -or $s.EndsWith(' ' + $n)) { $r = [AsFocus]::Front([IntPtr]$w.Current.NativeWindowHandle); break }
    }
    if ($r -ne 'notfound') { break }
  }
}
$r
`;

/**
 * Bring the window whose title (or one of whose Windows Terminal tabs) holds `name` to the front:
 * 'ok' | 'notfound' | 'noname' | 'unsupported' | 'failed'. The timeout is long because where antivirus
 * scans each process, PowerShell plus Add-Type's C# compile alone takes half a minute.
 */
export function focus(name, platform = process.platform) {
  return new Promise(resolve => {
    if (platform !== 'win32') return resolve('unsupported');
    if (!name || !String(name).trim()) return resolve('noname');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS],
      { env: { ...process.env, AS_FOCUS_NEEDLE: String(name) }, timeout: 60_000 },
      (err, out) => resolve(err ? 'failed' : (String(out).trim() || 'failed')));
  });
}

/**
 * The command a new terminal runs: resume a session, or start the role fresh (with its model).
 * The role name becomes the window name so the board and SendMessage find it without /rename;
 * a name with other characters is left out rather than quoted.
 */
export function command({ id = null, model = null, name = null } = {}) {
  if (id != null && !UUID.test(id)) return null;
  if (model != null && !/^[\w.-]+(\[\w+\])?$/.test(model)) return null;
  const nm = name && /^[\w.-]+$/.test(name) ? name : null;
  return ['claude', ...(id ? ['--resume', id] : []), ...(model ? ['--model', model] : []), ...(nm ? ['--name', nm] : [])].join(' ');
}

/**
 * Open a new terminal in `dir` running `cmd`: 'opened' | 'unsupported' | 'bad' | 'failed'.
 * With `win`, it is a tab in the Windows Terminal window of that name — the first Open makes the
 * window, later ones join it. No Windows Terminal: a plain window.
 */
export function launch(dir, cmd, platform = process.platform, run = spawn, win = null) {
  if (!cmd) return 'bad';
  if (platform !== 'win32') return 'unsupported';
  if (win) {
    try { run('wt', ['-w', win, 'new-tab', '-d', dir, 'cmd', '/k', cmd], { detached: true, stdio: 'ignore' }).unref(); return 'opened'; }
    catch { /* no Windows Terminal: fall back to a plain window */ }
  }
  try {
    // start's first quoted argument is the window title; leave it empty so the path isn't taken for one.
    run('cmd', ['/c', 'start', '', 'cmd', '/k', cmd], { cwd: dir, detached: true, stdio: 'ignore' }).unref();
    return 'opened';
  } catch { return 'failed'; }
}

/**
 * One click from the board. A live window is brought forward; never reopen a live session — two
 * windows on one session break both. A live window without a name can't be found: say so.
 * @param s     the session (id, role) or null to start the role fresh
 * @param live  the registry entry if its window is open
 * @param role  { dir, model, shared, win } — win: the Windows Terminal window its tab joins
 */
export async function openWindow({ s, live, role }, platform = process.platform, run = spawn, find = focus) {
  if (live) {
    const r = await find(live.named ? live.name : null, platform);
    return r === 'noname' ? 'unnamed' : r;
  }
  return launch(role.dir, command({ id: s?.id ?? null, model: s ? null : role.model ?? null, name: s ? null : role.name ?? null }), platform, run, role.win ?? null);
}

export async function selftest(ok) {
  ok('a session id must be a UUID before it reaches a command', command({ id: 'x; calc' }) === null && command({ id: '' }) === null);
  ok('a model name with shell characters is refused', command({ model: 'opus && calc' }) === null);
  ok('the role name goes in as the window name; an odd one is left out', command({ model: 'opus', name: 'review' }) === 'claude --model opus --name review'
     && command({ name: 'a b"' }) === 'claude');
  ok('resume and fresh-start commands', command({ id: '0123abcd-0000-4000-8000-0123456789ab' }) === 'claude --resume 0123abcd-0000-4000-8000-0123456789ab'
     && command({ model: 'opus' }) === 'claude --model opus' && command() === 'claude');
  const calls = [];
  const run = (...a) => { calls.push(a); return { unref() {} }; };
  ok('a closed session reopens in its role folder', await openWindow({ s: { id: '0123abcd-0000-4000-8000-0123456789ab' }, live: null, role: { dir: 'D:/w/ui' } }, 'win32', run) === 'opened'
     && calls[0][1].at(-1) === 'claude --resume 0123abcd-0000-4000-8000-0123456789ab' && calls[0][2].cwd === 'D:/w/ui');
  ok('a role with no session starts fresh with its model', await openWindow({ s: null, live: null, role: { dir: 'D:/w', model: 'opus', name: 'review' } }, 'win32', run) === 'opened'
     && calls[1][1].at(-1) === 'claude --model opus --name review');
  ok('a live window is focused, never reopened', await openWindow({ s: { id: 'x' }, live: { named: true, name: 'ui' }, role: { dir: '.' } }, 'win32', run, async n => n === 'ui' ? 'ok' : 'notfound') === 'ok' && calls.length === 2);
  ok('a live window with no name says so', await openWindow({ s: { id: 'x' }, live: { named: false, name: 'x' }, role: { dir: '.' } }, 'win32', run, async n => n ? 'ok' : 'noname') === 'unnamed');
  ok('with a window name it opens as a tab in that Windows Terminal window', await openWindow({ s: null, live: null, role: { dir: 'D:/w', name: 'ui', win: 'agentsemble-p1' } }, 'win32', run) === 'opened'
     && calls[2][0] === 'wt' && calls[2][1].join(' ') === '-w agentsemble-p1 new-tab -d D:/w cmd /k claude --name ui');
  const noWt = (...a) => { calls.push(a); if (a[0] === 'wt') throw new Error('ENOENT'); return { unref() {} }; };
  ok('no Windows Terminal: a plain window instead', launch('D:/w', 'claude', 'win32', noWt, 'agentsemble-p0') === 'opened' && calls.at(-1)[0] === 'cmd');
  calls.length = 2;
  ok('not Windows: nothing is launched', await openWindow({ s: null, live: null, role: { dir: '.' } }, 'linux', run) === 'unsupported' && calls.length === 2);
}
