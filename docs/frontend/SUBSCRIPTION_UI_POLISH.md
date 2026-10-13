# Subscription UI refinement

The package page keeps the existing backend contract and approved capacities.
Rule and stock-universe capacity are displayed as aligned definition-list rows;
features remain individually identified with included/excluded states. The Free,
Analyst and Pro order is unchanged. Current access still comes from the server.

Guest access is a compact Empty state with a working sign-in action. Cancellation
and downgrade explanations remain available behind disclosure controls. Copy is
Indonesian; manual activation is explicit and no checkout is implied.

Styles were edited in the existing subscription section, without adding a second
override layer. Decorative hover edge sweeps were removed. Reduced motion remains
supported. No backend, database or environment files were changed.

Verification: frontend typecheck, 64 unit/contract tests, production build,
Impeccable layout detector, and Playwright CLI capacity/layout checks at 1440px and
390px in both themes. Browser capacity checks use the public catalog; authenticated
subscription cancellation was not exercised against a real account.
