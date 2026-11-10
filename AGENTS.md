# Skill usage workflow

Always check the available skill catalog before starting a task. When a skill matches the requested work, use it and read its `SKILL.md` before applying its instructions. Explicitly requested skills must be consulted. Apply skills proportionately to the task. The two writing skills in the mandatory final review below apply to every task; select other skills according to the work.

- Use `ponytail` for coding, fixes, refactoring, code reviews, and dependency choices. Prefer the smallest complete solution that satisfies the request and required verification.
- Use `ui-ux-pro-max` for UI/UX design, implementation, and review, including accessibility, responsive layouts, typography, colors, and interaction states.
- Use `scroll-craft` when the request involves scroll-driven experiences, cinematic or layered heroes, scrollytelling, or bespoke landing-page motion. Keep motion aligned with the requested scope and support reduced-motion preferences.
- Use `no-ai-slop` when editing or reviewing writing for clarity, voice, and generic AI phrasing. This skill primarily concerns writing quality; it does not replace UI design guidance.
- Use `unslop` for natural writing, humanization, voice matching, or removal of AI tone. Combine its guidance with `no-ai-slop` in the mandatory final review below. Preserve facts and the user's intended meaning.
- Use other relevant installed skills for their supported tasks, including the frontend and codebase skills required below. These five skills are not an exhaustive list.
- Briefly announce which skill(s) are being applied and why the first time they are used in the conversation. Only claim use after reading and following the applicable instructions.
- If a required skill is missing or inaccessible, check the configured skill locations, disclose the limitation, and use an available fallback when it can safely complete the task. Do not install skills, enable integrations, upload files, or change accounts without authorization.
- Follow user instructions and higher-priority requirements when skill guidance conflicts. Do not expand the task, redesign unrelated UI, or add dependencies solely because a skill suggests them.

# Mandatory final writing review

For every user prompt, apply both `no-ai-slop` and `unslop` before sending the final answer. After implementing a feature or fix, also review any user-facing prose created or changed by the task, such as UI labels, error messages, help text, and documentation. Read both skills before their first use in the conversation and follow their applicable guidance on subsequent turns.

1. Use `no-ai-slop` to remove filler, repetition, vague claims, and generic AI phrasing. Follow its applicable evaluation checklist. Keep wording that is already clear.
2. Use `unslop` at balanced intensity unless the user requests otherwise, to make the text natural and appropriate for its audience. Both reviews are required, but do not force two full rewrites when no changes are needed.
3. Check that the final wording preserves facts, citations, technical meaning, uncertainty, and verification results. Keep executable code, identifiers, commands, exact quotations, and literal tool output intact. Write commits and PRs in normal technical language.
4. Complete this review before committing and pushing any affected prose. If editing changes files after verification, rerun the relevant checks before delivery. Keep the final answer concise; include editing commentary only when useful or requested.

Use the current draft as the review input; do not ask the user to provide a separate draft for this automatic review. This is a writing review, not a reason to redesign unrelated UI, modify working logic, invent evidence, or claim a feature is complete without verification. A later user instruction to skip or disable either skill overrides this default.

# Git delivery workflow

The user has requested automatic GitHub delivery for future updates made by the agent in this project.

- Create a descriptive `frontend/<feature-name>` branch for each new frontend feature, without a `codex/` prefix. Continue related follow-up fixes on its feature branch unless the user requests otherwise.
- After completing the requested work and relevant verification, commit only task-related changes and push the feature branch to `origin` without asking for routine confirmation again.
- Do not merge into or push directly to the main/default branch unless explicitly requested. Never force-push without explicit authorization.
- Never commit `.env` files, credentials, tokens, runtime databases, local caches, or unrelated changes. Preserve local environment files during pull/merge operations.
- Check the staged diff and credential exposure before committing. Report verification failures and any push blocker truthfully; do not claim success before the remote ref is verified.
- A newer user instruction such as “do not push” or “local only” overrides this standing preference.

# Website update workflow

The user requests the installed frontend skills and CLI tools as the default workflow for every website update.

- Use `frontend-design`, `impeccable`, `apple-design`, and `shadcn` for frontend work, reading their applicable instructions before implementation. Preserve Signalgen's established clean visual identity; Apple guidance informs interaction quality, not an unsolicited visual redesign.
- Use `codebase-memory` and its graph-first discovery and coverage checks when exploring or tracing the implementation.
- Use Context7 MCP (`context7-mcp`) for current library, framework, SDK, API, and CLI documentation before relying on library-specific syntax or configuration.
- Use DESIGNmd CLI to consult relevant design-system references. Do not overwrite the project's design system or upload project files without an explicit request. Keep API keys outside the repository and tool output.
- Use Playwright CLI for scoped browser verification when available and permitted by the active browser/tool policies. Verify affected flows, responsive layouts, and light/dark themes where relevant; do not claim browser verification when it could not run.
- Apply these tools proportionately to the change. Disclose unavailable tools or blocked checks rather than silently claiming they were used. Do not perform unrelated redesigns, installs, account changes, or external uploads as a side effect.
- After implementation and relevant verification, follow the Git delivery workflow above and push only task-related changes to `frontend/<feature-name>`.

# Interface skills from jakubkrehel/skills

Use the installed skills from `jakubkrehel/skills` alongside the website workflow above, selecting the skills relevant to the requested work. Read their `SKILL.md` and applicable references before use. Preserve Signalgen's existing components, design tokens, architecture, and product voice.

- Use `better-interface` for a requested review of a screen or flow across accessibility, layout, writing, typography, colors, and UI polish. Load its domain skills as instructed and report only what the evidence supports.
- Use `better-accessibility` for keyboard navigation, focus, accessible names, forms, screen-reader behavior, reduced motion, and zoom.
- Use `better-layout` for grouping, alignment, reading order, responsive structure, and space for translated text.
- Use `better-typography` for type scale, spacing, wrapping, truncation, and font features; use `better-colors` for semantic color tokens, palettes, and contrast.
- Use `better-ui` for surfaces, icons, interaction states, shadows, and animation. Use `better-writing` for labels, errors, empty states, confirmations, and other interface copy, followed by the mandatory final writing review above.
- Use `build-design` when implementing a supplied Figma design or design image. Use `teardown` when the user requests a technical illustration or an explanation through illustrated layers or parts.
- Keep `interface-review`, `explain-interface`, `break`, `state-machine`, `variant`, and `afk` user-invoked, as their skill metadata requires. Installing this collection does not itself invoke them or authorize unattended feature work. Apply them when the user specifically requests the corresponding workflow.
- For a completed UI feature, use the relevant domain skills to check the affected surface and states within the task's scope. Do not automatically invoke user-only workflows or expand into a whole-product audit. Verify visual and runtime claims with the relevant browser checks; disclose checks that could not run.
- Do not install optional dependencies, enable plugins, or upload project data solely because a skill mentions them. If a required reference, tool, or integration is unavailable, disclose it and qualify the affected result instead of claiming full coverage.
