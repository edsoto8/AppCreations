---
name: code-quality-review
description: End-of-milestone quality gate for Retirement Navigator — run pnpm verify, the code-reviewer agent, screenshot checks and STATUS.md handoff before tagging. Use at the end of every milestone or before any push that claims a feature done.
---
# Code quality review (milestone gate)

## Checklist
1. `pnpm verify` green (typecheck, lint, tests with coverage thresholds, build, preview smoke).
2. Delegate a review to the `code-reviewer` agent with the milestone diff (`git diff <prev-tag>..HEAD`).
   Resolve blocking findings; record the rest in `docs/STATUS.md`.
3. Milestone gates from `docs/BRIEF.md` §11 (plus the added gates in STATUS.md) each have a passing test
   or a recorded artifact.
4. Screenshots (desktop + mobile, light + dark, print where relevant) taken with Playwright and read back.
5. Docs updated in the same milestone: financial-model.md, assumptions.md, architecture.md,
   testing-strategy.md, user-guide.md, rules-verification.md as applicable.
6. `docs/STATUS.md`: per-feature status (`done` / `simplified` / `unverified rule` / `not started`),
   actual test summaries, limitations, Handoff (next steps, frozen contracts, open risks).
7. Never-cut items present: disclaimers, rule sourcing + unverified flags, privacy + CSP, input validation,
   accessibility basics.
8. Commit, tag (`m<N>-<name>`), push branch and tag.
