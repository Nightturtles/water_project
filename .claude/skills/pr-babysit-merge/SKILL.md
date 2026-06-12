---
name: pr-babysit-merge
description: Full GitHub PR-lifecycle automation — attach to one or more PRs, keep CI green, address actionable CodeRabbit (and similar bot) feedback in a loop, recover from CI failures via logs and reruns, merge when mergeable, then output a brief post-merge recap. Handles a single PR or several at once in dependency-aware order. **Explicit-token invocation only:** run this skill when the user asks to run it by including the literal token `/pr-babysit-merge` in their message — whether the harness expanded it as a slash command or it arrived as plain text (e.g. a remote-control session that does not expand slash commands). Do not invoke from paraphrased intent ("babysit my PR", "merge when green"), and do not invoke when the user is only discussing or editing the skill rather than asking to run it. PR URLs/numbers (or "all my open PRs") may follow the token as arguments; otherwise resolve the PR from the current branch.
allowed-tools: Bash, Read, Edit, Write, Grep, Glob, TodoWrite
---

# PR babysit and merge

End-to-end: ensure each PR exists, keep CI green, address actionable CodeRabbit feedback, merge when safe, then summarize what happened. Works for a single PR or several at once — with multiple, it orders them sensibly (dependencies first) and merges them one at a time.

## Prerequisites

- GitHub repo; GitHub CLI installed and authenticated (`gh auth status`).
- Permission to push the PR branch and merge (per branch protection).
- If merge is blocked by **required human reviewers** or policy the bot cannot satisfy, **stop** on that PR and say exactly what is blocking; do not imply CodeRabbit fixes will unlock merge. With multiple PRs, set the blocked one aside and continue with the rest (see Ordering) rather than aborting the whole run.

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

Run this loop for one PR at a time, in the order decided above. Use TodoWrite to track progress across the whole run: a parent item per PR (in processing order), and under the active PR one item per unresolved CodeRabbit thread, one per failing required check, and a final `merge` item. Re-evaluate the list after each push, since new comments or checks may surface.

Repeat until the PR is mergeable, required checks are green, and there is no remaining **actionable** bot feedback to address.

Wait for CI to register and finish after PR creation or each push — use `gh pr checks --watch` to block until checks complete. CodeRabbit's initial review usually arrives within ~5 minutes of a push; do not conclude "no comments" until at least that long has passed since the most recent push.

**Hard gate:** Never proceed to merge (or claim the PR is ready) until CodeRabbit feedback has been explicitly fetched and reviewed after the most recent push. If CodeRabbit is delayed, keep waiting and re-checking; do not bypass this gate due to time.

### Comments and review threads

- Fetch PR data in parallel — issue `gh pr view --json ...`, `gh pr checks`, and `gh api .../pulls/<n>/comments` in a single Bash batch. Read only the JSON paths needed; do not paste full payloads back into context.
- Skip resolved threads when deciding what still needs work.
- **CodeRabbit:** Treat feedback as CodeRabbit when the comment author's login contains `coderabbit`.
- After every push, repeatedly poll CodeRabbit comments until review has clearly arrived (or updated) for that push; only then triage and continue.
- If CodeRabbit status is ambiguous (e.g., pending/skipped/no new review), fetch both issue comments and PR review comments again and confirm whether there are actionable items before proceeding.
- For each actionable comment (bug, correctness, security, suggestion that fixes CI or clears a defect): `Read` the referenced file, apply the minimal fix with `Edit`, stage just that file, and commit with a one-line message that references the thread (e.g., `address coderabbit: handle null branch_name`).
- Skip subjective nits or large refactors unless the user asked to clear **all** comments.

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
- Required status checks are successful (as defined by the repo/branch).
- CodeRabbit comments/reviews were fetched and reviewed after the latest push (hard requirement, regardless of delay).
- No unresolved CodeRabbit (or similar) items remain that were committed-to — or any disagreement/uncertainty is documented with the user.

## Merge

When the loop conditions are met:

```bash
gh pr merge --squash
```

In a remote / non-interactive run, get the explicit go-ahead from the **Remote / non-interactive runs** gate above *before* running this.

Use `--merge` instead of `--squash` if this repo's standard is merge commits (check recent merged-PR history if unsure). Add `--delete-branch` if the user wants the remote branch removed after merge. Confirm merge succeeded (`gh pr view` on the closed PR or default branch state).

With more than one PR, after a successful merge run the **Between PRs** steps above, then start the Main loop on the next PR in the order. Continue until the queue is empty (every PR merged or set aside).

## Post-merge summary (mandatory)

Output a **compact** recap of notable events. For a single PR, do this immediately after its merge. For multiple PRs, output **one** recap at the very end of the whole run (not after each merge), grouped by PR.

- Use a bullet or short numbered list.
- For a multi-PR run, **lead with the processing order and its one-line rationale** (e.g. "did #148 before #150 because #150 was stacked on it"), then a short sub-list per PR.
- **Each distinct event:** at most **two sentences** — first sentence = what happened; second = how it was resolved.
- Group related CodeRabbit fixes into **one** item if they were handled in a single pass; use **separate** items if there were separate CI/review cycles.
- **Call out anything set aside** — drafts and PRs blocked by required review/policy — with the exact blocker, so the user knows what still needs them.
- Omit noise (e.g., "lint passed on first try"). If nothing notable happened on a PR, say so in one line.

## Anti-patterns

- No `git add .` / `git add -A` unless the user explicitly asked for that.
- No drive-by refactors while fixing CI.
- Do not bypass branch protection or required reviews by asking for unsafe workarounds.
- Do not use `--no-verify` to skip hooks.
- Do not merge, or report merge-ready, before explicitly reading CodeRabbit comments/reviews for the latest push.
- Do not merge a stacked PR before the PR it depends on, and do not reorder around a dependency to chase a quick merge.
- With multiple PRs, do not abort the whole run because one PR is blocked — set it aside and continue with the rest.

## Related

This skill is the full PR lifecycle and is invoked explicitly via `/pr-babysit-merge`. For comment-only or CI-only triage without opening or merging a PR, ask for that directly instead of invoking this skill.
