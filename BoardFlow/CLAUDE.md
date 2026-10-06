# CLAUDE.md --- Autonomous Build Instructions

## Mission

Build BoardFlow according to `SPEC.md` with minimal human intervention.

Your job is not to generate as much code as possible. Your job is to
leave behind the most complete, tested, understandable, runnable product
possible.

## Fixed Stack

Use: - .NET 10 - C# - Avalonia UI - SQLite - Dapper - Serilog - xUnit -
Microsoft.Extensions.DependencyInjection

Do not replace Dapper with EF Core. Do not replace Serilog with another
logging framework unless the human explicitly changes the specification.

## Model and Agent Strategy

Use a **lead-agent + focused sub-agent** approach.

### Lead Agent --- Opus

Use Opus as the primary engineering lead when available.

Responsibilities: - Read and understand the complete specification. -
Plan milestones and architectural direction. - Decide how work should be
decomposed. - Delegate bounded tasks to sub-agents. - Integrate
changes. - Resolve conflicts between approaches. - Perform
milestone-level validation. - Maintain `PROGRESS.md`. - Perform final
architectural and product review.

Prefer high reasoning/effort for architecture, difficult debugging,
milestone planning, and final review when the environment exposes that
option.

### Implementation Agent --- Sonnet

Prefer Sonnet for substantial, clearly scoped implementation work.

Good delegation targets: - A Dapper repository or service - A defined
Avalonia view/view-model - A CRUD workflow - Search/filter
implementation - Tests for an already-defined component - Refactoring a
bounded area - Investigating and fixing a reproducible defect

Give each implementation agent: - Exact scope - Relevant files -
Acceptance criteria - Required tests/build checks - Clear instruction
not to modify unrelated areas

### Lightweight Agent --- Haiku

Use Haiku selectively for small, mechanical, low-risk tasks when
available.

Good delegation targets: - Documentation cleanup - Simple repetitive
test cases - Small codebase searches - Straightforward configuration
checks - Summarizing build/test output - Finding obvious dead code or
TODOs

Do not delegate architectural decisions or complex debugging to Haiku
merely to save tokens.

### Independent Review Agent

For important milestones, use a fresh sub-agent context---preferably
Opus or Sonnet---to review the implementation independently.

Ask the reviewer to look for: - Missed acceptance criteria - Data-loss
risks - Dapper/SQLite correctness - Ordering bugs - UI state bugs -
Missing validation - Weak or misleading tests - Error-handling gaps -
Unnecessary complexity

The reviewer should report findings. The lead agent decides and
integrates fixes.

## Delegation Rules

-   Delegate work only when it creates useful parallelism, isolates
    context, or provides an independent review.
-   Do not spawn agents merely because agents are available.
-   Keep delegated tasks bounded and independently verifiable.
-   Avoid having multiple agents edit the same files concurrently.
-   The lead agent owns architectural consistency and final integration.
-   Sub-agent output is not trusted automatically; inspect and verify
    it.
-   A sub-agent may propose a change, but the lead agent remains
    responsible for build and test results.
-   Prefer one strong agent working sequentially over unsafe parallel
    edits.
-   Never allow delegation to become a reason to skip acceptance
    criteria.

## Required Startup Procedure

Before modifying code: 1. Read `SPEC.md` completely. 2. Read
`PROGRESS.md`. 3. Read `SCORECARD.md`. 4. Inspect the repository and
current git status. 5. Determine the first unfinished milestone. 6.
Verify whether existing code already satisfies any acceptance criteria
before changing it. 7. Decide which work should be handled directly and
which, if any, should be delegated.

If the repository is empty, begin with Milestone 1.

## Autonomous Work Loop

For each milestone:

1.  Review requirements and acceptance criteria.
2.  Inspect the relevant existing implementation.
3.  Make a small implementation plan.
4.  Decide whether focused sub-agents would improve speed, context
    isolation, or review quality.
5.  Delegate only bounded tasks with explicit acceptance criteria.
6.  Implement/integrate the milestone.
7.  Build the affected projects.
8.  Run relevant tests.
9.  Exercise or inspect the feature as realistically as available
    tooling permits.
10. Fix failures and regressions.
11. Re-run build and tests.
12. Use an independent review agent for substantial milestones when
    useful.
13. Address valid review findings.
14. Review the final diff for correctness, unnecessary complexity,
    data-loss concerns, and accidental changes.
15. Check every acceptance criterion individually.
16. Update `PROGRESS.md` truthfully.
17. Commit the completed milestone if git is configured and commits are
    appropriate.
18. Continue to the next unfinished milestone without asking for
    permission.

Do not stop simply because one milestone is complete.

## Stop Conditions

Stop and leave a detailed entry in `PROGRESS.md` only when: - A
requirement requires a product decision that cannot reasonably be
inferred from `SPEC.md`. - Required credentials, secrets, licenses,
hardware, or unavailable external access are necessary. - Continuing
would risk destructive data loss outside the project. - A
tooling/environment failure remains after reasonable troubleshooting. -
Usage/session limits prevent continued work. - All required milestones
and final validation are complete.

Do not treat ordinary implementation choices as blockers. Choose a
conventional approach, document the decision, and continue.

## Decision Principles

When multiple valid choices exist: 1. Prefer the simplest maintainable
solution. 2. Prefer standard .NET 10/Avalonia conventions. 3. Use Dapper
for persistence and Serilog for logging. 4. Prefer fewer dependencies.
5. Prefer testable business logic separated from UI concerns. 6. Prefer
local deterministic behavior. 7. Avoid speculative abstraction. 8.
Document consequential decisions.

## Quality Rules

Never: - Mark a milestone complete because it compiles. - Claim a test
was run if it was not. - Claim a UI interaction works if it was not
verified to the extent tooling allows. - Disable or delete legitimate
tests merely to obtain a green test run. - Swallow exceptions without
Serilog logging or meaningful handling. - Replace working architecture
without a concrete reason. - Add major features outside the
specification while required work remains. - Store secrets in source
control. - Silently destroy user data. - Rewrite large working areas
merely for stylistic preference. - Invent completion percentages
unsupported by acceptance criteria.

## Build and Test Discipline

After meaningful changes: - Build affected project(s). - Run focused
tests.

At milestone completion: - Build the entire solution. - Run all relevant
tests.

At final validation: - Restore from a clean state when practical. -
Build the entire solution. - Run the full test suite. - Record exact
results in `PROGRESS.md`.

Warnings should be reviewed rather than automatically ignored.

## Git Discipline

If the repository is under git: - Do not discard unrelated user
changes. - Keep commits milestone-focused. - Use descriptive commit
messages. - Do not force-push. - Do not rewrite existing history unless
explicitly instructed. - Check git status before final handoff.

Suggested commit format: `feat(milestone-N): <short description>`

## Progress Tracking

`PROGRESS.md` is the source of truth for handoff state.

After each milestone record: - Status - Acceptance criteria checked -
Major implementation notes - Which model/agent handled meaningful
delegated work - Tests/builds actually run - Known issues - Decisions
made - Next action

Use: - `[ ]` not started - `[~]` in progress/partial - `[x]` verified
complete - `[!]` blocked

Only use `[x]` after checking the milestone's acceptance criteria.

## Final Handoff

When required work is complete or a true stop condition occurs, update
`PROGRESS.md` with:

### Final Handoff

-   Completed milestones
-   Partial milestones
-   Blocked milestones
-   Build result
-   Test result, including counts when available
-   Known defects
-   Important architectural decisions
-   Meaningful sub-agent/model usage
-   Files or areas needing human review
-   Recommended next 3 actions

If all required milestones are complete, fill out `SCORECARD.md`
honestly using evidence from the repository and validation results.

## Stretch Goal Rule

Do not begin stretch goals until: - Milestones 1--10 are verified
complete, - clean build succeeds, - full tests pass or documented
unavoidable exceptions exist, - required documentation is current.

Then take stretch goals in listed order unless there is a strong
technical reason not to.
