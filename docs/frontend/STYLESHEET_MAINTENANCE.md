# Stylesheet ownership and cascade

`frontend/web/src/styles.css` is now the import manifest. Its order is intentional:

1. Tailwind and the existing resource-quota module.
2. `foundation-shell.css`: theme tokens, reset, navigation and shell.
3. `landing-base.css`: original public landing layout.
4. `auth-workspace-base.css`: authentication, original workspace, theme adapters.
5. `workspace-surfaces.css`: connected resources, subscription, feedback and public refinements.
6. `news-journal-details.css`: news, journal and associated workspace detail styles.
7. `workspace-compatibility.css`: later screener/monitor, responsive and admin refinements.

This is an order-preserving extraction, not a claim that every historical override
has been consolidated. Some earlier public/workspace refinements remain mixed;
moving selectors freely between files would change their precedence.

For new work, edit the owning section instead of appending a second override.
Use existing semantic theme tokens; keep related responsive and reduced-motion
rules together. If relocating rules, compare compiled CSS and visually check both
themes before delivery. Relative asset URLs must be rebased when moving files.

The initial extraction was verified by reconstructing the exact original source
body and comparing the production CSS before and after. Automated tests check the
manifest order, independent parsing, duplicate/hidden imports and unsafe relative
asset relocation. Browser regression checks cover packages and news at desktop
and mobile sizes. No backend or database changes are included.
