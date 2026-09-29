#!/usr/bin/env node
// Make a folder ready for agentsemble when it is not a git repo yet (or has no commit):
// git init, a starter .gitignore, and a first commit — so people who never use git can still
// have a team. Run only after the human said yes.
//
//   node bin/init.mjs [--dry-run]
//
// Refuses to commit when it sees files that look like secrets or are very large; it names them
// so the human can decide, instead of publishing them into history.
import { existsSync, readFileSync, writeFileSync, statSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir, userInfo } from 'node:os';
import { execFileSync } from 'node:child_process';
import { isMain } from './lib/paths.mjs';

export const IGNORE = ['node_modules/', '.venv/', 'venv/', '__pycache__/', '.env', '.env.*', '*.log',
  '.DS_Store', 'Thumbs.db'];
const SECRET = /(^|\/)(\.env(\..*)?|.*\.(pem|key|p12|pfx)|id_(rsa|ed25519)|credentials(\.json)?|.*secret.*)$/i;
const BIG = 50 * 1024 * 1024;

const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tryGit = (dir, ...a) => { try { return git(dir, ...a); } catch { return null; } };

/** What this folder needs: { hasGit, isRepo, hasCommit }. */
export function ground(dir) {
  const hasGit = tryGit(dir, '--version') !== null;
  const top = hasGit ? tryGit(dir, 'rev-parse', '--show-toplevel') : null;
  return { hasGit, isRepo: !!top, hasCommit: !!top && tryGit(dir, 'rev-parse', '--verify', '-q', 'HEAD') !== null };
}

/** Files a first commit would take, and the ones to stop for. Needs a repo (after git init). */
export function review(dir) {
  const files = git(dir, 'ls-files', '--others', '--cached', '--exclude-standard').split('\n').filter(Boolean);
  const secrets = files.filter(f => SECRET.test(f));
  const big = files.filter(f => { try { return statSync(join(dir, f)).size > BIG; } catch { return false; } });
  return { files, secrets, big };
}

/** Do it. Returns lines for the human. Throws with a plain message when it must stop. */
export function init(dir, { dry = false } = {}) {
  const g = ground(dir);
  if (!g.hasGit) throw new Error('git is not installed. Install it from https://git-scm.com/downloads and run this again.');
  const out = [];
  if (g.hasCommit) return ['already a git repo with commits — nothing to do'];
  if (!g.isRepo) {
    out.push('git init');
    if (!dry) git(dir, 'init', '-q', '-b', 'main');
  }
  const gi = join(dir, '.gitignore');
  if (!existsSync(gi)) {
    out.push(`.gitignore: ${IGNORE.join(' ')}`);
    if (!dry) writeFileSync(gi, '# added by agentsemble — edit freely\n' + IGNORE.join('\n') + '\n');
  }
  if (dry && !g.isRepo) { out.push('(dry run: file review happens after git init)'); return out; }
  const r = review(dir);
  if (r.secrets.length || r.big.length) {
    throw new Error('stopped before the first commit. These should probably not go into git:\n'
      + r.secrets.map(f => `  secret? ${f}`).concat(r.big.map(f => `  over 50 MB: ${f}`)).join('\n')
      + '\nAdd them to .gitignore (or move them out), then run this again.');
  }
  out.push(`first commit: ${r.files.length} file(s)`);
  if (dry) return out;
  // A person who never used git has no name set; commit as this machine's user, in this repo only.
  if (!tryGit(dir, 'config', 'user.name')) {
    const who = userInfo().username || 'me';
    git(dir, 'config', 'user.name', who);
    git(dir, 'config', 'user.email', `${who}@localhost`);
    out.push(`git identity for this repo only: ${who} <${who}@localhost> (change with git config user.name / user.email)`);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'initial commit');
  return out;
}

if (isMain(import.meta.url)) {
  try { for (const l of init(process.cwd(), { dry: process.argv.includes('--dry-run') })) console.log(l); }
  catch (e) { console.error(e.message); process.exit(1); }
}

export function selftest(ok) {
  const t = mkdtempSync(join(tmpdir(), 'as-init-'));
  const env = { ...process.env };
  try {
    const a = join(t, 'plain'); mkdirSync(a);
    writeFileSync(join(a, 'index.js'), 'x');
    mkdirSync(join(a, 'node_modules', 'dep'), { recursive: true }); writeFileSync(join(a, 'node_modules', 'dep', 'i.js'), 'y');
    ok('a plain folder is not a repo', !ground(a).isRepo);
    ok('dry run changes nothing', init(a, { dry: true }).includes('git init') && !existsSync(join(a, '.git')));
    const out = init(a);
    ok('inits, ignores, commits', ground(a).hasCommit && out.some(l => l.startsWith('first commit')));
    ok('node_modules stays out of the first commit', !git(a, 'ls-files').includes('node_modules'));
    ok('second run does nothing', init(a)[0].startsWith('already'));

    const b = join(t, 'leaky'); mkdirSync(b);
    writeFileSync(join(b, 'app.js'), 'x'); writeFileSync(join(b, 'server.pem'), 'k');
    let msg = '';
    try { init(b); } catch (e) { msg = e.message; }
    ok('stops on a secret-looking file and names it', /server\.pem/.test(msg) && !ground(b).hasCommit);
    writeFileSync(join(b, '.gitignore'), '*.pem\n');
    ok('commits once it is ignored', init(b) && ground(b).hasCommit && !git(b, 'ls-files').includes('server.pem'));

    const c = join(t, 'fresh'); mkdirSync(c); git(c, 'init', '-q', '-b', 'main');
    writeFileSync(join(c, '.gitignore'), 'custom\n'); writeFileSync(join(c, 'a.txt'), 'a');
    init(c);
    ok('a repo with no commit gets one, own .gitignore kept', ground(c).hasCommit && readFileSync(join(c, '.gitignore'), 'utf8') === 'custom\n');
    ok('folder name is untouched', basename(c) === 'fresh');
  } finally { process.env = env; rmSync(t, { recursive: true, force: true }); }
}
