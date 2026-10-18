---
name: financial-chart-development
description: Build Retirement Navigator charts with Recharts — forecast area/line charts, allocation stacks, percentile bands, scenario comparisons — with accessible data tables, theme-aware colors and correct financial labeling. Use for any chart in apps/web.
---
# Financial chart development

## Checklist
1. Data comes from engine results; convert to the selected dollar basis in a view model, not in the chart.
2. Every chart ships with a data-table alternative (toggle or disclosure), keyboard reachable, with the
   same series and units.
3. Colors from theme tokens (CSS variables) that pass contrast in light and dark; never rely on color
   alone (use pattern/label/legend text).
4. Axes: currency formatting with the basis in the axis title ("today's dollars" / "nominal dollars");
   years or ages on x with the age rule.
5. Markers: retirement, first death (couples), depletion — labeled reference lines with text.
6. Wording: optimistic/pessimistic lines are "fixed return offsets"; Monte Carlo bands are "percentile
   bands", never "confidence intervals"; success probability always shown with its assumptions and
   "Model-dependent estimate, not a guarantee."
7. Tooltips show year, age(s) and every component of the hovered row.
8. Responsive: readable at 390px width; legends wrap; no horizontal page scroll.
9. Verify with Playwright screenshots in both themes and read them back.

## References
- Projection result shape: `packages/engine/src/domain/projection.ts`
- Monte Carlo result shape: `packages/engine/src/domain/montecarlo.ts`
