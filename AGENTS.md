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
