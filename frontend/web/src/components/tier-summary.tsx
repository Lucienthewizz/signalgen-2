import { ChevronRight } from "lucide-react";
import type { EffectiveAccess } from "@/types";
import { tierName } from "@/lib/tier-access";

/** Presentation only. Protected actions always recheck access on the server. */
export function TierSummary({
  access,
  variant,
  collapsed = false,
}: {
  access: EffectiveAccess;
  variant: "sidebar" | "screener";
  collapsed?: boolean;
}) {
  const name = tierName(access.plan_code);
  const daily =
    access.screening.timeframes.length === 1 &&
    access.screening.timeframes[0] === "1d";
  const intervals = daily ? "Daily candles" : "Supported intervals";
  const rules = access.screening.system_rules_only
    ? "System rule"
    : "Personal rules";
  const grant = access.source === "manual_grant";
  if (variant === "sidebar")
    return (
      <a
        className="sidebar-plan"
        data-collapsed={collapsed || undefined}
        href="#app/subscription"
        aria-label={`Plan & access: ${name}`}
        title={`${name} · Up to ${access.screening.max_symbols} stocks · ${intervals}`}
      >
        <span className="sidebar-plan__compact" aria-hidden="true">
          {name.slice(0, 1)}
        </span>
        <span className="sidebar-plan__content">
          <span className="sidebar-plan__heading">
            <span className="plan-label">Plan &amp; access</span>
            <ChevronRight aria-hidden="true" />
          </span>
          <span className="sidebar-plan__limit">{name} · Active</span>
          <span className="sidebar-plan__detail">
            {grant
              ? "Operator grant active"
              : `${daily ? "Daily" : "All intervals"} · ${rules}`}
          </span>
        </span>
      </a>
    );
  return (
    <section className="screener-plan" aria-label="Screening plan">
      <div className="screener-plan__summary">
        <span className="plan-label">{name} plan</span>
        <ul aria-label="Screening limits">
          <li>Up to {access.screening.max_symbols} stocks</li>
          <li>{intervals}</li>
          <li>{rules}</li>
        </ul>
        {grant && <small>Operator grant active</small>}
      </div>
      <a href="#app/subscription">
        View plans
        <ChevronRight aria-hidden="true" />
      </a>
    </section>
  );
}
