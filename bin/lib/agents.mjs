// agents.json: the team plan. Committed with the code so the team has history too.
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';

export const AGENTS_FILE = 'agents.json';
const SKILL = /^[\w.-]+$/;
// A conservative subset of git's ref rules: path segments of word chars, dot, dash; no leading dash.
const REF = /^(?!-)[\w.-]+(\/[\w.-]+)*$/;
// An alias (opus, sonnet, haiku) or a model id, optionally with a [1m]-style suffix.
const MODEL = /^[\w.-]+(\[\w+\])?$/;
/** How far a role goes before checking in:
 *   ask   — send main a plan and wait before changing code
 *   build — change, test and commit on its own branch, then report (default)
 *   run   — keep going through fix/test loops without check-ins; report once at the end */
export const AUTONOMY = ['ask', 'build', 'run'];

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
    // Sub roles live beside the repo, or together in ../<repo>-team/ — never somewhere else on disk.
    const inTeam = dirname(dir) === join(parent, basename(root) + '-team');
    if (!isMain && dirname(dir) !== parent && !inTeam) {
      throw new Error(`role "${name}": dir must be next to the repo (like ../<name>), got ${a.dir}`);
    }
    if (!isMain && !a.branch) throw new Error(`role "${name}" needs a "branch"`);
    // agents.json is committed, so a cloned repo can hand us any value: check shapes before any disk work.
    if (a.branch != null && (typeof a.branch !== 'string' || !REF.test(a.branch) || a.branch.includes('..'))) {
      throw new Error(`role "${name}": branch "${a.branch}" is not a valid branch name`);
    }
    if (a.skills != null && (!Array.isArray(a.skills) || a.skills.some(s => typeof s !== 'string'))) {
      throw new Error(`role "${name}": skills must be a list of names`);
    }
    const badSkill = (a.skills ?? []).find(s => !SKILL.test(s) || s.includes('..'));
    if (badSkill !== undefined) throw new Error(`role "${name}": skill name "${badSkill}" may only use letters, digits, - _ .`);
    if (a.plugins != null && (typeof a.plugins !== 'object' || Array.isArray(a.plugins)
        || Object.values(a.plugins).some(v => typeof v !== 'boolean'))) {
      throw new Error(`role "${name}": plugins must be an object of name → true/false`);
    }
    if (a.model != null && (typeof a.model !== 'string' || !MODEL.test(a.model))) {
      throw new Error(`role "${name}": model "${a.model}" should be a name like opus, sonnet, haiku or claude-sonnet-5`);
    }
    if (a.autonomy != null && !AUTONOMY.includes(a.autonomy)) {
      throw new Error(`role "${name}": autonomy must be one of ${AUTONOMY.join(', ')}`);
    }
    const twin = roles.find(r => r.dir === dir);
    if (twin) throw new Error(`roles "${twin.name}" and "${name}" use the same dir ${a.dir}`);
    roles.push({ name, dir, relDir: a.dir, branch: a.branch ?? null, what: a.what ?? '', not: a.not ?? '',
      owns: a.owns ?? [], skills: a.skills ?? [], plugins: a.plugins ?? {}, isMain,
      model: a.model ?? null, autonomy: a.autonomy ?? 'build' });
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
    put({ main: { dir: '.' }, ui: { dir: '../my app-team/ui', branch: 'b' } });
    ok('team folder ../<repo>-team/<role> is allowed', threw(() => loadAgents(repo)) === null
       && loadAgents(repo).roles.find(r => r.name === 'ui').dir === join(t, 'my app-team', 'ui'));
    put({ main: { dir: '.', model: 'opus' }, ui: { dir: '../x', branch: 'b', model: 'sonnet', autonomy: 'ask' } });
    const ma = loadAgents(repo).roles;
    ok('model and autonomy are read', ma[0].model === 'opus' && ma[1].model === 'sonnet' && ma[1].autonomy === 'ask');
    ok('autonomy defaults to build, model to none', (put({ main: { dir: '.' } }), loadAgents(repo).roles[0].autonomy === 'build' && loadAgents(repo).roles[0].model === null));
    put({ main: { dir: '.', autonomy: 'yolo' } });
    ok('unknown autonomy is refused', /autonomy/.test(threw(() => loadAgents(repo)) ?? ''));
    put({ main: { dir: '.', model: 'opus; rm -rf' } });
    ok('odd model names are refused', /model/.test(threw(() => loadAgents(repo)) ?? ''));
    put({ main: { dir: '.' }, ui: { dir: '../other-team/ui', branch: 'b' } });
    ok("another repo's team folder is refused", /next to/.test(threw(() => loadAgents(repo)) ?? ''));
    writeFileSync(join(repo, AGENTS_FILE), '{ nope');
    ok('broken json says so', /agents\.json/.test(threw(() => loadAgents(repo)) ?? ''));
    put({ main: { dir: '.' }, ui: { dir: '../x', branch: 'b', skills: ['../../../escape'] } });
    ok('skill names cannot climb out', /skill name/.test(threw(() => loadAgents(repo)) ?? ''));
    put({ main: { dir: '.' }, ui: { dir: '../x', branch: 'b', skills: 'taste' } });
    ok('skills must be a list', /skills/.test(threw(() => loadAgents(repo)) ?? ''));
    put({ main: { dir: '.' }, ui: { dir: '../x', branch: 'b', plugins: ['p'] } });
    ok('plugins must be an object', /plugins/.test(threw(() => loadAgents(repo)) ?? ''));
    put({ main: { dir: '.' }, ui: { dir: '../x', branch: 'bad..branch' } });
    ok('branch must be a valid ref', /branch/.test(threw(() => loadAgents(repo)) ?? ''));
    put({ main: { dir: '.' }, a: { dir: '../x', branch: 'a' }, b: { dir: '../x', branch: 'b' } });
    ok('two roles cannot share a dir', /same dir/.test(threw(() => loadAgents(repo)) ?? ''));
    rmSync(join(repo, AGENTS_FILE));
    ok('missing file says so', /not found/.test(threw(() => loadAgents(repo)) ?? ''));
  } finally { rmSync(t, { recursive: true, force: true }); }
}
