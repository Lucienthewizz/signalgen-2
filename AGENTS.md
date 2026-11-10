# Skill usage workflow

Always check the available skill catalog before starting a task. When a skill matches the requested work, use it and read its `SKILL.md` before applying its instructions. Explicitly requested skills must be consulted. Apply skills proportionately to the task; do not run every skill on every request.

- Use `ponytail` for coding, fixes, refactoring, code reviews, and dependency choices. Prefer the smallest complete solution that satisfies the request and required verification.
- Use `ui-ux-pro-max` for UI/UX design, implementation, and review, including accessibility, responsive layouts, typography, colors, and interaction states.
- Use `scroll-craft` when the request involves scroll-driven experiences, cinematic or layered heroes, scrollytelling, or bespoke landing-page motion. Keep motion aligned with the requested scope and support reduced-motion preferences.
- Use `no-ai-slop` when editing or reviewing writing for clarity, voice, and generic AI phrasing. This skill primarily concerns writing quality; it does not replace UI design guidance.
- Use `unslop` when the user requests more natural writing, humanization, voice matching, or removal of AI tone. If it overlaps with `no-ai-slop`, choose the most relevant skill or combine only complementary guidance without redundant rewrite passes. Preserve facts and the user's intended meaning.
- Use other relevant installed skills for their supported tasks, including the frontend and codebase skills required below. These five skills are not an exhaustive list.
- Briefly announce which skill(s) are being applied and why the first time they are used in the conversation. Only claim use after reading and following the applicable instructions.
- If a required skill is missing or inaccessible, check the configured skill locations, disclose the limitation, and use an available fallback when it can safely complete the task. Do not install skills, enable integrations, upload files, or change accounts without authorization.
- Follow user instructions and higher-priority requirements when skill guidance conflicts. Do not expand the task, redesign unrelated UI, or add dependencies solely because a skill suggests them.

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
