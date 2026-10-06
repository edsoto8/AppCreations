# BoardFlow --- 100-Point Evaluation Scorecard

Use this after the autonomous build. Award points only for behavior or
quality supported by inspection, tests, build output, or direct use.

## 1. Core Functionality --- 35 points

  Criterion                                            Max   Score
  ----------------------------------------------- -------- -------
  Workspaces and boards CRUD + persistence               6 
  Columns CRUD + ordering + persistence                  6 
  Cards CRUD with required fields + persistence          8 
  Card movement and ordering                             6 
  Archive/restore and duplicate                          4 
  Search and filtering                                   5 
  **Subtotal**                                      **35** 

## 2. Reliability and Data Integrity --- 15 points

  Criterion                                                 Max   Score
  ---------------------------------------------------- -------- -------
  Restart preserves expected data and ordering                5 
  No observed normal-workflow data loss/duplication           4 
  Validation and destructive-action safeguards                3 
  Graceful error handling and useful Serilog logging          3 
  **Subtotal**                                           **15** 

## 3. Automated Testing --- 15 points

  Criterion                                              Max   Score
  ------------------------------------------------- -------- -------
  Meaningful domain/business-rule tests                    4 
  Dapper persistence/service tests                         4 
  Ordering/movement/search/filter tests                    4 
  Full suite passes and tests are not superficial          3 
  **Subtotal**                                        **15** 

## 4. Code and Architecture Quality --- 15 points

  Criterion                                                           Max   Score
  -------------------------------------------------------------- -------- -------
  Clear separation of concerns                                          4 
  Readable, idiomatic C#/.NET 10                                        3 
  Appropriate dependency use; no needless complexity                    3 
  Maintainable domain/Dapper/UI boundaries                              3 
  No obvious dead code, dangerous shortcuts, or secret leakage          2 
  **Subtotal**                                                     **15** 

## 5. User Experience and Visual Polish --- 10 points

  Criterion                                                       Max   Score
  ---------------------------------------------------------- -------- -------
  Clear information hierarchy and usable board layout               3 
  Consistent spacing, typography, controls, and dialogs             2 
  Useful empty/error/validation states                              2 
  Window resizing and common desktop sizes work reasonably          2 
  Keyboard/productivity interactions are usable                     1 
  **Subtotal**                                                 **10** 

## 6. Documentation and Handoff --- 10 points

  Criterion                                                 Max   Score
  ---------------------------------------------------- -------- -------
  README build/run/test instructions are accurate             3 
  PROGRESS.md truthfully reflects implementation              3 
  Architectural decisions and limitations documented          2 
  Final handoff provides actionable next steps                2 
  **Subtotal**                                           **10** 

# Total

**Score: \_\_\_\_ / 100**

## Suggested Interpretation

-   **90--100:** Strong autonomous build; close to a credible polished
    MVP.
-   **80--89:** Good result; useful application with limited cleanup
    needed.
-   **70--79:** Functional but meaningful gaps or quality issues remain.
-   **50--69:** Partial MVP; substantial human follow-up required.
-   **Below 50:** The autonomous run did not produce a dependable MVP.

## Automatic Caps

Apply these caps regardless of raw points: - Application does not build:
maximum **49/100** - Application cannot launch: maximum **49/100** -
Core data does not persist across restart: maximum **59/100** - Known
reproducible data-loss bug in normal use: maximum **59/100** - Major
milestones are claimed complete without evidence: maximum **69/100** -
EF Core replaces the required Dapper persistence approach without
explicit approval: maximum **69/100**

## Evaluator Notes

## \### Strongest areas

## \### Weakest areas

## \### Reproducible defects

## \### What the lead agent completed

## \### What sub-agents completed

## \### What required human intervention

### Next three improvements

1.  
2.  
3.  
