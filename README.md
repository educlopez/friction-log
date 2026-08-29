# friction-log

Shared GitHub-issue **friction log** and daily Cursor Cloud Agent investigator.
Modeled on [kentcdodds/kody#1786](https://github.com/kentcdodds/kody/pull/1786):
the log lives as issues labeled `friction`, not files in the tree. This repo is
the reusable engine. Each consuming repo keeps a thin workflow, an issue form,
and the investigator skill.

## Use it in any repo

From the target checkout:

```bash
npx github:educlopez/friction-log init
```

That copies:

- `.github/ISSUE_TEMPLATE/friction.yml`
- `.github/workflows/friction-log.yml` — calls `educlopez/friction-log@v1`
- `.cursor/skills/friction-log/SKILL.md`
- `docs/contributing/friction-log.md`

Then:

1. Create the `friction` label (color `#D4A017`)
2. Add repository secret `CURSOR_API_KEY` ([Cursor API keys](https://cursor.com/dashboard?tab=integrations))
3. Optional kill switch: repository variable `FRICTION_LOG_PAUSED=true`

One `CURSOR_API_KEY` per GitHub account is enough; add the same secret to each
repo. The daily job only spawns an agent when that repo has eligible issues.

## What the daily job does

Every day (04:00 UTC in the template workflow) the Action:

1. Lists open issues labeled `friction`
2. Drops skipped ones until `@OWNER` comments after `<!-- friction-log:skipped -->`
3. If any remain and `CURSOR_API_KEY` is set, spawns **one** Cursor Cloud Agent
   on that repo’s `main`

The agent picks one outcome per issue: already fixed, invalid, skip, or fix.

Issue titles, bodies, and comments are treated as **untrusted data**.

## CLI

```bash
# in a repo with GH_TOKEN / GITHUB_TOKEN
npx github:educlopez/friction-log scan
npx github:educlopez/friction-log sweep --dry-run
npx github:educlopez/friction-log sweep --force
```

| Env                     | Purpose                                      |
| ----------------------- | -------------------------------------------- |
| `GITHUB_TOKEN`          | List issues and comments                     |
| `CURSOR_API_KEY`        | Spawn the investigator (optional for scan)   |
| `FRICTION_LOG_REPO`     | `owner/name` (defaults to `GITHUB_REPOSITORY`) |
| `FRICTION_LOG_OWNER`    | Logins that can unskip (defaults to repo owner) |
| `FRICTION_LOG_REF`      | Starting git ref (default `main`)            |
| `FRICTION_LOG_MODEL`    | Cursor model id (default `composer-latest`; `default` = your Cursor default) |
| `FRICTION_LOG_PAUSED`   | `true` to scan without spawning              |

## GitHub Action

```yaml
- uses: educlopez/friction-log@v1
  env:
    CURSOR_API_KEY: ${{ secrets.CURSOR_API_KEY }}
    FRICTION_LOG_PAUSED: ${{ vars.FRICTION_LOG_PAUSED }}
```

Inputs: `repo`, `owner`, `dry-run`, `force`, `starting-ref`.

The caller must grant `issues: read`. Closing issues and opening PRs is done by
the spawned Cloud Agent, not by this Action.

## Why not a directory in each repo?

Entries in the tree go stale. GitHub issues stay visible, searchable, and
closable. The shared Action means eligibility rules and spawn logic live in one
place instead of drifting per repo.
