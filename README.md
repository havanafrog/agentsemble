# agentsemble

**Read your repo, assemble a team of Claude Code sessions, and watch them work from one local dashboard.**

[한국어](README.ko.md)

## Install

In Claude Code:

```
/plugin marketplace add havanafrog/agentsemble
/plugin install agentsemble@agentsemble
```

Needs Node 20+ and git (install git; you don't need to know it — if the folder is not a git repo yet,
`/agentsemble` offers to set it up and make the first commit). No npm packages.

agentsemble is a Claude Code plugin. You run `/agentsemble` in a repo; Claude reads the project,
proposes a team — one **main** session plus two to four **sub** sessions, each in its own git
worktree with its own skills and plugins — and, once you approve, sets it up. A local board shows
who is doing what, whether each session has the tools it should, and the builder/verifier ledger.

It came out of running a real project this way: a main session that splits work, sends briefs,
checks results and merges; a UI session; a model-training session.

## Quick start

```
/agentsemble
```

1. Claude reads the repo (README, tree, build/test commands, recent commits, your installed
   plugins and skills) and summarizes it in a few lines. Correct it if needed.
2. It proposes a team table — each role's job, what it must not touch, files it owns, its worktree
   and branch, and which of **your installed** skills and plugins it gets. **It stops and waits for
   your approval.**
3. On yes it writes `agents.json`, creates the worktrees, and gives each one its skills and plugin
   switches.
4. You open one Claude Code window per sub role (`cd ../<repo>-team/<role> && claude`, then
   `/rename <role>`).
5. Start the board:

```
node "<plugin dir>/bin/board.mjs"        →  http://127.0.0.1:8740
```

## What it will and won't do

- **Won't install anything.** Skills come from what you already have (`~/.claude/skill-store`,
  `~/.claude/skills`). Missing tools are listed in `wishlist`.
- **Won't open windows for you.** Terminals and IDEs differ; you open them and name them.
- **Won't run setup without your yes** on the team table.
- **Won't change your other settings.** Only `enabledPlugins` in each worktree's
  `.claude/settings.local.json` is written.

## The board

Four tabs: **Team** (main and its subs, the last order each sub got), **Sessions** (every session's
latest moves; click one for its conversation), **Tools** (planned vs installed, per role —
`missing` and `+` mark drift), **Ledger** (open claims first, finished ones folded).

> **The board shows full session transcripts.** It listens on 127.0.0.1 only. `--host` lets you
> change that and prints a warning — don't expose it.

It reads `~/.claude/projects/…` logs and `~/.claude/sessions`; it never writes anything.

## agents.json

```json
{
  "main": { "dir": ".", "what": "split, check, merge" },
  "ui": {
    "dir": "../myapp-team/ui", "branch": "agent/ui",
    "what": "web UI", "not": "server API", "owns": ["web/"],
    "skills": ["taste"],
    "plugins": { "superpowers@claude-plugins-official": true }
  },
  "wishlist": ["a browser-measuring skill"]
}
```

Commit it — the team has history like the code. Schema: `agents.schema.json`.

## Commands

| | |
|---|---|
| `/agentsemble` | understand → propose → set up → open windows → working rules |
| `/agentsemble status` | planned vs installed tools per role (`bin/status.mjs`, exits 1 on drift) |
| `node bin/inventory.mjs` | installed plugins (on/off, with their skills) and your own skills |
| `/agentsemble add <role>` | one more role |
| `/agentsemble board` | start the board |
| `/ops verify` · `/ops claim` · `/ops status` | builder/verifier ledger in `ops/ledger.jsonl` |

## When not to split

More sessions cost more tokens in total: each window pays its own fixed context, and subs re-read
files main already read. You get parallel work and a lighter main context in return. For work that
fits in about half an hour, stay solo.

## Develop

```
node test/run.mjs
```

Every module has a selftest: `node test/run.mjs`. A GitHub Actions setup for Windows, macOS and Linux is in `docs/ci.yml.example`.

## License

MIT
