#!/usr/bin/env node
// Builds a made-up team in a temp folder — a "shop" repo, three sub roles, session logs, a ledger —
// and starts the board on it, so screenshots show the board without anyone's real sessions.
//
//   node docs/demo/make-demo.mjs        → prints the folder and http://127.0.0.1:8741
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const t = mkdtempSync(join(tmpdir(), 'as-demo-'));
const repo = join(t, 'shop'), home = join(t, 'home');
const g = (d, ...a) => execFileSync('git', ['-C', d, '-c', 'user.email=demo@example.com', '-c', 'user.name=demo', ...a], { stdio: 'ignore' });
const put = (f, s) => { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, s); };
const slug = p => p.replace(/[^A-Za-z0-9]/g, '-');

mkdirSync(repo);
g(repo, 'init', '-q', '-b', 'main');
for (const f of ['web/index.html', 'web/app.js', 'web/style.css', 'api/server.mjs', 'api/routes.mjs', 'api/db.mjs',
  'ml/rank.mjs', 'ml/train.mjs', 'ml/clicks.csv', 'test/run.mjs', 'docs/api.md', 'README.md', 'package.json']) put(join(repo, f), '// ' + f + '\n');
put(join(repo, 'agents.json'), JSON.stringify({
  main: { dir: '.', what: 'split, check, merge', owns: ['test/', 'README.md', 'package.json'], model: 'opus' },
  web: { dir: '../shop-team/web', branch: 'agent/web', what: 'product page', owns: ['web/'], model: 'sonnet' },
  api: { dir: '../shop-team/api', branch: 'agent/api', what: 'HTTP API', owns: ['api/', 'docs/'], model: 'sonnet', autonomy: 'run' },
  ml: { dir: '../shop-team/ml', branch: 'agent/ml', what: 'ranking model', owns: ['ml/'], model: 'sonnet' },
  review: { shared: true, what: 'reads and checks', model: 'opus' },
}, null, 2));
g(repo, 'add', '-A'); g(repo, 'commit', '-qm', 'shop');
const wt = {};
for (const r of ['web', 'api', 'ml']) { wt[r] = join(t, 'shop-team', r); g(repo, 'worktree', 'add', '-q', '-b', 'agent/' + r, wt[r]); }
put(join(wt.web, 'web', 'app.js'), 'x'); put(join(wt.web, 'web', 'style.css'), 'x'); put(join(wt.web, 'api', 'routes.mjs'), 'x');
g(wt.web, 'commit', '-qam', 'list page');
put(join(wt.api, 'api', 'routes.mjs'), 'y'); put(join(wt.api, 'api', 'server.mjs'), 'y'); g(wt.api, 'commit', '-qam', 'routes');
put(join(wt.ml, 'ml', 'rank.mjs'), 'z');

const now = Date.now(), at = s => new Date(now - s * 1000).toISOString();
let n = 0;
const id = () => `${(++n).toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
function session(dir, name, rows, ago) {
  const sid = id();
  put(join(home, 'sessions', sid + '.json'), JSON.stringify({ sessionId: sid, name, nameSource: 'user', cwd: dir, updatedAt: now - ago * 1000 }));
  const lines = rows.map(([role, content, s]) => JSON.stringify({ type: role, sessionId: sid, cwd: dir, gitBranch: 'x', timestamp: at(s),
    message: { role, content } }));
  const log = join(home, 'projects', slug(dir), sid + '.jsonl');
  put(log, lines.join('\n') + '\n');
  const when = (now - ago * 1000) / 1000;
  utimesSync(log, when, when);                     // the board reads activity from the log's mtime
}
const say = (to, summary, message) => ({ type: 'tool_use', name: 'SendMessage', input: { to, summary, message } });
const tool = (name, input) => ({ type: 'tool_use', name, input });
session(repo, 'main', [
  ['user', 'add ranked products to the shop page', 900],
  ['assistant', [say('web', 'product list with rank badge', 'build the list'), say('api', 'GET /api/products?sort=rank', 'add sort')], 880],
  ['assistant', [say('ml', 'rank() from clicks.csv', 'train it')], 870],
  ['assistant', [tool('Bash', { description: 'Merge agent/api into main' })], 30],
], 10);
session(wt.web, 'web', [['user', 'product list with rank badge', 860], ['assistant', [tool('Edit', { file_path: 'web/app.js' })], 8]], 5);
session(wt.api, 'api', [['user', 'GET /api/products?sort=rank', 860], ['assistant', [tool('Bash', { description: 'Run API tests' })], 200],
  ['assistant', 'Done — 14 tests pass, commit 3f2a1c9.', 190]], 190);
session(wt.ml, 'ml', [['user', 'rank() from clicks.csv', 850], ['assistant', [tool('Bash', { description: 'Train ranker on clicks.csv' })], 40]], 40);
session(repo, 'review', [['user', 'check what api claims', 300], ['assistant', [tool('Bash', { description: 'Re-run API tests' })], 120]], 900);
const ledger = join(t, 'ledger.jsonl');
put(ledger, [
  { kind: 'claim', id: 'C1', what: 'GET /api/products?sort=rank returns rank order', how: 'npm test -- api', by: 'builder', at: at(180) },
  { kind: 'verdict', id: 'C1', v: 'confirm', note: 'reran, 14/14 pass', by: 'verifier', at: at(100) },
  { kind: 'claim', id: 'C2', what: 'ranker beats click-count baseline', how: 'node ml/train.mjs --eval', by: 'builder', at: at(60) },
].map(r => JSON.stringify(r)).join('\n') + '\n');

const port = process.env.PORT ?? '8741';
spawn(process.execPath, [join(HERE, '..', '..', 'bin', 'board.mjs'), '--port', port], {
  cwd: repo, stdio: 'inherit', env: { ...process.env, CLAUDE_HOME: home, OPS_LEDGER: ledger },
});
console.log(`demo in ${t}\nboard http://127.0.0.1:${port}`);
