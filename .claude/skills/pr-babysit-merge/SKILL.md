---
name: pr-babysit-merge
description: Full GitHub PR-lifecycle automation — attach to one or more PRs, keep CI green, address actionable CodeRabbit (and similar bot) feedback in a loop, recover from CI failures via logs and reruns, merge when mergeable, then output a brief post-merge recap. Handles a single PR or several at once in dependency-aware order. **Explicit-token invocation only:** run this skill when the user asks to run it by including the literal token `/pr-babysit-merge` in their message — whether the harness expanded it as a slash command or it arrived as plain text (e.g. a remote-control session that does not expand slash commands). Do not invoke from paraphrased intent ("babysit my PR", "merge when green"), and do not invoke when the user is only discussing or editing the skill rather than asking to run it. PR URLs/numbers (or "all my open PRs") may follow the token as arguments; otherwise resolve the PR from the current branch.
allowed-tools: Bash, Read, Edit, Write, Grep, Glob
---

# PR babysit and merge

End-to-end: ensure each PR exists, keep CI green, address actionable CodeRabbit feedback, merge when safe, then summarize what happened. Works for a single PR or several at once — with multiple, it orders them sensibly (dependencies first) and merges them one at a time.

## Prerequisites

- GitHub repo; GitHub CLI installed and authenticated (`gh auth status`).
- Permission to push the PR branch and merge (per branch protection).
- If merge is blocked by **required human reviewers** or policy the bot cannot satisfy, **stop** on that PR and say exactly what is blocking; do not imply CodeRabbit fixes will unlock merge. With multiple PRs, set the blocked one aside and continue with the rest (see Ordering) rather than aborting the whole run.

## This repo (Nightturtles/water_project)

These facts override the generic guidance below. Re-check them if the workflows change.

- **What "green" means.** The `main: require CI` ruleset requires exactly six checks: `typecheck-and-test`, `e2e`, `edge-functions` (CI workflow), `ios-build`, `android-build` (Native build workflow), and `CodeRabbit` (`gh pr checks <n> --required` lists them). `deploy` shows `skipping` on every PR; that is expected. CodeRabbit's check can pass without a review having run (see below), so a green required set is necessary but not sufficient.
- **Ruleset bypass.** Repo admins (the owner) can bypass that ruleset, which keeps direct release pushes to `main` working. Never use it to merge: no `gh pr merge --admin`, and never merge while a required check is red or pending.
- **CI timing.** typecheck-and-test ~1 min, e2e ~1.5-2.5 min, ios-build ~2-3 min. The `e2e` job is serialized repo-wide (`concurrency: e2e-shared-test-account`), so it can sit `pending` while another PR's e2e runs (`queue: max` keeps every pending job in order). An e2e job that shows **cancelled** without a code reason was dropped from that queue (only past 100 pending): `gh run rerun <run-id> --failed`.
- **Merge style:** squash (every merged PR on `main` is `title (#N)`).
- **Merge gates by changed files** (`gh pr diff <n> --name-only`). Check these before the merge step, not after:
  - `src/lib/sync.ts`, `src/lib/storage.ts`, `src/lib/supabase-client.ts`, or the `window.*` auth surface → the **full** `npm run test:e2e` (not just smoke-sync) must have passed locally on the final head with `.env.test` credentials, per CLAUDE.md "Supabase safety". Before running it locally, confirm no CI e2e job is in progress (`gh run list --workflow CI --status in_progress`): the local run signs in as the same shared prod test account and the CI concurrency group cannot see it.
  - `supabase/migrations/**` → **stop before merging and ask.** Only the user runs `supabase db push` (it is denied to Claude), and merging deploys the web app immediately, so the user must decide the order (usually: migration applied first, then merge).
  - `supabase/functions/**` → same: only the user runs `supabase functions deploy <name>`; stop and ask about order.
  - `@capacitor/*` version bumps (including Dependabot PRs) → `npm run build && npx cap sync` output must be committed (`ios/App/CapApp-SPM/Package.swift` exact-pins capacitor-swift-pm; `Package.resolved` follows). Dependabot does not do this.
- **Dependabot PRs** get no Actions secrets, so the signed-in e2e describes skip on them. For `@supabase/supabase-js` bumps, run the full local e2e before merging.

## Remote / non-interactive runs

**Invoking remotely:** send a message containing the literal token `/pr-babysit-merge` (optionally followed by PR URLs/numbers, or "all my open PRs"). This works whether the channel expands it as a real slash command or delivers it as plain text — in a remote-control session that does not expand slash commands, the token in your message is enough for the model to treat it as an explicit invocation and run this skill. Paraphrases ("babysit my PR", "merge when green") deliberately do *not* trigger it; the literal token is required.

Unless you can confirm the run is interactive (every tool call still gets a human approval prompt), treat it as **non-interactive** and assume destructive tools may execute without a prompt. In that case, gate the irreversible, outward-facing steps yourself:

- **Before each `gh pr merge`:** post a one-line "about to merge #N into <base> — reply to confirm" and wait for an explicit go-ahead in the next message. This is the load-bearing gate: a merge is hard to reverse and often triggers a deploy.
- **Before creating a brand-new PR** (`git push` of a new branch + `gh pr create`): confirm once, since it is outward-facing.
- Iterative pushes to an already-open PR branch (CodeRabbit fixes, CI reruns, base-branch syncs) need **no** per-push confirmation — that is the normal loop, and gating each one defeats remote use.

This gate is *in addition to* the existing rules, never a workaround for them: do not force-push, bypass branch protection, or skip the CodeRabbit hard gate to satisfy a remote caller.

## Start

1. Resolve the PR set from `$ARGUMENTS` (or, when the skill was invoked from plain text rather than an expanded slash command, from the PR refs in the invoking message):
   - **One or more refs** (URLs or numbers, separated by spaces or commas) → that exact set.
   - **A phrase naming a set** ("all my open PRs", "every open PR") → expand it, e.g. `gh pr list --author @me --state open --json number`.
   - **Empty** → run `gh pr view` on the current branch (the single-PR default).
2. If the current branch has no PR yet and none were named: push the branch (`git push -u origin <branch>`), then `gh pr create --fill` or use the title/body the user gave.
3. **One PR** → skip ahead to the Main loop. **More than one** → order them first (next section), then run the Main loop on each in that order.
4. Do not force-push, hard reset, or rewrite history unless the user explicitly asks.

**Event log:** From this point on, mentally maintain a short list of **notable** events per PR (CI failure + fix/rerun, CodeRabbit-driven change batches, non-trivial conflict resolution) for the post-merge summary.

## Ordering multiple PRs

Pull lightweight metadata for the whole set in one Bash batch (one `gh pr view <n> --json number,title,headRefName,baseRefName,mergeStateStatus,isDraft,additions,deletions,createdAt` per PR, or a single `gh pr list --json ...`). Then decide the processing order:

1. **Dependencies first — hard rule.** A PR is *stacked* on another when its `baseRefName` equals another in-set PR's `headRefName`. A stacked PR cannot merge cleanly until its base PR is merged, so process **base-most PRs first** (topological order). If a PR's base is an open PR that is *not* in the set, surface that and ask whether to include it.
2. **Readiness, then size, then age — tiebreakers** among PRs with no dependency between them. Prefer the PR closest to mergeable (green checks, no open actionable bot feedback), then the smaller diff (`additions + deletions`), then the older PR (lower number / earlier `createdAt`). This lands quick wins first and surfaces hard blockers early without holding up the rest.
3. **Set aside, don't abort.** Drafts (`isDraft`) and PRs blocked by required human review/policy are removed from the active order and reported at the end. Only abort the whole run if *every* PR is blocked. (Mark a draft ready for review only if the user asked.)

State the resulting order and a one-line reason for it before you start, then process the list **one PR at a time** — never merge a PR before one it depends on.

### Between PRs (after each merge)

Merging a PR moves its base branch, which can invalidate the PRs still in the queue:

- **Stacked child of the just-merged PR:** GitHub usually auto-retargets its base to the merged PR's base; confirm, and retarget manually (`gh pr edit <n> --base <branch>`) if it didn't. Update the child branch from the new base so its diff no longer shows the parent's changes.
- **Independent PRs:** if branch protection requires up-to-date branches, update each remaining PR from the advanced base; otherwise update only when a conflict or a stale-base check surfaces.
- Re-enter the Main loop for any PR whose checks or bot feedback were invalidated by the update (fresh CI, possibly a fresh CodeRabbit pass).

## Main loop (run per PR)

Run this loop for one PR at a time, in the order decided above. Track progress with the harness's task list (TodoWrite / the task tools in the CLI; the pinned task list in the Claude desktop app): a parent item per PR (in processing order), and under the active PR one item per unresolved CodeRabbit thread, one per failing check, and a final `merge` item. Re-evaluate the list after each push, since new comments or checks may surface.

Repeat until the PR is mergeable, the checks are green, and there is no remaining **actionable** bot feedback to address.

Wait for CI to register and finish after PR creation or each push. `gh pr checks <n> --watch --fail-fast --interval 30` blocks until checks complete, but CI here routinely outlasts a default 2-minute shell timeout: run it as a background command (or with an explicit timeout of at least 10 minutes) rather than letting the call time out mid-wait. CodeRabbit's initial review usually arrives within ~5 minutes of a push; do not conclude "no comments" until at least that long has passed since the most recent push.

**Desktop app:** if the Claude desktop app is already monitoring this PR (its Auto-fix / CI monitor), let it deliver CI and review events instead of running a second `gh` polling loop, and don't start `/loop` or cron watchers on top of this skill.

**Hard gate:** Never proceed to merge (or claim the PR is ready) until CodeRabbit feedback has been explicitly fetched and reviewed after the most recent push. If CodeRabbit is delayed, keep waiting and re-checking; do not bypass this gate due to time. A rate-limited CodeRabbit is not "delayed forever": recover as described below.

### Comments and review threads

CodeRabbit spreads its feedback over three places; read all three after every push. Fetch them (plus `gh pr view <n> --json headRefOid,mergeStateStatus,mergeable` and `gh pr checks <n>`) in one Bash batch. The commands paginate (`--paginate`) and return **complete** bodies with only HTML comments stripped: never truncate a body before deciding nothing actionable remains, because outside-diff comments and nitpicks sit deep inside long review bodies. To save context, filter by author and by commit/resolution state, not by length:

```bash
# 1. Walkthrough / status comment: rate-limit notices and "Review skipped" text live here.
gh api --paginate "repos/{owner}/{repo}/issues/<n>/comments?per_page=100" \
  --jq '.[] | select((.user.login // "")|test("coderabbit")) | {updated_at, body: (.body|gsub("<!--[^>]*-->";""))}'
# 2. Review bodies: "Actionable comments posted: N", plus nitpicks and
#    "Outside diff range" comments that never become inline threads.
gh api --paginate "repos/{owner}/{repo}/pulls/<n>/reviews?per_page=100" \
  --jq '.[] | select((.user.login // "")|test("coderabbit")) | {commit_id, submitted_at, body: (.body|gsub("<!--[^>]*-->";""))}'
# 3. Unresolved inline threads, with EVERY comment in each (CodeRabbit often follows up
#    in a reply, e.g. "this still misses X"). REST cannot tell resolved from unresolved; GraphQL can.
gh api graphql --paginate -F o='{owner}' -F r='{repo}' -F n=<n> -f query='
  query($o:String!,$r:String!,$n:Int!,$endCursor:String){repository(owner:$o,name:$r){pullRequest(number:$n){
    reviewThreads(first:100,after:$endCursor){pageInfo{hasNextPage endCursor}
      nodes{id isResolved isOutdated path line
        comments(first:100){totalCount pageInfo{hasNextPage endCursor}
          nodes{author{login} createdAt url body}}}}}}}' \
  --jq '.data.repository.pullRequest.reviewThreads.nodes[]
        | select((.isResolved|not)
                 and (any(.comments.nodes[]; (.author.login // "")|test("coderabbit")) or .comments.pageInfo.hasNextPage))
        | {id, path, line, isOutdated, totalComments: .comments.totalCount,
           moreComments: .comments.pageInfo.hasNextPage, commentsCursor: .comments.pageInfo.endCursor,
           comments: [.comments.nodes[] | {author: (.author.login // "ghost"), createdAt, url, body: (.body|gsub("<!--[^>]*-->";""))}]}'
```

Read the **whole** comment list of each thread, newest last: the latest CodeRabbit reply is what decides whether the thread is still open. `--paginate` walks the thread pages; comments inside a thread come 100 at a time. A thread with `moreComments: true` is kept even if no CodeRabbit comment is in its first page, so fetch the rest from `commentsCursor` (`node(id:"<id>"){... on PullRequestReviewThread{comments(first:100,after:"<commentsCursor>"){pageInfo{hasNextPage endCursor} nodes{author{login} body url}}}}`, repeating until `hasNextPage` is false), then apply the CodeRabbit filter before judging it.

- **CodeRabbit:** treat feedback as CodeRabbit when the author login contains `coderabbit` (REST shows `coderabbitai[bot]`, GraphQL shows `coderabbitai`). The filters default a missing author (deleted account) to an empty login, because `null | test(...)` would abort the whole query.
- **Has it reviewed the latest push?** Yes when a CodeRabbit review's `commit_id` equals the PR's `headRefOid`, or when its walkthrough comment's `updated_at` is after the push and says the review finished. Keep polling until one of those is true.
- **Misleading statuses** (all seen on this repo):
  - Check passes with **"Review skipped"** → CodeRabbit usually still reviewed. Read the comments; never merge on the status alone.
  - Check passes with **"Review rate limited"** → **no review ran.** The walkthrough comment says "Review limit reached" with a retry window ("Next review available in: N minutes"). Wait out the window, then `gh pr comment <n> --body "@coderabbitai review"` and poll ~5 minutes for the review. Do not enable CodeRabbit's paid usage-based reviews, and do not merge on the rate-limited pass.
  - **Docstring Coverage** pre-merge warning (~0% vs 80%) → non-blocking on this codebase, which documents with inline comments. Ignore it; don't add docstrings to satisfy it.
- For each actionable item (bug, correctness, security, suggestion that fixes CI or clears a defect), wherever it came from (inline thread, outside-diff comment, or review body): `Read` the referenced file, apply the minimal fix in the file's own idiom with `Edit`, stage just that file, and commit with a one-line message that references the thread (e.g., `address coderabbit: handle null branch_name`).
- Skip subjective nits or large refactors unless the user asked to clear **all** comments. Outdated threads (`isOutdated: true`) on code you have since changed usually need no further action.

### Merge conflicts

- Update from the base branch (merge or rebase per repo convention). Resolve conflicts when the intended change is clear.
- If conflict intent is ambiguous, **stop and ask**; do not guess.

### CI

- If checks fail: inspect failures (`gh pr checks`, `gh run list`, `gh run view --log-failed`).
- **Fix** with small scoped changes when the failure is real; push and let CI rerun.
- **Rerun** failed jobs (`gh run rerun <run-id> --failed`) when a retry is appropriate (e.g., transient flake) and no code change is needed.
- Classify infra/transient vs. real breakage before spending large edits.

### Exit conditions for the loop

- `mergeable` / merge state is clean (no conflicts).
- All six required checks listed under **This repo** are successful for the latest head commit.
- CodeRabbit comments/reviews were fetched and reviewed after the latest push (hard requirement, regardless of delay); a rate-limited pass does not count.
- No unresolved CodeRabbit (or similar) items remain that were committed-to — or any disagreement/uncertainty is documented with the user.
- Every file-based merge gate under **This repo** is satisfied, or the PR is stopped and waiting on the user.

## Merge

When the loop conditions are met:

```bash
gh pr merge <n> --squash --match-head-commit <validated-head-sha>
```

`<validated-head-sha>` is the `headRefOid` the checks, file gates, and CodeRabbit review above were all evaluated against. If the merge is rejected because the head moved (for example, a push landed while you waited for a remote go-ahead), re-run the Main loop on the new head before trying again; never drop the flag to force the merge through.

In a remote / non-interactive run, get the explicit go-ahead from the **Remote / non-interactive runs** gate above *before* running this.

This repo squash-merges (see **This repo**); on another repo, use `--merge` if its standard is merge commits (check recent merged-PR history if unsure). Confirm the merge succeeded (`gh pr view <n> --json state,mergeCommit`).

**Head branch:** if the repo's "Automatically delete head branches" setting is on, GitHub already removed it. Otherwise delete the remote branch after a confirmed merge unless the user asked to keep it: `gh api -X DELETE "repos/{owner}/{repo}/git/refs/heads/<branch>"`. Prefer this over `gh pr merge --delete-branch`, which also tries to switch and delete the local branch and errors when the branch is checked out in a worktree.

**Watch the deploy.** Merging pushes to `main`, which runs CI again and then the `deploy` job (GitHub Pages). Both the CI and Native build workflows run on that push, and other pushes can land at the same time, so find this merge's CI run by workflow and merge commit: `gh run list --workflow CI --branch main --event push --commit <mergeCommit-sha> --json databaseId,status,conclusion` (the SHA from `gh pr view <n> --json mergeCommit`). If it hasn't registered yet, wait briefly and re-query. Then wait for that run in the background (`gh run watch <run-id> --exit-status`). If `deploy` fails at `actions/deploy-pages` with "Deployment failed, try again later", that is GitHub-side and transient: `gh run rerun <run-id> --failed`. A re-run redeploys the run's ORIGINAL commit, but the deploy job's "Skip if a newer commit has already deployed" step checks that commit against the full `github-pages` deployment history (every `SUCCESS` or `INACTIVE` deployment, all pages) inside the serialized `pages` group and skips the deploy if any newer commit has already deployed, so a stale re-run cannot roll the site back. Read that step's output, not just the job status:
  - **Skip notice** (job still green) → `main` has moved on; report the newer push's deploy instead (`gh run list --workflow CI --branch main --event push --commit <tip-sha>`, tip from `gh api repos/{owner}/{repo}/commits/main --jq .sha`).
  - **"Could not read the Pages deployment history"** (job red) → the check fails closed rather than guess; `gh run rerun <run-id> --failed` is safe because the check runs again. A red `e2e` on `main` blocks the deploy; triage it like any CI failure (the flake tracker issue logs main-branch flakes). Report the deploy outcome in the recap.

With more than one PR, after a successful merge run the **Between PRs** steps above, then start the Main loop on the next PR in the order. Continue until the queue is empty (every PR merged or set aside). You can start the next PR's loop while the previous merge's deploy is still running, but check its outcome before the final recap.

## Post-merge summary (mandatory)

Output a **compact** recap of notable events. For a single PR, do this immediately after its merge. For multiple PRs, output **one** recap at the very end of the whole run (not after each merge), grouped by PR.

- Use a bullet or short numbered list.
- For a multi-PR run, **lead with the processing order and its one-line rationale** (e.g. "did #148 before #150 because #150 was stacked on it"), then a short sub-list per PR.
- **Each distinct event:** at most **two sentences** — first sentence = what happened; second = how it was resolved.
- Group related CodeRabbit fixes into **one** item if they were handled in a single pass; use **separate** items if there were separate CI/review cycles.
- **Call out anything set aside** — drafts, PRs blocked by required review/policy, and PRs stopped at a merge gate (migration / function deploy) — with the exact blocker, so the user knows what still needs them.
- **State the deploy outcome** for each merge (deployed, re-run after a transient failure, or blocked and why).
- Omit noise (e.g., "lint passed on first try"). If nothing notable happened on a PR, say so in one line.

## Anti-patterns

- No `git add .` / `git add -A` unless the user explicitly asked for that.
- No drive-by refactors while fixing CI.
- Do not bypass branch protection or required reviews by asking for unsafe workarounds.
- Do not use `--no-verify` to skip hooks.
- Do not merge, or report merge-ready, before explicitly reading CodeRabbit comments/reviews for the latest push.
- Do not merge a PR containing `supabase/migrations/**` or `supabase/functions/**` changes without the user confirming the deploy order; never run `supabase db push` or `supabase functions deploy` yourself.
- Do not merge a stacked PR before the PR it depends on, and do not reorder around a dependency to chase a quick merge.
- With multiple PRs, do not abort the whole run because one PR is blocked — set it aside and continue with the rest.

## Related

This skill is the full PR lifecycle and is invoked explicitly via `/pr-babysit-merge`. For comment-only or CI-only triage without opening or merging a PR, ask for that directly instead of invoking this skill.
