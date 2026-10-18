# STATUS

Statuses: `done` · `simplified` (with limitation) · `unverified rule` · `not started`.

## Current phase
**Phase 0, awaiting approval of the frozen contracts** (second stop in the brief). No milestone code
has been written yet.

## Phase 0 deliverables
| Item | Status | Where |
|---|---|---|
| Brief saved verbatim | done | `docs/BRIEF.md` |
| Plan (architecture, gates, parallelization, rules list, traceability) | done (approved 2026-10-18) | plan presented in session; summarized below |
| Domain model (Zod + inferred types) | done (draft, typechecks) | `packages/engine/src/domain/*` |
| Frozen engine signatures (stubs) | done (draft, typechecks) | `packages/engine/src/api.ts`, `CONTRACT_VERSION 1.0.0` |
| financial-model.md / assumptions.md drafts | done (draft) | `docs/` |
| architecture / testing-strategy / roadmap | done (draft) | `docs/` |
| Rules sourcing | **blocked**: candidates only | `docs/rules-verification.md` |

## Blockers and risks
- **Rules sources are unreachable.** The network policy blocks irs.gov, ssa.gov and federalregister.gov.
  The rules files therefore start with every value `unverified`. With nearly all rules null,
  contribution limits, taxes, Roth eligibility, HSA limits, RMDs and SS claiming show as
  "Unverified rule", and the dashboard cards that depend on them show no numbers. Owner decision
  pending (see Handoff).
- **R1:** CSP is applied to the production build only, because the dev server's HMR needs a
  websocket.
- **R2:** The survivor SS model omits the survivor's own early-claim reduction (documented).
- **R3:** Sub-agent discovery from the repo root needs verifying after the agents are created.
- **R4:** Benchmarks will run on a 4-core cloud container. Phone numbers will come from emulated
  (throttled) runs.

## Feature status
Every feature in BRIEF §5 is `not started`. The traceability table is in the approved plan and is
copied into the M1 handoff.

## Contract changes
| Version | Date | Change |
|---|---|---|
| 1.0.0 | 2026-10-18 | Initial frozen contract (pending owner approval) |

## Handoff
- **Next:** after owner approval of the contracts, create the `.claude/agents` and `.claude/skills`
  and verify they are discoverable, then start M1 Foundation.
- **Frozen contracts:** `packages/engine/src/domain/*`, `packages/engine/src/api.ts`.
- **Open questions for the owner:** how to source rule values while government sites are blocked
  (allowlist the domains, accept search-excerpt values provisionally, or keep everything unverified).
