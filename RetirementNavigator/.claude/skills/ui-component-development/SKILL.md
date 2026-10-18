---
name: ui-component-development
description: Build or change a Retirement Navigator React page or component (apps/web) with shadcn/ui, Tailwind v4, React Hook Form + engine Zod schemas, Zustand and accessibility built in. Use for any UI work in apps/web.
---
# UI component development

## Checklist
1. Place code in `apps/web/src/features/<page>/` (page-specific) or `apps/web/src/components/` (shared).
   shadcn primitives live in `apps/web/src/components/ui/`.
2. Forms: React Hook Form + `zodResolver(<engine schema>)`; field-level error text linked with
   `aria-describedby`; every field has a label, a tooltip for financial terms, and a plain-language example.
3. Sliders always pair with a synchronized numeric input.
4. Numbers come from the engine (`@rn/engine`); never compute financial formulas in components.
5. Respect the dollar-basis toggle (today's vs nominal) and show "Unverified rule" for outputs that
   depend on excluded features.
6. Accessibility: keyboard reachable, visible focus ring, contrast AA in light and dark, no color-only
   meaning, chart data table alternative.
7. Disclaimers where results appear; descriptive (not directive) wording.
8. Tests: React Testing Library `*.test.tsx` beside the component (render, validation messages,
   readouts, keyboard).
9. Verify visually: run the Playwright screenshot script, read the PNGs (desktop + 390px mobile, light + dark).

## References
- Design principles: `.claude/agents/ui-ux-designer.md`
- Architecture/data flow: `docs/architecture.md`
