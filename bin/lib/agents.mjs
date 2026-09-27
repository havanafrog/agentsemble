// agents.json: the team plan. Committed with the code so the team has history too.
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';

export const AGENTS_FILE = 'agents.json';

export function loadAgents(repoRoot) {
  const root = resolve(repoRoot);
  const f = join(root, AGENTS_FILE);
  if (!existsSync(f)) throw new Error(`${AGENTS_FILE} not found in ${root} — run /agentsemble first`);
  let raw;
  try { raw = JSON.parse(readFileSync(f, 'utf8')); }
  catch (e) { throw new Error(`${AGENTS_FILE} is not valid JSON: ${e.message}`); }
  const parent = dirname(root);
  const roles = [];
  for (const [name, a] of Object.entries(raw)) {
    if (name.startsWith('$') || name === 'wishlist') continue;
    if (!a || typeof a.dir !== 'string') throw new Error(`role "${name}" needs a "dir"`);
    const dir = resolve(root, a.dir);
    const isMain = dir === root;
    // Sub roles live beside the repo (same parent folder) — never somewhere else on disk.
    if (!isMain && dirname(dir) !== parent) {
      throw new Error(`role "${name}": dir must be next to the repo (like ../<name>), got ${a.dir}`);
    }
    if (!isMain && !a.branch) throw new Error(`role "${name}" needs a "branch"`);
    roles.push({ name, dir, relDir: a.dir, branch: a.branch ?? null, what: a.what ?? '', not: a.not ?? '',
      owns: a.owns ?? [], skills: a.skills ?? [], plugins: a.plugins ?? {}, isMain });
  }
  const mains = roles.filter(r => r.isMain);
  if (mains.length !== 1) throw new Error(`${AGENTS_FILE} needs exactly one main role (dir ".") — found ${mains.length}`);
  return { roles, wishlist: Array.isArray(raw.wishlist) ? raw.wishlist : [] };
}

export function selftest(ok) {
  const t = mkdtempSync(join(tmpdir(), 'as-agents-'));
  const repo = join(t, 'my app');            // space on purpose
  mkdirSync(repo);
  const put = o => writeFileSync(join(repo, AGENTS_FILE), JSON.stringify(o));
  const threw = f => { try { f(); return null; } catch (e) { return e.message; } };
  try {
    put({ main: { dir: '.', what: 'brain' }, ui: { dir: '../my app-ui', branch: 'agent/ui', skills: ['taste'] },
          wishlist: ['browser skill'] });
    const a = loadAgents(repo);
    ok('main resolves to the repo', a.roles.find(r => r.isMain).dir === resolve(repo));
    ok('sibling dir resolves next to repo', a.roles.find(r => r.name === 'ui').dir === join(t, 'my app-ui'));
    ok('defaults fill in', typeof a.roles.find(r => r.name === 'ui').plugins === 'object' && Array.isArray(a.roles[0].owns));
    ok('wishlist kept', a.wishlist[0] === 'browser skill');
    put({ ui: { dir: '../x', branch: 'b' } });
    ok('needs exactly one main', /main/.test(threw(() => loadAgents(repo)) ?? ''));
    put({ main: { dir: '.' }, ui: { dir: '../x' } });
    ok('sub role needs a branch', /branch/.test(threw(() => loadAgents(repo)) ?? ''));
    put({ main: { dir: '.' }, ui: { dir: '../../../etc', branch: 'b' } });
    ok('dir must stay next to the repo', /next to/.test(threw(() => loadAgents(repo)) ?? ''));
    writeFileSync(join(repo, AGENTS_FILE), '{ nope');
    ok('broken json says so', /agents\.json/.test(threw(() => loadAgents(repo)) ?? ''));
    rmSync(join(repo, AGENTS_FILE));
    ok('missing file says so', /not found/.test(threw(() => loadAgents(repo)) ?? ''));
  } finally { rmSync(t, { recursive: true, force: true }); }
}
