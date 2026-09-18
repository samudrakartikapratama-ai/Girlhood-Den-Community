# CLAUDE.md — Girlhood Den Community

Working guidelines for Claude (or any AI coding agent) on this repo. Merged from three sources skp uses:
- Karpathy coding guidelines (github.com/multica-ai/andrej-karpathy-skills)
- Emil Kowalski's design/animation principles (github.com/emilkowalski/skills)
- taste-skill anti-slop frontend framework (github.com/Leonxlnx/taste-skill) — scope note below

## 1. Think Before Coding
Don't assume. Don't hide confusion. Surface tradeoffs.
- State assumptions explicitly. If uncertain, ask instead of guessing.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop, name what's confusing, and ask.

## 2. Simplicity First
Minimum code that solves the problem. Nothing speculative.
- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If 200 lines could be 50, rewrite it.

## 3. Surgical Changes
Touch only what you must. Clean up only your own mess.
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.
- Remove imports/variables/functions your own change made unused; don't remove pre-existing dead code unless asked.
- Every changed line should trace directly to the request.

## 4. Goal-Driven Execution
Define success criteria. Loop until verified.
- "Add validation" → "write tests for invalid inputs, then make them pass"
- "Fix the bug" → "write a test that reproduces it, then make it pass"
- For multi-step tasks, state a brief plan with a verify step per item.

## 5. Animation & UI Polish (dashboard — this repo)
This repo is a multi-role dashboard app (Brand / Creator / Internal), not a marketing site.
- Animate specific CSS properties, never `transition: all`.
- Entrances use `ease-out` with a strong custom cubic-bezier (CSS defaults are too weak). Never `ease-in` — it feels sluggish.
- Keep UI animation durations under ~300ms (buttons 100–160ms, dropdowns/popovers 150–250ms, modals 200–500ms).
- Buttons get an `:active` press state (e.g. slight scale-down) so presses feel confirmed.
- Popovers scale from their trigger origin; modals stay centered.
- Skip animation entirely for high-frequency actions (keyboard shortcuts, frequent toggles) — it makes them feel slower.

## 6. taste-skill (landing pages only — NOT this dashboard)
taste-skill is explicitly scoped to landing pages / portfolios / marketing sites and excludes dashboards and data tables. It does not apply to the Girlhood Den Community app itself. Only use it if/when a separate public marketing or landing page is built for Girlhood Den. If used: state a one-line "design read" (page kind, audience, vibe, aesthetic family) before generating, and avoid generic AI-default look (purple gradients, centered hero over dark mesh, three equal feature cards, Inter + slate-900).
