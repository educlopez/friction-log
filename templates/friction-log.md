# Friction log

Contributor and agent papercuts while working in this repository live as GitHub
issues labeled `friction`. They are not files in the tree.

This is not a product feature request. File those as ordinary issues. This page
is for developing `{{REPO}}`: confusing docs, a command that needs a secret
handshake, a type that lies, a test that only fails locally.

The policy lives here. Agents that load skills on demand read the same policy
from `.cursor/skills/friction-log/SKILL.md` or
`.claude/skills/friction-log/SKILL.md`; agents that read a single root file get
a pointer to this page from [`AGENTS.md`](../../AGENTS.md). All three are
written by `friction-log init` and re-synced by `init --force`.

Canonical tooling: [`educlopez/friction-log`](https://github.com/educlopez/friction-log).

## File an entry

Search open `friction` issues first. Comment on a match instead of opening a
duplicate.

Title: `Friction: <what hurt>`.

Label: `friction`.

Use the [Friction issue form](../../.github/ISSUE_TEMPLATE/friction.yml) or:

```bash
gh issue create --repo {{REPO}} --title "Friction: …" --label friction --body-file -
```

Write one issue per papercut. Include what you were doing, the unexpected cost,
the workaround, and enough reproduction to investigate without the original
session. Omit secrets, tokens, and unrelated private content.

Do not commit a `.agents/friction-log/` or `docs/friction-log/` directory.
GitHub is the log.

## Daily investigation

The `Friction log` GitHub Action runs on the schedule in
[`.github/workflows/friction-log.yml`](../../.github/workflows/friction-log.yml)
— typically early morning UTC before the working day. Stagger the cron minute
across repos if you install in several. It uses `educlopez/friction-log@v1` to
list open `friction` issues and, when any are eligible and `CURSOR_API_KEY` is
set, spawn one Cursor Cloud Agent on `{{REPO}}` `main`.

The investigator chooses one outcome per issue:

| Outcome       | What happens                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------------- |
| Already fixed | Closes the issue with the evidence.                                                                |
| Invalid       | Closes the issue (not repo friction, duplicate, or not actionable).                                |
| Skip          | Comments a recommended fix and marks the issue skipped until @{{OWNER}} replies.                   |
| Fix           | Opens a PR. Low and medium risk may squash-merge after green CI. High risk stays ready-for-review. |

A skip comment includes `<!-- friction-log:skipped -->`. Later daily runs ignore
that issue until @{{OWNER}} comments (approve the recommendation, close it, or
give a different approach).

After a successful spawn the sweep comments
`<!-- friction-log:claimed:YYYY-MM-DD -->` on every issue it handed to the
agent, so a second run the same UTC day finds nothing eligible and does not
spawn a rival investigator. `--force` ignores the claim. A claim counts only
when `github-actions[bot]` or an owner login wrote it — otherwise any commenter
on a public repository could suppress the day's sweep. When a claim write
fails, the sweep still finishes and names the unclaimed issues in
`result.unclaimed`; those issues can draw a second agent later that day.

## Operator controls

| Command / control                        | Purpose                                 |
| ---------------------------------------- | --------------------------------------- |
| `npx github:educlopez/friction-log@v1 scan` | Read-only eligibility scan. No agent. Pin to the same commit as the workflow after `init`. |
| Repo variable `FRICTION_LOG_PAUSED=true` | Kill switch: scan, but do not spawn.    |
| Actions → Friction log → Run workflow    | Manual sweep (`dry_run`, `force`).      |

Create the `friction` label (color `#D4A017`) if it does not exist. Add a
repository secret `CURSOR_API_KEY` (Cursor Dashboard → API Keys) so the daily
job can spawn an investigator. Without that secret the Action still scans and
exits successfully.
