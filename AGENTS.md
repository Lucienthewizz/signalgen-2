# Skill usage workflow

Always check the available skill catalog before starting a task. When a skill matches the requested work, use it and read its `SKILL.md` before applying its instructions. Explicitly requested skills must be consulted. Apply skills proportionately to the task. The two writing skills in the mandatory final review below apply to every task; select other skills according to the work.

- Use `ponytail` for coding, fixes, refactoring, code reviews, and dependency choices. Prefer the smallest complete solution that satisfies the request and required verification.
- Use `ui-ux-pro-max` for UI/UX design, implementation, and review, including accessibility, responsive layouts, typography, colors, and interaction states.
- Use `scroll-craft` when the request involves scroll-driven experiences, cinematic or layered heroes, scrollytelling, or bespoke landing-page motion. Keep motion aligned with the requested scope and support reduced-motion preferences.
- Use `no-ai-slop` when editing or reviewing writing for clarity, voice, and generic AI phrasing. This skill primarily concerns writing quality; it does not replace UI design guidance.
- Use `unslop` for natural writing, humanization, voice matching, or removal of AI tone. Combine its guidance with `no-ai-slop` in the mandatory final review below. Preserve facts and the user's intended meaning.
- Use `humanizer` when drafting or revising substantial prose, matching a supplied voice, or removing AI writing patterns. Apply its embedded mode when it supports another task, and file mode when editing a named file. Coordinate it with the mandatory writing reviews in one pass; preserve facts, citations, commands, and code.
- Use other relevant installed skills for their supported tasks, including the frontend and codebase skills required below. This skill list is not exhaustive.
- Briefly announce which skill(s) are being applied and why the first time they are used in the conversation. Only claim use after reading and following the applicable instructions.
- If a required skill is missing or inaccessible, check the configured skill locations, disclose the limitation, and use an available fallback when it can safely complete the task. Do not install skills, enable integrations, upload files, or change accounts without authorization.
- Follow user instructions and higher-priority requirements when skill guidance conflicts. Do not expand the task, redesign unrelated UI, or add dependencies solely because a skill suggests them.

# Automatic routing for future prompts

These rules apply to every task in this repository, including a new conversation opened here. The user can describe the desired result without naming skills or repeating this workflow. Personal skill installations are shared across projects; these project rules apply within this repository.

- At the start of a task, read the applicable `AGENTS.md` files and check the current skill catalog. Select skills from the requested outcome and affected surface, then read their entrypoints and only the references needed for the task. A skill installed on disk may require the next turn or a new session to appear in the catalog; disclose discovery failures.
- For implementation or fixes, use `ponytail`; for structural exploration, use `codebase-memory` with its coverage checks. For frontend work, follow the website workflow below and select relevant interface domain skills. For backend-only work, use the relevant backend and security guidance.
- For documents, PDFs, spreadsheets, presentations, Supabase, or connected services, select the corresponding available skill. For writing, use the writing skills above and the mandatory final review. Consult `SKILLS_GUIDE.md` for examples; its list is not exhaustive.
- An explicit skill request takes priority in selection. Preserve user-invoked restrictions on specialized workflows. Installing skills does not start audits, background agents, hooks, redesigns, or registry/component installation.
- Resolve overlapping guidance using the user's current request, applicable project rules, and the existing implementation. Keep the established design tokens, components, content, and architecture unless the requested change requires modifying them. Newer library examples must be checked against the project's installed versions before use.
- Announce the selected skills briefly once, carry out the authorized work, and verify the affected behavior. Keep the final reply focused on the result, actual checks, and material limitations; a list of skills used is not evidence of success.

# Task completion and skill selection

1. Establish the requested outcome and acceptance checks from the prompt and project context. Ask only when missing information prevents meaningful progress or materially affects the result.
2. Select skills by the work they own: code discovery, implementation, design, verification, or writing. Read their applicable instructions and references. Reuse instructions already read in the conversation unless they changed or need refreshing. The practical examples in `SKILLS_GUIDE.md` supplement the available skill catalog; they do not replace it.
3. Inspect the existing implementation and conventions before changing files. Use graph-first discovery and coverage checks for structural code exploration, and current documentation tools for library-specific decisions. Do not infer implemented behavior from historical plans or skill descriptions.
4. Implement the requested scope using existing components and patterns. When skills overlap, follow each relevant requirement without duplicate audits or conflicting rewrites. Preserve established product choices unless the task requires changing them.
5. Verify the behavior affected by the change. For UI work, check relevant loading, empty, error, success, keyboard, responsive, and theme states where applicable. Run appropriate project checks and scoped browser verification. A skill checklist alone is not proof that the feature works.
6. Apply both mandatory writing reviews below, then inspect the final diff for scope and credential exposure before the authorized Git delivery. Report what changed, what was actually verified, and any material blocker. Distinguish source evidence, test/runtime evidence, and assumptions. Do not promise that using a skill guarantees a satisfactory or secure result.

# Security skill selection

- Use `security-audit` for security questions, focused vulnerability reviews, and security-sensitive work such as authentication, authorization, owner/tenant isolation, untrusted input, secrets, uploads, and external callbacks. Read its instructions before use and keep ordinary feature work in guidance mode, limited to the affected boundaries.
- Run the complete audit workflow only when the user explicitly requests a codebase audit, pen test, full security review, or audit report artifacts, as defined by the skill. Installing or selecting the skill does not authorize a full audit.
- Preserve the skill's distinction between confirmed findings, unresolved candidates, and rejected claims. Require source evidence and independent verification when its full workflow calls for it; do not call a checklist deviation a vulnerability.
- Follow its execution isolation requirements. If the required sandbox controls are unavailable, inspect source and disclose the validation blocker instead of running target-controlled code outside those controls. Do not probe live or shared services as part of this workflow.

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

- Consult `frontend-design`, `impeccable`, `apple-design`, and `shadcn` for frontend work, reading their applicable instructions before implementation. Apply each within its scope: `frontend-design` for composition and implementation; `impeccable` for design direction and targeted refinement; `apple-design` for responsive feedback, spatial consistency, typography, and motion; `shadcn` for existing shadcn/ui components and composition. Preserve Signalgen's established clean visual identity.
- For `impeccable`, resolve commands from the installed skill directory and load the relevant playbook. Run its context loader when doing UI work; on failure, disclose it and read the existing project context directly as the skill instructs. Read its craft floor before UI edits. Do not enable hooks, repair design artifacts, replace `DESIGN.md`, or start an unrelated redesign as an installation side effect.
- Apply Apple interaction guidance to the requested surface using existing dependencies. Preserve keyboard operation, reduced-motion support, and existing product tokens; installing `apple-design` does not request glass surfaces, a new font, or additional animation libraries.
- For shadcn work, inspect the project's actual config, package manager, primitive library, installed components, and local customizations. Fetch current component documentation through the documented CLI and Context7 as applicable. Reuse compatible components; preview updates before applying them and preserve local changes. This installation request authorizes skills only; do not run `shadcn init`, add components, switch presets, or overwrite UI files as part of setup.
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
