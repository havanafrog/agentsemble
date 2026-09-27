# agentsemble

**저장소를 읽고, Claude Code 창들을 한 팀으로 모으고, 한 로컬 판에서 지켜봅니다.**

[English](README.md)

agentsemble 은 Claude Code 플러그인입니다. 저장소에서 `/agentsemble` 을 부르면 Claude 가 과제를
읽고 팀을 제안합니다 — **main** 창 하나와 **서브** 창 2~4개, 서브마다 자기 git worktree 와 자기
스킬·플러그인을 가집니다. 승인하면 그대로 꾸립니다. 로컬 판에서 누가 무엇을 하는지, 창마다
걸려야 할 도구가 걸렸는지, 만드는 쪽·재는 쪽 장부, 쓴 비용을 봅니다.

실제 과제를 이렇게 굴리다 나온 도구입니다: 일을 쪼개 지시하고 결과를 직접 확인해 합치는 main,
화면 창, 모델 학습 창.

## 설치

Claude Code 에서:

```
/plugin marketplace add havanafrog/agentsemble
/plugin install agentsemble@agentsemble
```

Node 20 이상과 git 이 필요합니다. npm 패키지는 없습니다.

## 빠른 시작

```
/agentsemble
```

1. Claude 가 저장소(README, 폴더, 빌드·테스트 명령, 최근 커밋, 설치된 플러그인·스킬)를 읽고
   몇 줄로 요약합니다. 틀리면 고쳐 주세요.
2. 팀 표를 제안합니다 — 역할마다 할 일, 건드리지 않을 것, 맡는 파일, 작업칸과 브랜치,
   **이미 설치된** 스킬·플러그인 중 무엇을 걸지. **여기서 멈추고 승인을 기다립니다.**
3. 승인하면 `agents.json` 을 쓰고, 작업칸을 만들고, 역할마다 스킬과 플러그인 켜고 끄기를 겁니다.
4. 서브 역할마다 창을 엽니다 (`cd ../<저장소>-<역할> && claude` 뒤 `/rename <역할>`).
5. 판을 띄웁니다:

```
node "<플러그인 폴더>/bin/board.mjs"      →  http://127.0.0.1:8740
```

## 하는 것과 안 하는 것

- **아무것도 설치하지 않습니다.** 스킬은 이미 가진 것(`~/.claude/skill-store`, `~/.claude/skills`)
  에서 고릅니다. 없는 도구는 `wishlist` 에 적습니다.
- **창을 대신 열지 않습니다.** 터미널·IDE 가 제각각이라 사람이 열고 이름을 붙입니다.
- **팀 표를 승인하기 전에는 꾸리지 않습니다.**
- **다른 설정은 건드리지 않습니다.** 작업칸 `.claude/settings.local.json` 의 `enabledPlugins`
  만 씁니다.

## 판

탭 다섯: **Team**(main 과 서브, 서브가 받은 마지막 지시), **Sessions**(창마다 최근 동작, 누르면
대화), **Tools**(역할마다 계획 대 실제 — `missing`·`+` 로 어긋남 표시), **Ledger**(열린 주장이 위,
끝난 것은 접힘), **Cost**.

> **판에는 대화 기록이 통째로 보입니다.** 127.0.0.1 에서만 듣습니다. `--host` 로 바꾸면 경고를
> 찍습니다 — 밖에 열지 마세요.

`~/.claude/projects/…` 기록과 `~/.claude/sessions` 를 읽기만 하고, 아무것도 쓰지 않습니다.

## agents.json

```json
{
  "main": { "dir": ".", "what": "쪼개고, 확인하고, 합친다" },
  "ui": {
    "dir": "../myapp-ui", "branch": "agent/ui",
    "what": "화면", "not": "서버 API", "owns": ["web/"],
    "skills": ["taste"],
    "plugins": { "superpowers@claude-plugins-official": true }
  },
  "wishlist": ["브라우저로 재는 스킬"]
}
```

커밋해 두세요 — 팀 구성도 코드처럼 내력이 남아야 합니다. 스키마: `agents.schema.json`.

## 명령

| | |
|---|---|
| `/agentsemble` | 파악 → 제안 → 꾸리기 → 창 열기 안내 → 운영 규칙 |
| `/agentsemble status` | 역할마다 계획 대 실제 (`bin/status.mjs`, 어긋나면 exit 1) |
| `/agentsemble add <역할>` | 역할 하나 더 |
| `/agentsemble board` | 판 띄우기 |
| `/ops verify` · `/ops claim` · `/ops status` | `ops/ledger.jsonl` 장부 |

## 비용

창이 많아지면 전체 토큰은 늡니다 — 창마다 고정비가 있고, 서브는 main 이 이미 읽은 파일을 다시
읽습니다. 대신 동시에 진행되고 main 맥락이 가벼워집니다. 30분 안에 끝날 일은 혼자 하세요.

Cost 탭은 기록의 토큰 수에 `bin/cost.mjs` 의 `PRICES` 단가를 곱합니다. **API 정가 환산이지 실제
청구액이 아닙니다.** `PRICES` 에 없는 모델은 $0 으로 세고 "unpriced" 로 표시합니다 — 짐작을
믿지 말고 거기에 단가를 더하세요.

## 개발

```
node test/run.mjs
```

모든 모듈에 자체 점검이 있고, CI 가 Windows·macOS·Linux × Node 20·22 에서 돌립니다.

## 라이선스

MIT
