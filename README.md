# agentsemble

**Split a repo across a team of Claude Code sessions — and watch the whole team, live, on one map.**

[한국어](README.ko.md)

![The Map tab: main on top, a card per role — what each window is doing, the areas it owns, what it is changing now](docs/board-map.png)

The board draws your project's architecture *as the team is working on it*:

- **who owns which part** of the repo, and **what each session has actually changed** (its branch plus uncommitted work)
- **work outside a role's own files** (orange ✎) and **files two sessions both changed** (red ●) — before they turn into a merge fight
- **who sent orders to whom**, and whether each window is moving, waiting for you, or stopped
- **Open** beside a role brings its terminal to the front — or reopens it with `claude --resume` if it was closed (Windows)

Everything is read from git and Claude Code's own logs on your machine. Nothing leaves localhost.

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
**Tasks and projects.** Give roles a `"task"` in `agents.json` and they get their own tab above the
board (main heads every tab); `"$title"` names the project tab. One board can watch several repos:
`board.mjs --also ../other-repo` adds a tab for each. The bell top right and the red counts on the
tabs show which windows wait for you.

Four tabs: **Map** (above — main on top, a card per role: what its window is doing, the last order it got, the areas it owns and what it is changing now), **Sessions** (every session's
latest moves; click one for its conversation), **Tools** (planned vs installed, per role —
`missing` and `+` mark drift), **Ledger** (open claims first, finished ones folded).

Click a role on the Map or a session card: a side drawer opens with its **Conversation** and its
**Changes** (files and the patch — its branch against main plus uncommitted work). Click a red clash
to see both roles' edits of that file one above the other. A blue dot marks windows with something new
since you last opened them; when a window finishes and turns to *your
turn*, a card pops up bottom right (a desktop notification instead while the tab is hidden, once
allowed from the bell). The bell top right counts the windows waiting for you and lists them.

> **The board shows full session transcripts.** It listens on 127.0.0.1 only. `--host` lets you
> change that and prints a warning — don't expose it.

It reads `~/.claude/projects/…` logs and `~/.claude/sessions`; it never writes anything.

**In a container.** Mount the folder that holds the repo and its worktrees (read-only), plus
`~/.claude/sessions` and the repo's `~/.claude/projects/<slug>` folders, set `CLAUDE_HOME` to where they
landed, and run `board.mjs --host 0.0.0.0` with the port published to `127.0.0.1` only. Logs are named
after the host path, so tell the board where the mount came from:
`AGENTSEMBLE_PATH_MAP=/work=C:\Users\me\code`. Make worktree links relative first
(`git worktree repair --relative-paths`) so git can follow them inside the container.

## agents.json

```json
{
  "main": { "dir": ".", "what": "split, check, merge", "model": "opus" },
  "ui": {
    "dir": "../myapp-team/ui", "branch": "agent/ui",
    "what": "web UI", "not": "server API", "owns": ["web/"],
    "skills": ["taste"],
    "plugins": { "superpowers@claude-plugins-official": true },
    "model": "sonnet", "autonomy": "build"
  },
  "review": { "shared": true, "what": "reads and checks others' work", "model": "opus" },
  "wishlist": ["a browser-measuring skill"]
}
```

Only roles that change files get a folder. A role that only reads (review, research) is
`"shared": true` — it opens in the main folder with main's tools.

`model` picks the window's model (strongest for main and verifiers, mid for implementers, light for
watchers). `autonomy` is how far a role goes before checking in: `ask` (plan first), `build`
(default: change, test, commit, report) or `run` (loop until its check passes).

Commit it — the team has history like the code. Schema: `agents.schema.json`.

## Commands

| | |
|---|---|
| `/agentsemble` | understand → propose → set up → open windows → working rules |
| `/agentsemble status` | planned vs installed tools per role (`bin/status.mjs`, exits 1 on drift) |
| `node bin/inventory.mjs` | installed plugins (on/off, with their skills) and your own skills |
| `/agentsemble add <role>` | one more role |
| `/agentsemble board` | start the board |
| `/agentsemble verify` · `claim` · `claims` · `send` | builder/verifier ledger in `ops/ledger.jsonl` |

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
