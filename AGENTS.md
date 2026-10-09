# Git delivery workflow

The user has requested automatic GitHub delivery for future updates made by the agent in this project.

- Create a descriptive `frontend/<feature-name>` branch for each new frontend feature, without a `codex/` prefix. Continue related follow-up fixes on its feature branch unless the user requests otherwise.
- After completing the requested work and relevant verification, commit only task-related changes and push the feature branch to `origin` without asking for routine confirmation again.
- Do not merge into or push directly to the main/default branch unless explicitly requested. Never force-push without explicit authorization.
- Never commit `.env` files, credentials, tokens, runtime databases, local caches, or unrelated changes. Preserve local environment files during pull/merge operations.
- Check the staged diff and credential exposure before committing. Report verification failures and any push blocker truthfully; do not claim success before the remote ref is verified.
- A newer user instruction such as “do not push” or “local only” overrides this standing preference.
