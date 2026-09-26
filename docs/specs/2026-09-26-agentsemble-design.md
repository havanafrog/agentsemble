# agentsemble — 설계

> agent + assemble + ensemble. 과제를 읽고, 필요한 Claude Code 창들을 팀으로 모으고,
> 한 판에서 지켜본다.

- 날짜: 2026-09-26
- 상태: 설계 검토 중
- 저장소: `github.com/havanafrog/agentsemble` (공개, 아직 안 만듦)
- 원형: `stock-sentiment` 의 `ops/`, `agents/agents.json`, `tools/agent-setup.mjs`

## 1. 무엇을 풀려는가

Claude Code 창을 여러 개 띄워 일을 나누면 빨라지고 main 창의 맥락이 가벼워진다.
그런데 지금은 전부 손으로 한다.

- 역할을 어떻게 나눌지 사람이 정한다.
- 작업칸(git worktree)을 파고, 역할마다 스킬·플러그인을 따로 거는 것도 손이다.
- 누가 무엇을 하고, 도구가 제대로 걸렸고, 얼마를 썼는지 한눈에 볼 곳이 없다.

agentsemble 은 이 세 가지를 한 플러그인으로 묶는다.

### 성공 기준

1. 처음 보는 저장소에서 `/agentsemble` 한 번으로 역할표 초안이 나오고, 승인하면
   작업칸과 도구가 걸린다. 사람은 창을 열고 이름만 붙인다.
2. `node bin/board.mjs` 로 띄운 판에서 팀 구조·각 창 상태·도구 계획과 실제·장부·비용이 보인다.
3. Windows·macOS·Linux 에서 외부 패키지 없이 Node 20+ 만으로 돈다.
4. 모든 스크립트에 `--selftest` 가 있고 CI 가 세 OS 에서 돌린다.

### 하지 않는 것 (v1)

- 창을 대신 띄우기. 창은 사람이 연다 (터미널·IDE 가 제각각이다).
- 스킬·플러그인 설치. 가진 것 중에서 고르고, 없는 건 "있으면 좋다" 고만 적는다.
- 공개 마켓 검색.
- 판을 외부에 열기. 127.0.0.1 전용.

## 2. 쓰는 흐름 — `/agentsemble`

### 0. 상태 확인

- git 저장소가 아니면 멈추고 `git init` 을 권한다.
- `agents.json` 이 이미 있으면 설계하지 않는다. `status` 로 간다.

### 1. 과제 파악 (읽기만)

읽는 것: README · 폴더 구조(깊이 2) · 언어와 빌드·테스트 명령 · 최근 커밋 30개 ·
TODO/계획 파일 · 설치된 플러그인(`~/.claude/settings.json` enabledPlugins)과 스킬
(`~/.claude/skills`, `~/.claude/skill-store`).

사람에게 5~10줄로 보여 준다.

- 무슨 과제인가
- 일의 갈래 (예: 화면 / 서버 / 모델 학습)
- 갈래끼리 부딪히는 파일

사람이 고치면 반영하고 넘어간다.

### 2. 팀 설계 제안 → 승인 대기

main 하나 + 서브 2~4. 역할마다:

| 칸 | 내용 |
|---|---|
| what | 하는 일 한 줄 |
| not | 안 하는 일 |
| owns | 주로 건드리는 파일·폴더 |
| dir / branch | 작업칸 폴더 이름, 브랜치 |
| skills | 걸 스킬과 이유 |
| plugins | 켜고 끌 플러그인 |

- 두 역할이 같은 파일을 건드리면 표시하고 주인을 하나로 정한다.
- 필요한데 없는 도구는 `wishlist` 에만 적는다.
- 토큰 비용 한 줄: "창마다 고정비가 붙는다. 30분 안에 끝날 일은 main 혼자 하라."
- **여기서 멈춘다.** 승인 없이 3단계로 가지 않는다.

### 3. 구성

`agents.json` 을 쓰고 `node bin/setup.mjs --all` 을 돌린다. 역할마다 한 줄 결과.

### 4. 창 띄우기 안내

역할마다 복사할 두 줄:

```
cd ../<repo>-ui && claude
/rename ui
```

### 5. 운영 규칙

- **main**: `SendMessage` 로 일을 보낸다. 결과가 오면 직접 돌려 보고 판정을 장부에
  남긴 뒤 합친다. 다른 창에서 거절된 권한 동작을 대신하지 않는다.
- **서브**: 끝나면 무엇을·어떻게 확인했나·커밋 해시를 main 에 보낸다. main 에 직접
  합치지 않는다.
- 판 주소를 알려 준다.

### 하위 명령

| 명령 | 하는 일 |
|---|---|
| `/agentsemble` | 위 0~5 |
| `/agentsemble status` | 역할표 대 실제 설치 비교 |
| `/agentsemble add <역할>` | 역할 하나 더 (2~4단계만) |
| `/agentsemble board` | 판 띄우기 |
| `/ops verify` · `claim` · `status` | 장부 (기존 ops 스킬) |

## 3. 저장소 구조

```
.claude-plugin/
  plugin.json            이름·버전·설명
  marketplace.json       /plugin marketplace add havanafrog/agentsemble
skills/
  agentsemble/SKILL.md   2장의 흐름
  ops/SKILL.md           만드는 쪽·재는 쪽 장부
hooks/hooks.json         (선택) handoff·whoasked — 5장
bin/
  setup.mjs              작업칸·도구 걸기
  board.mjs board.html   판
  ledger.mjs cost.mjs    장부·비용
  handoff.mjs whoasked.mjs
  lib/paths.mjs          기록 폴더 이름 규칙 등 공용
test/fixtures/           가짜 과제
.github/workflows/ci.yml windows·macos·ubuntu × --selftest
README.md  README.ko.md
LICENSE (MIT)
```

## 4. 역할표 `agents.json`

과제 저장소 루트에 둔다. 커밋한다 — 팀 구조도 코드와 같이 버전이 붙어야 한다.

```json
{
  "$schema": "https://raw.githubusercontent.com/havanafrog/agentsemble/main/agents.schema.json",
  "main":  { "dir": ".", "what": "뇌 — 쪼개고, 검증하고, 합친다",
             "skills": [], "plugins": {} },
  "ui":    { "dir": "../myapp-ui", "branch": "agent/ui",
             "what": "화면", "not": "서버 API", "owns": ["web/"],
             "skills": ["taste"], "plugins": { "superpowers@claude-plugins-official": true } },
  "wishlist": ["브라우저로 재는 스킬"]
}
```

바뀐 점 (원형 대비):

- `dir` 을 저장소 기준 상대 경로로. 원형은 형제 폴더 이름만 받고 끝말(`-auto`)로
  짝지었다 — 이름 규칙에 기대는 건 깨지기 쉽다.
- `not`·`owns`·`wishlist` 추가.
- 과제 이름·경로를 코드에 적지 않는다. 전부 여기서 읽는다.

## 5. 스크립트

### `setup.mjs`

```
node bin/setup.mjs <역할>|--all [--dry-run]
node bin/setup.mjs --selftest
```

1. 작업칸이 없으면 `git worktree add <dir> -b <branch>`.
2. `<dir>/.claude/skills/<이름>` 에 스킬 복사. 찾는 순서: 역할표에 적힌 경로 →
   `~/.claude/skill-store` → `~/.claude/skills`. 없으면 `!` 줄로 알리고 계속.
3. 다른 역할에서 넣었던 스킬은 걷어 낸다. 저장소가 추적하는 스킬(git ls-files)은 둔다.
4. `<dir>/.claude/settings.local.json` 의 `enabledPlugins` 만 고친다. 다른 칸은 그대로.
5. `.gitignore` 에 `.claude/settings.local.json`, `.claude/skills/*` 가 없으면 더한다.

두 번 돌려도 결과가 같다.

### 훅 (선택, 기본 꺼짐)

- `handoff` (Stop): 장부에 넘기지 않은 판정이 있으면 턴을 못 끝내게 한다.
- `whoasked` (UserPromptSubmit): 옆 창이 받은 지시를 이 창에 알려 준다.

훅은 모든 턴에 돈다. 켜는 법만 README 에 적고 기본은 끈다.

## 6. 판

```
node bin/board.mjs [--port 8730]     →  http://127.0.0.1:8730
```

외부 패키지 없음. Docker 는 README 에 선택으로만.

### 읽는 곳 (모두 읽기 전용)

| 무엇 | 어디서 |
|---|---|
| 역할·계획 | `agents.json` |
| 실제 도구 | 각 작업칸 `.claude/skills`, `settings.local.json` |
| 대화 기록 | `~/.claude/projects/<작업칸 경로 규칙>/*.jsonl` |
| 창 이름·살아 있나 | `~/.claude/sessions` |
| 장부 | `ops/ledger.jsonl` |
| 브랜치·커밋 안 된 것 | `git` |

### 탭

| 탭 | 보여 주는 것 |
|---|---|
| 팀 | main→서브 관계, 마지막 지시, 도는 중·기다림·꺼짐 |
| 창 | 최근 다섯 수, 대화 서랍 |
| 도구 | 계획 대 실제 — ok · 빠짐 · + · 공용 |
| 장부 | 주장과 판정, 열린 것 먼저 |
| 비용 | 창별 API 정가 환산 (실제 청구액 아님을 적는다) |

원형에서 뺀 것: 주식 데이터·오라클 ssh(`facts.mjs` 과제 전용 부분), 창 앞으로
가져오기(`focus.mjs`, Windows 전용). 대신 창 카드에 `cd <dir> && claude --resume <id>`
복사 단추.

### 보안

- 127.0.0.1 에만 연다. `--host` 로 바꾸면 경고를 찍는다.
- 대화 기록이 통째로 보인다. README 첫 화면에 적는다.
- 쓰지 않는다. 판은 어떤 파일도 고치지 않는다.

## 7. 크로스 플랫폼

- 경로는 `node:path` 로만. 문자열로 `/`·`\` 를 붙이지 않는다.
- 기록 폴더 이름 규칙(`C:\a\b` → `C--a-b`, 영문·숫자 말고는 `-`)을 `lib/paths.mjs`
  한 곳에 둔다. 점검: Windows·POSIX·한글 경로(`8. 주식감성` → `8-------`).
- 줄바꿈 CRLF/LF 둘 다 읽는다.

## 8. 확인

- `setup.mjs --selftest`: 임시 폴더에 git 저장소·가짜 skill-store 를 만들고 두 역할을
  걸고, 두 번 걸어도 같은지, 남의 스킬을 걷어 내는지, settings 의 다른 칸을 안
  건드리는지 본 뒤 지운다.
- `board.mjs --selftest`: 원형의 89개 점검 중 과제 전용 부분을 뺀 것 + 도구 비교.
- CI: windows-latest · macos-latest · ubuntu-latest × Node 20·22.
- 공개 전 실측: 이 PC 의 `9.잡다구리` 에서 설치 → `/agentsemble` → 판까지 손으로 한 번.

## 9. 순서

1. 저장소 뼈대, `lib/paths.mjs`, `setup.mjs` + 점검
2. `skills/agentsemble/SKILL.md` (2장)
3. `ops` 스킬·`ledger.mjs` 일반화
4. 판 (`board.mjs`/`html`, `cost.mjs`) — 과제 전용 부분 걷기
5. 훅 (선택)
6. README 두 벌, CI, 실측, 공개

## 10. 공개·노출

GitHub topics (최대 20개, 검색 유입이 큰 순):

```
claude-code  claude-code-plugin  claude-code-skills  claude-skills  claude  anthropic
multi-agent  ai-agents  agentic-coding  agent-orchestration  parallel-agents  subagents
git-worktree  developer-tools  ai-coding-assistant  llm  agent-teams  observability
dashboard  workflow-automation
```

- 저장소 설명(한 줄, 영어): "Read your repo, assemble a team of Claude Code sessions,
  and watch them work from one local dashboard."
- README 첫 화면에 판 스크린샷(GIF) 한 장 — 가짜 과제로 찍는다. 대화 내용이 비치지
  않게 한다.
- 공개 뒤 `claude-plugins-official` 등 플러그인 마켓 목록과 awesome-claude-code 류
  목록에 등록 요청.

## 11. 열린 질문

- 판 기본 포트 8730 — 이 PC 의 원형 판과 겹친다. 공개판은 8740 으로 할지.
- `stock-sentiment` 의 `ops/` 를 이 플러그인으로 옮기는 건 v1 공개 뒤 따로.
