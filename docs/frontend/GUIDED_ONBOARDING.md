# Guided onboarding and plan access

This delivery uses the existing API 0.19.0 Free/Analyst/Pro policy. An active
account already receives Free automatically; no new grant, beta subscription,
migration, or permission override is introduced.

- First-use dashboard shows access, eligible rule, stock universe and screening
  steps. Free users use the included system rule. The primary action follows
  the next missing prerequisite and opens screening with compatible selections.
- Universes above the current stock limit remain available for editing. They
  do not mark onboarding ready after a downgrade.
- Once a screening history entry is available, the dashboard prioritizes
  continued analysis. The checklist does not open as a modal or block navigation.
- Plan & access is visible in the sidebar, even while account reads fail, and
  in the account menu next to Devices & sessions.
- Access lookup failure offers recovery rather than claiming a missing package.
  The plan page can refresh status and reloads on focus or subscription events.
- Free users see automatic access guidance. Paid plan details explain that
  checkout is not available. Existing operator tools and paid subscriptions
  remain intact; no activation request or payment is submitted by this UI.

Verification commands from `frontend/web`:

```sh
npm test
npm run typecheck
npm run build
node scripts/test-browser.mjs --tiers
```

The browser suite intercepts external traffic and uses synthetic identities,
plans, market data and screening decisions. It covers first-use guidance,
access outages/recovery, plan/account navigation, stock selection limits,
Free/Analyst previews, paid-plan details and returning-user guidance. Responsive
checks include 1440/390/320px and dark/light CSS states. This is not a test of
real payments, cloud provisioning, Yahoo availability, or physical mobile devices.
