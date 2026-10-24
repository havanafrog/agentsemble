#!/usr/bin/env node
// The team from one terminal.
//
//   agentsemble            in a repo folder: this window becomes main — claude starts here, named after
//                          the main role, and runs /agentsemble (read the repo, propose a team, set it up)
//   agentsemble open       from main, once setup is done: each sub role opens as a tab beside main
//   agentsemble --install  put the `agentsemble` command on PATH (npm's global folder; Windows)
//
// ponytail: tabs need Windows Terminal. Elsewhere `open` prints the command for each role to run by hand.
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAgents } from './lib/agents.mjs';
import { command, launch } from './lib/open.mjs';

const repoOf = cwd => { try { return execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
const rolesOf = repo => { try { return repo && existsSync(join(repo, 'agents.json')) ? loadAgents(repo).roles : []; } catch { return []; } };

/** The main role's window name: from agents.json when there is one, else "main". */
export function mainName(roles) { return roles.find(r => r.isMain)?.name ?? 'main'; }

/** What `open` runs, one per sub role: [dir, cmd]. Shared roles open in the main folder. */
export function subLaunches(roles, repo) {
  return roles.filter(r => !r.isMain).map(r => [r.shared ? repo : r.dir, command({ model: r.model ?? null, name: r.name })]);
}

/** The shim on PATH finds the newest installed agentsemble each time, so plugin updates need no reinstall. */
export const SHIM = `// agentsemble command — runs bin/team.mjs of the newest agentsemble in the plugin cache.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
const base = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'plugins', 'cache', 'agentsemble', 'agentsemble');
const v = s => s.split('.').map(Number);
const newest = readdirSync(base).filter(d => /^\\d+\\.\\d+\\.\\d+$/.test(d)).sort((a, b) => { const [x, y] = [v(a), v(b)]; return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; }).at(-1);
if (!newest) { console.error('agentsemble is not installed: /plugin install agentsemble'); process.exit(1); }
await import(pathToFileURL(join(base, newest, 'bin', 'team.mjs')).href);
`;

async function main(argv) {
  if (argv[0] === '--install') {
    const dir = execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['prefix', '-g'], { encoding: 'utf8', shell: process.platform === 'win32' }).trim();
    const bin = process.platform === 'win32' ? dir : join(dir, 'bin');
    writeFileSync(join(bin, 'agentsemble.mjs'), SHIM);
    if (process.platform === 'win32') writeFileSync(join(bin, 'agentsemble.cmd'), '@node "%~dp0agentsemble.mjs" %*\r\n');
    else { writeFileSync(join(bin, 'agentsemble'), `#!/bin/sh\nexec node "${join(bin, 'agentsemble.mjs')}" "$@"\n`, { mode: 0o755 }); }
    return console.log(`installed: ${join(bin, process.platform === 'win32' ? 'agentsemble.cmd' : 'agentsemble')} — open a new terminal and type agentsemble in a repo folder`);
  }
  const repo = repoOf(process.cwd()), roles = rolesOf(repo);
  if (argv[0] === 'open') {
    if (!roles.length) { console.error('no agents.json here — run agentsemble (or /agentsemble) first'); process.exit(1); }
    // Run from main's window: Windows Terminal's most recent window (-w 0) is the one typed in, so
    // every sub joins it as a tab. The pause lets each tab start before the next is asked for.
    for (const [i, [dir, cmd]] of subLaunches(roles, repo).entries()) {
      const r = launch(dir, cmd, process.platform, spawn, '0');
      console.log(r === 'opened' ? `opened  ${cmd}` : `${r}  — run by hand:  cd "${dir}" && ${cmd}`);
      if (i < roles.length - 2) await new Promise(res => setTimeout(res, 1500));
    }
    return;
  }
  if (argv.length) { console.error('usage: agentsemble [open | --install]'); process.exit(1); }
  // This window becomes main: claude starts in it, named so the board and SendMessage find it.
  const name = mainName(roles);
  const c = spawn('claude', ['--name', name, '/agentsemble'], { stdio: 'inherit', shell: process.platform === 'win32' });
  c.on('exit', code => process.exit(code ?? 0));
}

export function selftest(ok) {
  ok('no team yet: this window is "main"', mainName([]) === 'main');
  ok('a team names main by its role', mainName([{ name: 'lead', isMain: true }, { name: 'ui' }]) === 'lead');
  const L = subLaunches([{ name: 'main', isMain: true, dir: 'D:/r' }, { name: 'ui', dir: 'D:/r-team/ui', model: 'sonnet' }, { name: 'review', shared: true, dir: 'D:/r', model: 'opus' }], 'D:/r');
  ok('open: one tab per sub, named after its role, with its model; main is not reopened',
     L.length === 2 && L[0][0] === 'D:/r-team/ui' && L[0][1] === 'claude --model sonnet --name ui' && L[1][1] === 'claude --model opus --name review');
  ok('the PATH shim picks the newest version by number, not by text', /x\[0\] - y\[0\]/.test(SHIM));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main(process.argv.slice(2));
else if (process.argv[1] && /agentsemble\.mjs$/.test(process.argv[1])) await main(process.argv.slice(2));
