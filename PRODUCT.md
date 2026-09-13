# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Indonesian retail-market users who want to turn technical-analysis hypotheses into repeatable screening rules, backtests, and explainable trading signals. The public website also serves prospective users evaluating the product before using the desktop workspace.

## Product Purpose

SignalGen 2.0 helps users screen IDX stocks, build indicator-based rules, run backtests, and monitor trading signals. Success means the user can understand why a condition produced a signal rather than treating the result as a guaranteed prediction.

## Positioning

SignalGen connects readable rule logic, screening, backtesting, and signal monitoring in one workflow while keeping analytical engines and authorization in a shared Python backend.

## Operating Context

The public website explains the product and manages account access. The Electron desktop application is the primary analysis workspace. Both applications use the same FastAPI API and Supabase Auth identity.

## Capabilities and Constraints

- The repository contains exactly two frontend applications: web and desktop.
- Authentication is available through `/api/auth/register`, `/api/auth/login`, and `/api/auth/me`.
- Pricing, payment, subscription entitlement, and production downloads remain open until their backend contracts are finalized.
- SignalGen is not a broker, does not execute orders, and does not guarantee predictions or profit.
- Complete per-user authorization of operational data is still backend work in progress.

## Brand Commitments

The product name is SignalGen 2.0. Its interface should preserve the disciplined, tinted near-black, warm-red, data-first character already established by the Electron client. VASTARA is a reference for layout discipline and atmosphere only; its identity and assets are not copied.

## Evidence on Hand

The Electron interface provides the incumbent visual system and product demonstrations. No approved testimonials, customer logos, performance claims, final prices, payment provider, subscription packages, or production desktop binaries are available and none should be fabricated.

## Product Principles

- Explain the mechanism before making a claim.
- Keep one identity and one backend across web and desktop.
- Show uncertainty and incomplete capabilities honestly.
- Treat security and authorization as backend responsibilities.
- Keep market information legible during long analytical sessions.
