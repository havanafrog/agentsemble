# agentsemble 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 저장소를 읽고 Claude Code 창들을 역할별 팀으로 모으고(작업칸·스킬·플러그인), 한 로컬 판에서 지켜보는 Claude Code 플러그인을 만든다.

**Architecture:** 판단은 스킬(SKILL.md)이 Claude 에게 맡기고, 스크립트는 실행만 한다. 모든 스크립트는 외부 패키지 없는 Node ESM 이고, 공용 규칙(경로·역할표·도구 비교)은 `bin/lib/` 한 곳에 둔다. 판은 `node bin/board.mjs` 하나로 뜨는 읽기 전용 HTTP 서버다.

**Tech Stack:** Node 20+ (ESM, node:test 안 씀 — 원형처럼 `--selftest`), git worktree, Claude Code 플러그인 형식(`.claude-plugin/`).

**Spec:** `docs/specs/2026-09-26-agentsemble-design.md`

**원형(가져올 코드):** `github.com/havanafrog/stock-sentiment (local checkout)/` 의
`tools/agent-setup.mjs`, `ops/board.mjs`, `ops/board.html`, `ops/ledger.mjs`, `ops/cost.mjs`,
`ops/handoff.mjs`, `ops/whoasked.mjs`, `.claude/skills/ops/SKILL.md`. 아래에서 "원형" 은 이 폴더다.

## Global Constraints

- Node 20 이상. `package.json` 에 dependencies 없음. `node:` 내장 모듈만.
- Windows · macOS · Linux 에서 돈다. 경로는 `node:path` 로만 잇는다.
- 판 기본 주소 `127.0.0.1:8740`. `--host` 로 바꾸면 경고를 찍는다.
- 판은 어떤 파일도 쓰지 않는다(읽기 전용).
- `setup.mjs` 는 `settings.local.json` 에서 `enabledPlugins` 밖의 칸을 건드리지 않는다.
- 스킬·플러그인을 설치하지 않는다. 없는 건 `wishlist` 에 적고 알리기만 한다.
- 과제 이름·경로를 코드에 적지 않는다. 모두 `agents.json` 에서 읽는다.
- 모든 실행 파일에 `--selftest` 가 있고, 임시 폴더만 쓰고 지운다.
- 커밋 메시지에 Co-Authored-By 꼬리줄을 달지 않는다.
- 사용자 문서: `README.md`(영어) + `README.ko.md`. 코드 주석은 영어(공개 저장소).

## Review Focus

1. **경로에 빈칸·한글·점이 있는 저장소** (`C:\M\8. 주식감성\app`) — 기록 폴더 이름 규칙과 작업칸 경로가 깨지지 않아야 한다. → Task 1 점검.
2. **`agents.json` 이 깨졌거나 역할 `dir` 이 저장소 밖 엉뚱한 곳(`../../..`)을 가리킴** — setup 은 알아듣게 거절하고 아무것도 만들지 않아야 한다. → Task 2 점검.
3. **이미 있는 작업칸·브랜치에 setup 을 다시 돌림** — 새로 만들지 않고 도구만 다시 걸어야 한다(두 번 돌려도 같은 결과). → Task 3 점검.
4. **작업칸 `.claude` 가 없거나 못 읽음 / 기록 폴더가 아직 없음** (창을 아직 안 연 역할) — 판이 죽지 않고 그 역할을 "계획만" 으로 보여야 한다(원형 판이 `/logs-auto` 없어서 죽은 사고). → Task 4·7 점검.
5. **기록 jsonl 에 반쯤 쓰인 줄 / 수십 MB 파일** — 판은 깨진 줄을 건너뛰고 끝부분만 읽어야 한다. → Task 6·7 점검.

---

## File Structure

```
.claude-plugin/plugin.json          플러그인 이름·버전·설명
.claude-plugin/marketplace.json     한 줄 설치용 마켓 목록
agents.schema.json                  agents.json 스키마 (편집기 도움)
skills/agentsemble/SKILL.md         /agentsemble 흐름 (파악→설계→구성→안내→운영)
skills/ops/SKILL.md                 만드는 쪽·재는 쪽 장부 규칙
hooks/hooks.json                    선택 훅 (기본 꺼짐 — README 로 켠다)
bin/lib/paths.mjs                   projectSlug · leaf · claudeHome
bin/lib/agents.mjs                  agents.json 읽기·검증·경로 풀기
bin/lib/kit.mjs                     작업칸 실제 도구 읽기 + 계획과 비교
bin/setup.mjs                       작업칸 만들기·도구 걸기
bin/status.mjs                      계획 대 실제 표 (터미널)
bin/ledger.mjs                      장부
bin/cost.mjs                        기록 → 토큰·환산 금액
bin/board.mjs                       판 서버
bin/board.html                      판 화면
bin/handoff.mjs · bin/whoasked.mjs  선택 훅
test/run.mjs                        모든 --selftest 를 돌리는 한 줄 러너
.github/workflows/ci.yml            3 OS × Node 20·22
README.md · README.ko.md · LICENSE
```

---

### Task 1: 뼈대 · 경로 규칙 · CI

**Files:**
- Create: `package.json`, `LICENSE`, `.gitignore`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `bin/lib/paths.mjs`, `test/run.mjs`, `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `projectSlug(absPath: string): string`, `leaf(p: string): string|null`, `claudeHome(): string`, `selftest(): number` (각 lib 파일도 같은 모양의 `selftest` export)

- [ ] **Step 1: 뼈대 파일**

`package.json`
```json
{
  "name": "agentsemble",
  "version": "0.1.0",
  "description": "Read your repo, assemble a team of Claude Code sessions, and watch them work from one local dashboard.",
  "type": "module",
  "license": "MIT",
  "engines": { "node": ">=20" },
  "scripts": { "test": "node test/run.mjs" }
}
```

`.claude-plugin/plugin.json`
```json
{
  "name": "agentsemble",
  "version": "0.1.0",
  "description": "Read your repo, assemble a team of Claude Code sessions, and watch them work from one local dashboard.",
  "author": { "name": "havanafrog" },
  "homepage": "https://github.com/havanafrog/agentsemble",
  "license": "MIT"
}
```

`.claude-plugin/marketplace.json`
```json
{
  "name": "agentsemble",
  "owner": { "name": "havanafrog" },
  "plugins": [{ "name": "agentsemble", "source": "./", "description": "Assemble and watch a team of Claude Code sessions." }]
}
```

`.gitignore`
```
node_modules/
.claude/settings.local.json
.claude/skills/*
ops/ledger.jsonl
```

`LICENSE`: MIT, `Copyright (c) 2026 havanafrog`.

- [ ] **Step 2: 실패하는 점검부터 — `bin/lib/paths.mjs`**

```js
// Path rules shared by setup, status and board.
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Claude Code's session-log folder name for a working directory:
 *  every char that is not [A-Za-z0-9] becomes '-'. C:\a\b -> C--a-b */
export function projectSlug(abs) {
  return String(abs).replace(/[^A-Za-z0-9]/g, '-');
}

/** Last path segment, either separator. */
export const leaf = p => String(p ?? '').split(/[\\/]/).filter(Boolean).pop() ?? null;

export const claudeHome = () => process.env.CLAUDE_HOME ?? join(homedir(), '.claude');

export function selftest(ok) {
  ok('windows path', projectSlug('C:\\Users\\a\\b') === 'C--Users-a-b');
  ok('posix path', projectSlug('/home/a/b') === '-home-a-b');
  ok('dot, space, hangul become -', projectSlug('C:\\M\\8. 주식감성\\s-s') === 'C--M-8-------s-s',
     projectSlug('C:\\M\\8. 주식감성\\s-s'));
  ok('leaf of either separator', leaf('C:\\a\\b') === 'b' && leaf('/a/b/') === 'b' && leaf('') === null);
}
```

`test/run.mjs`
```js
// Runs every module's selftest. Exit 1 on the first failure.
const mods = ['../bin/lib/paths.mjs'];
let n = 0;
const ok = (label, cond, extra = '') => {
  if (!cond) { console.error(`  FAIL  ${label}  ${extra}`); process.exit(1); }
  n++; console.log(`  PASS  ${label}`);
};
for (const m of mods) { console.log(`\n${m}`); await (await import(m)).selftest(ok); }
console.log(`\n${n} passed`);
```

(Task 2 이후로 `mods` 배열에 새 모듈을 한 줄씩 더한다.)

- [ ] **Step 3: 돌려서 통과 확인**

Run: `node test/run.mjs`
Expected: `4 passed`. 한 줄을 일부러 틀리게(`'C--M-8------s-s'`) 바꿔 FAIL 이 나는지 보고 되돌린다.

- [ ] **Step 4: CI**

`.github/workflows/ci.yml`
```yaml
name: ci
on: [push, pull_request]
jobs:
  test:
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        node: [20, 22]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '${{ matrix.node }}' }
      - run: git config --global user.email ci@example.com && git config --global user.name ci
      - run: node test/run.mjs
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: skeleton, path rules, test runner, CI"
```

---

### Task 2: 역할표 `agents.json` 읽기·검증

**Files:**
- Create: `bin/lib/agents.mjs`, `agents.schema.json`
- Modify: `test/run.mjs` (mods 에 `'../bin/lib/agents.mjs'`)

**Interfaces:**
- Consumes: 없음
- Produces:
  - `loadAgents(repoRoot: string): { roles: Role[], wishlist: string[] }` — 문제가 있으면 `Error` 를 던진다(메시지는 사람이 읽는 한 줄)
  - `Role = { name: string, dir: string /*abs*/, relDir: string, branch: string|null, what: string, not: string, owns: string[], skills: string[], plugins: Record<string, boolean>, isMain: boolean }`
  - `AGENTS_FILE = 'agents.json'`

- [ ] **Step 1: 점검을 먼저 쓴다 (`agents.mjs` 끝의 `selftest`)**

```js
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
    ok('main resolves to the repo', a.roles.find(r => r.isMain).dir === repo);
    ok('sibling dir resolves next to repo', a.roles.find(r => r.name === 'ui').dir === join(t, 'my app-ui'));
    ok('defaults fill in', a.roles.find(r => r.name === 'ui').plugins && Array.isArray(a.roles[0].owns));
    ok('wishlist kept', a.wishlist[0] === 'browser skill');
    put({ ui: { dir: '../x', branch: 'b' } });
    ok('needs exactly one main', /main/.test(threw(() => loadAgents(repo))));
    put({ main: { dir: '.' }, ui: { dir: '../x' } });
    ok('sub role needs a branch', /branch/.test(threw(() => loadAgents(repo))));
    put({ main: { dir: '.' }, ui: { dir: '../../../etc', branch: 'b' } });
    ok('dir must stay next to the repo', /next to/.test(threw(() => loadAgents(repo))));
    writeFileSync(join(repo, AGENTS_FILE), '{ nope');
    ok('broken json says so', /agents\.json/.test(threw(() => loadAgents(repo))));
    rmSync(join(repo, AGENTS_FILE));
    ok('missing file says so', /not found/.test(threw(() => loadAgents(repo))));
  } finally { rmSync(t, { recursive: true, force: true }); }
}
```

- [ ] **Step 2: 돌려서 실패 확인**

Run: `node test/run.mjs`
Expected: FAIL — `loadAgents is not defined` (또는 import 오류)

- [ ] **Step 3: 구현**

```js
// agents.json: the team plan. Committed with the code so the team has history too.
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';

export const AGENTS_FILE = 'agents.json';

export function loadAgents(repoRoot) {
  const f = join(repoRoot, AGENTS_FILE);
  if (!existsSync(f)) throw new Error(`${AGENTS_FILE} not found in ${repoRoot} — run /agentsemble first`);
  let raw;
  try { raw = JSON.parse(readFileSync(f, 'utf8')); }
  catch (e) { throw new Error(`${AGENTS_FILE} is not valid JSON: ${e.message}`); }
  const parent = dirname(resolve(repoRoot));
  const roles = [];
  for (const [name, a] of Object.entries(raw)) {
    if (name.startsWith('$') || name === 'wishlist') continue;
    if (!a || typeof a.dir !== 'string') throw new Error(`role "${name}" needs a "dir"`);
    const dir = resolve(repoRoot, a.dir);
    const isMain = dir === resolve(repoRoot);
    // Sub roles live beside the repo (same parent folder) — never somewhere else on disk.
    if (!isMain && (dirname(dir) !== parent || isAbsolute(relative(parent, dir)))) {
      throw new Error(`role "${name}": dir must be next to the repo (like ../${a.dir.split(/[\\/]/).pop()}), got ${a.dir}`);
    }
    if (!isMain && !a.branch) throw new Error(`role "${name}" needs a "branch"`);
    roles.push({ name, dir, relDir: a.dir, branch: a.branch ?? null, what: a.what ?? '', not: a.not ?? '',
      owns: a.owns ?? [], skills: a.skills ?? [], plugins: a.plugins ?? {}, isMain });
  }
  const mains = roles.filter(r => r.isMain);
  if (mains.length !== 1) throw new Error(`${AGENTS_FILE} needs exactly one main role (dir ".") — found ${mains.length}`);
  return { roles, wishlist: Array.isArray(raw.wishlist) ? raw.wishlist : [] };
}
```

`agents.schema.json`: 위 필드(`dir` 필수, `branch`·`what`·`not`·`owns`·`skills`·`plugins`, 최상위 `wishlist`)를 JSON Schema draft-07 로 적는다. `additionalProperties` 는 역할 객체 안에서 `false`.

- [ ] **Step 4: 돌려서 통과**

Run: `node test/run.mjs` → Expected: `13 passed`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: load and validate agents.json"
```

---

### Task 3: `setup.mjs` — 작업칸 만들기와 도구 걸기

**Files:**
- Create: `bin/setup.mjs`
- Modify: `test/run.mjs` (mods 에 `'../bin/setup.mjs'`)
- 원형: `tools/agent-setup.mjs` 의 `apply()` 와 `selftest()`

**Interfaces:**
- Consumes: `loadAgents`, `Role` (Task 2)
- Produces:
  - `applyRole(role: Role, { stores: string[], shared: string[] }): string[]` — 사람이 읽는 결과 줄 (`+ taste`, `- old`, `! missing (looked in …)`, `plugins …`)
  - `ensureWorktree(repoRoot: string, role: Role): 'exists'|'created'`
  - `ensureGitignore(dir: string): boolean` (더했으면 true)
  - `sharedSkills(repoRoot: string): string[]` — `git ls-files .claude/skills` 로 추적되는 스킬 이름
  - `skillStores(): string[]` — `[~/.claude/skill-store, ~/.claude/skills]`
  - CLI: `node bin/setup.mjs <role>|--all [--dry-run]` (repo 는 `process.cwd()` 의 git 최상위)

- [ ] **Step 1: 점검을 먼저 쓴다**

원형 `selftest()` 의 일곱 점검을 영어 이름으로 옮기고, 아래를 더한다. 가짜 저장소는 `git init` 으로 만든다:

```js
export function selftest(ok) {
  const t = mkdtempSync(join(tmpdir(), 'as-setup-'));
  const repo = join(t, 'app'), store = join(t, 'store');
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
  try {
    mkdirSync(repo); git('init', '-q', '-b', 'main');
    writeFileSync(join(repo, 'a.txt'), 'x'); git('add', '.'); git('commit', '-qm', 'init');
    for (const s of ['taste', 'lexicon']) { mkdirSync(join(store, s), { recursive: true }); writeFileSync(join(store, s, 'SKILL.md'), s); }
    writeFileSync(join(repo, 'agents.json'), JSON.stringify({
      main: { dir: '.' }, ui: { dir: '../app-ui', branch: 'agent/ui', skills: ['taste', 'ghost'],
      plugins: { 'p@m': true, 'q@m': false } } }));
    const { roles } = loadAgents(repo), ui = roles.find(r => r.name === 'ui');
    ok('creates the worktree', ensureWorktree(repo, ui) === 'created' && existsSync(join(t, 'app-ui', 'a.txt')));
    ok('second run does not recreate', ensureWorktree(repo, ui) === 'exists');
    mkdirSync(join(ui.dir, '.claude'), { recursive: true });
    writeFileSync(join(ui.dir, '.claude', 'settings.local.json'),
      JSON.stringify({ permissions: { allow: ['Read(x)'] }, enabledPlugins: { 'other@x': true } }));
    const out1 = applyRole(ui, { stores: [store], shared: [] });
    const s1 = JSON.parse(readFileSync(join(ui.dir, '.claude', 'settings.local.json'), 'utf8'));
    ok('copies role skills', existsSync(join(ui.dir, '.claude', 'skills', 'taste', 'SKILL.md')));
    ok('reports missing skill with where it looked', out1.some(l => l.startsWith('! ghost') && l.includes(store)));
    ok('leaves other settings alone', s1.permissions.allow[0] === 'Read(x)' && s1.enabledPlugins['other@x'] === true);
    ok('sets role plugins', s1.enabledPlugins['p@m'] === true && s1.enabledPlugins['q@m'] === false);
    const out2 = applyRole(ui, { stores: [store], shared: [] });
    ok('idempotent', JSON.stringify(out2.filter(l => !l.startsWith('!'))) === JSON.stringify(out1.filter(l => !l.startsWith('!'))));
    mkdirSync(join(ui.dir, '.claude', 'skills', 'stale'), { recursive: true });
    mkdirSync(join(ui.dir, '.claude', 'skills', 'repo-skill'), { recursive: true });
    const out3 = applyRole(ui, { stores: [store], shared: ['repo-skill'] });
    ok('removes skills of other roles', !existsSync(join(ui.dir, '.claude', 'skills', 'stale')) && out3.includes('- stale'));
    ok('keeps repo-tracked skills', existsSync(join(ui.dir, '.claude', 'skills', 'repo-skill')));
    ok('adds gitignore lines once', ensureGitignore(repo) === true && ensureGitignore(repo) === false);
  } finally { rmSync(t, { recursive: true, force: true }); }
}
```

- [ ] **Step 2: 돌려서 실패 확인** — Run: `node test/run.mjs` → FAIL (`ensureWorktree is not defined`)

- [ ] **Step 3: 구현**

원형 `apply()` 를 옮기되 다음을 바꾼다:
- 역할을 이름이 아니라 `Role` 로 받는다. 경로는 `role.dir`.
- 스킬 원본은 `stores` 배열을 앞에서부터 찾는다. 없으면 `! ${s} not found (looked in ${stores.join(', ')})`.
- 걷어 내지 않을 스킬은 `SHARED` 상수 대신 `shared` 인자.

```js
export function ensureWorktree(repoRoot, role) {
  if (role.isMain || existsSync(role.dir)) return 'exists';
  const has = execFileSync('git', ['-C', repoRoot, 'branch', '--list', role.branch], { encoding: 'utf8' }).trim();
  execFileSync('git', ['-C', repoRoot, 'worktree', 'add', role.dir, ...(has ? [role.branch] : ['-b', role.branch])],
    { stdio: 'pipe' });
  return 'created';
}

const IGNORE = ['.claude/settings.local.json', '.claude/skills/*'];
export function ensureGitignore(dir) {
  const f = join(dir, '.gitignore');
  const cur = existsSync(f) ? readFileSync(f, 'utf8') : '';
  const lines = cur.split(/\r?\n/);
  const add = IGNORE.filter(l => !lines.includes(l));
  if (!add.length) return false;
  writeFileSync(f, cur + (cur && !cur.endsWith('\n') ? '\n' : '') + '# agentsemble\n' + add.join('\n') + '\n');
  return true;
}

export function sharedSkills(repoRoot) {
  const out = execFileSync('git', ['-C', repoRoot, 'ls-files', '.claude/skills'], { encoding: 'utf8' });
  return [...new Set(out.split('\n').filter(Boolean).map(p => p.split('/')[2]).filter(Boolean))];
}

export const skillStores = () => [join(claudeHome(), 'skill-store'), join(claudeHome(), 'skills')];
```

CLI (`main(argv)`): 저장소 = `git rev-parse --show-toplevel`. `--all` 이면 역할 전부, 아니면 이름 하나. `--dry-run` 이면 `ensureWorktree`/`applyRole` 대신 할 일만 찍는다. 역할마다:
```
ui → C:\...\app-ui  (created)
  + taste
  ! ghost not found (looked in ...)
  plugins p q(-)
  open it:  cd "C:\...\app-ui" && claude    then  /rename ui
```
마지막에 `ensureGitignore(repo)` 결과 한 줄.

- [ ] **Step 4: 돌려서 통과** — Run: `node test/run.mjs` → `24 passed`

- [ ] **Step 5: Commit** — `git commit -am "feat: setup creates worktrees and applies role tools"`

---

### Task 4: 계획 대 실제 — `kit.mjs` 와 `status.mjs`

**Files:**
- Create: `bin/lib/kit.mjs`, `bin/status.mjs`
- Modify: `test/run.mjs`
- 원형: `ops/board.mjs` 의 `installed()` · `toolsOf()` (2026-09-26 판, 점검 8개 포함)

**Interfaces:**
- Consumes: `Role` (Task 2), `sharedSkills` (Task 3)
- Produces:
  - `kitOf(role: Role, declared: Set<string>): { skills: Item[], plugins: Item[], shared: string[] }`
  - `Item = { name: string, st: 'ok'|'miss'|'extra'|'plan' }`
  - CLI `node bin/status.mjs` — 역할마다 한 줄 요약 + 어긋난 항목. 어긋남이 있으면 exit 1.

- [ ] **Step 1: 점검** — 원형 `selftest` 의 "가짜 작업칸 두 개" 블록 8개 점검을 `kitOf` 모양으로 옮긴다(`toolsOf('x', aj, t)` → `kitOf(role, declared)`, 역할은 `loadAgents` 로 만든 것). 하나 더:

```js
ok('unreadable .claude means plan, not a crash',
   kitOf({ ...sub, dir: join(t, 'does-not-exist') }, declared).skills.every(s => s.st === 'plan'));
```

- [ ] **Step 2: 실패 확인** — `node test/run.mjs` → FAIL

- [ ] **Step 3: 구현** — 원형 `installed()` 는 그대로, `toolsOf()` 의 본문(역할 찾기 제외)을 `kitOf(role, declared)` 로 옮긴다. `declared` = 모든 역할의 skills 합집합(부르는 쪽이 만든다).

`status.mjs`:
```js
const { roles } = loadAgents(repo);
const declared = new Set(roles.flatMap(r => r.skills));
let bad = 0;
for (const r of roles) {
  const k = kitOf(r, declared);
  const off = [...k.skills, ...k.plugins].filter(i => i.st === 'miss' || i.st === 'extra');
  bad += off.length;
  console.log(`${r.name.padEnd(8)} ${off.length ? off.map(i => (i.st === 'miss' ? 'missing ' : 'extra ') + i.name).join(', ') : 'ok'}`
    + (k.skills.some(i => i.st === 'plan') ? '  (not set up yet)' : ''));
}
process.exit(bad ? 1 : 0);
```

- [ ] **Step 4: 통과** — `node test/run.mjs` → `33 passed`

- [ ] **Step 5: Commit** — `git commit -am "feat: compare planned and installed tools per role"`

---

### Task 5: 장부와 `ops` 스킬

**Files:**
- Create: `bin/ledger.mjs`, `skills/ops/SKILL.md`
- Modify: `test/run.mjs`
- 원형: `ops/ledger.mjs`, `.claude/skills/ops/SKILL.md`

**Interfaces:**
- Produces: `read(file?): Row[]`, `open(rows): Claim[]`, `ledgerGroups(rows): { claims: Group[], notes: Group[] }`, `LEDGER = process.env.OPS_LEDGER ?? join(repoRoot, 'ops', 'ledger.jsonl')`
- CLI: `claim "<what>" --how "<cmd>" [--why] [--files]`, `verdict <id> 확인|반박|보류 "<why>" [--evidence]`, `note "<text>" [--by]`, `open`

- [ ] **Step 1: 점검** — 원형 `ledger.mjs` 의 selftest 를 그대로 옮기고, 원형 `board.mjs` 의 `ledgerGroups` 점검 3개(끝난 일 · 번호 메모 · 앞머리 묶음)를 더한다. 하나 더:

```js
ok('half-written last line is skipped', read(fileWith('{"kind":"claim","id":"C1"}\n{"kind":"ver')).length === 1);
```

- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현** — 원형 코드를 옮기고 `ledgerGroups` 를 이 파일로 가져온다. 판정 값은 영어 별칭도 받는다: `confirm|refute|hold` → `확인|반박|보류` 로 저장. 파일 경로는 `LEDGER`.
  `skills/ops/SKILL.md`: 원형을 옮기되 명령을 `node "${CLAUDE_PLUGIN_ROOT}/bin/ledger.mjs"` 로 바꾸고, 본문을 영어로(한국어판은 README.ko 에 요약). 과제 이름·예시 숫자(56.3% 등)는 일반 예로 바꾼다.
- [ ] **Step 4: 통과** — `node test/run.mjs`
- [ ] **Step 5: Commit** — `git commit -am "feat: builder/verifier ledger and ops skill"`

---

### Task 6: 비용 — `cost.mjs`

**Files:**
- Create: `bin/cost.mjs`
- Modify: `test/run.mjs`
- 원형: `ops/cost.mjs`

**Interfaces:**
- Produces: `tally(file: string): { in: number, out: number, cacheRead: number, cacheWrite: number, usd: number }` — 늘어난 부분만 읽는 기억(파일별 offset) 유지

- [ ] **Step 1: 점검** — 원형 selftest 를 옮긴다. 더할 것:
```js
ok('unknown model falls back to the default price, not NaN', Number.isFinite(tally(fileWith(rowFor('claude-future-9'))).usd));
ok('file that shrank (rotated) is re-read from 0', /* write 3 rows, tally, overwrite with 1 row, tally → counts 1 row */ ...);
```
(두 번째 점검은 실제 코드로: 파일에 3줄 쓰고 `tally`, 1줄로 덮어쓰고 다시 `tally` → `out` 이 1줄치여야 한다.)
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현** — 원형을 옮긴다. 단가표는 파일 맨 위 상수 하나(`PRICES`)로 두고 README 에 "API list-price estimate, not your bill" 을 적는다.
- [ ] **Step 4: 통과**
- [ ] **Step 5: Commit** — `git commit -am "feat: token and cost tally from session logs"`

---

### Task 7: 판 — `board.mjs`

**Files:**
- Create: `bin/board.mjs`
- Modify: `test/run.mjs`
- 원형: `ops/board.mjs`

**Interfaces:**
- Consumes: `loadAgents` · `projectSlug` · `claudeHome` · `kitOf` · `read`/`ledgerGroups`/`open` · `tally`
- Produces: `board(repoRoot, now?): BoardData`, HTTP `GET /` (board.html), `GET /api/board`, `GET /api/log?id=…&before=…`
- `BoardData = { now, repo: {branch, head, dirty, ahead}, roles: RoleView[], sessions, live, team, groups, open, spend }`
- `RoleView = { name, dir, branch, what, kit, logDir, sessionIds }`

- [ ] **Step 1: 점검** — 원형 selftest 에서 가져올 것: `describe` · `chatItems` · `teamOf` · `phaseOf` · `sessions` · `liveSessions` · `askedByHuman` 점검 전부. 뺄 것: `facts`·`loopRounds`·`handoff`·`whoasked`·주식 관련. 더할 것:
```js
ok('role whose log folder does not exist yet is shown, not fatal',
   board(fakeRepoWithRoleButNoLogs).roles.find(r => r.name === 'ui').sessionIds.length === 0);
ok('log dir comes from the role path, not from env', roleView.logDir.endsWith(projectSlug(ui.dir)));
ok('broken jsonl line is skipped', sessions(dirWithHalfLine).length === 1);
```
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현** — 원형을 옮기며:
  - 기록 폴더는 환경 변수 `OPS_LOG_DIRS` 가 아니라 역할마다 `join(claudeHome(), 'projects', projectSlug(role.dir))`. 없으면 빈 목록(죽지 않는다 — Review Focus 4).
  - 창 이름은 `join(claudeHome(), 'sessions')`.
  - `repo()` 는 원형 `facts.mjs` 의 `repo()` 만 옮긴다(git 호출 4개).
  - 포트 기본 `8740`, 호스트 기본 `127.0.0.1`. `--host` 가 127.0.0.1·localhost·::1 이 아니면 `WARNING: the board shows full session transcripts. Anyone who can reach ${host}:${port} can read them.` 을 찍는다.
  - 판은 쓰지 않는다: `writeFileSync` import 가 selftest 밖에서 쓰이지 않는지 점검 하나 — `ok('board never writes', !/writeFileSync\(/.test(sourceOutsideSelftest))`.
- [ ] **Step 4: 통과** — `node test/run.mjs`; 그리고 `node bin/board.mjs` 로 띄워 `curl -s 127.0.0.1:8740/api/board` 가 JSON 을 주는지 본다.
- [ ] **Step 5: Commit** — `git commit -am "feat: read-only board server"`

---

### Task 8: 판 화면 — `board.html`

**Files:**
- Create: `bin/board.html`
- 원형: `ops/board.html` (2026-09-26 판 — 접기·도구 비교 포함)

**Interfaces:**
- Consumes: `GET /api/board` 의 `BoardData` (Task 7)

- [ ] **Step 1: 옮기기** — 원형에서 탭 다섯(팀 · 창 · 도구 · 장부 · 비용)만 남긴다. 뺄 것: 자동 고리(loop) 탭, 넘길 것(handoff) 띠, 주식 사실(facts) 머리, `focus` 호출(창 앞으로). 문구는 영어.
- [ ] **Step 2: 창 되살리기 단추** — `focus.mjs` 대신 복사 단추:
```js
const resumeCmd = x => `cd "${x.dir}" && claude --resume ${x.id}`;
// button: navigator.clipboard.writeText(resumeCmd(x)).then(() => btn.textContent = 'copied')
```
  클립보드가 막힌 환경(http, 권한 없음)이면 명령을 `<code>` 로 보여 준다.
- [ ] **Step 3: 도구 탭** — 역할마다 `kit` 을 원형 `.kit` 모양(ok · 빠짐 · + · 공용)으로. 색만으로 가르지 않게 글자(`missing`, `+`)를 붙인다. `plan` 은 "not set up yet".
- [ ] **Step 4: 확인** — 헤드리스 크롬(`chrome --headless=new --remote-debugging-port=9222`)으로 390·1440 폭을 열어: 콘솔 오류 0, 가로 넘침 0(`document.documentElement.scrollWidth <= innerWidth`), 다섯 탭이 모두 눌린다. 결과 수치를 커밋 메시지에 적는다.
- [ ] **Step 5: Commit** — `git commit -am "feat: board page with team, sessions, tools, ledger and cost tabs"`

---

### Task 9: `/agentsemble` 스킬

**Files:**
- Create: `skills/agentsemble/SKILL.md`

**Interfaces:**
- Consumes: `bin/setup.mjs`, `bin/status.mjs`, `bin/board.mjs` CLI (Task 3·4·7)

- [ ] **Step 1: frontmatter**
```yaml
---
name: agentsemble
description: Read this repo, propose a team of Claude Code sessions (main + 2-4 subs with their own git worktrees, skills and plugins), set it up after approval, and watch it on a local board. Use for "/agentsemble", "set up agent team", "split this across sessions", "agentsemble status/add/board".
---
```
- [ ] **Step 2: 본문** — 설계 문서 2장의 0~5 단계와 하위 명령 표를 그대로 옮긴다. 반드시 들어갈 문장:
  - 2단계 끝: "**Stop here and wait for the human to approve the table.** Do not run setup without an explicit yes."
  - 비용 한 줄: "Each extra session pays its own fixed context cost. If the work fits in ~30 minutes, say so and suggest staying solo."
  - 운영 규칙 main: "Never ask a sub-session to perform an action that was denied in its own window — that bypasses the human's permission decision."
  - 운영 규칙 main: "If the human is following only the main window (e.g. from a phone), relay sub-session questions and approvals through main." (2026-09-26 실제로 겪은 일)
  - 스크립트는 `node "${CLAUDE_PLUGIN_ROOT}/bin/…"` 로 부른다.
- [ ] **Step 3: 손 확인** — 이 PC 의 `MAIN/9.잡다구리` 아래 아무 저장소에서 `/agentsemble` 을 돌려 5단계까지 가는지 본다(설치는 Task 10 의 로컬 마켓으로).
- [ ] **Step 4: Commit** — `git commit -am "feat: /agentsemble skill"`

---

### Task 10: 훅(선택) · README · 공개

**Files:**
- Create: `bin/handoff.mjs`, `bin/whoasked.mjs`, `hooks/hooks.json.example`, `README.md`, `README.ko.md`
- 원형: `ops/handoff.mjs`, `ops/whoasked.mjs`

- [ ] **Step 1: 훅 옮기기** — 두 파일을 옮기고 selftest 를 `test/run.mjs` 에 더한다. 기본으로 켜지지 않게 `hooks/hooks.json` 이 아니라 `hooks/hooks.json.example` 로 둔다. README 에 켜는 법(프로젝트 `.claude/settings.json` 의 hooks 에 복사).
- [ ] **Step 2: README.md (영어)** — 순서: 한 줄 설명 → 판 GIF(가짜 과제로 찍음, 대화 내용이 안 비치게) → Install(`/plugin marketplace add havanafrog/agentsemble` 다음 `/plugin install agentsemble@agentsemble`) → Quick start(`/agentsemble`) → What it will and won't do(하지 않는 것 네 줄) → Board(주소, **transcripts are visible — keep it on localhost**) → agents.json 예 → Cost note → Hooks(optional) → License.
- [ ] **Step 3: README.ko.md** — 같은 구성, 한국어.
- [ ] **Step 4: 로컬 설치 확인** — `/plugin marketplace add "<path to this repo>"` → install → 새 창에서 `/agentsemble status` 가 도는지.
- [ ] **Step 5: 공개** (사람 승인 후)
```bash
gh repo create havanafrog/agentsemble --public --source . --push \
  --description "Read your repo, assemble a team of Claude Code sessions, and watch them work from one local dashboard."
gh repo edit havanafrog/agentsemble --add-topic claude-code,claude-code-plugin,claude-code-skills,claude-skills,claude,anthropic,multi-agent,ai-agents,agentic-coding,agent-orchestration,parallel-agents,subagents,git-worktree,developer-tools,ai-coding-assistant,llm,agent-teams,observability,dashboard,workflow-automation
```
- [ ] **Step 6: CI 확인** — `gh run watch` 로 6칸(3 OS × 2 Node) 모두 초록.
