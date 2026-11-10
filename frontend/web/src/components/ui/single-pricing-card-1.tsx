import { useEffect, useState } from "react";
import { Check, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { api } from "@/api/client";
import { cn } from "@/lib/utils";
import type { SubscriptionPlan } from "@/types";

const planOrder = ["free", "analyst", "pro"];
const planBadges = {
  free: "Daily screening",
  analyst: "Personal screening",
  pro: "Historical analysis",
};
const rupiahAmount = new Intl.NumberFormat("id-ID");

// Pricing and capacity are published by the same backend as access checks.
export function Pricing() {
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    api
      .listSubscriptionPlans()
      .then((r) => {
        if (active) setPlans(r.items);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <section className="pricing-section" id="pricing">
      <div className="pricing-section__heading">
        <h3>Choose access that fits your analysis.</h3>
        <p>
          Try daily screening for free. Analyst adds your own rules; Pro adds
          historical analysis.
        </p>
      </div>
      {failed ? (
        <p role="status">
          Plan prices are unavailable.{" "}
          <a href="#app/subscription">Check plans again</a>
        </p>
      ) : !plans.length ? (
        <p role="status">Loading plans…</p>
      ) : (
        <div className="pricing-card">
          {[...plans]
            .sort(
              (a, b) => planOrder.indexOf(a.code) - planOrder.indexOf(b.code),
            )
            .map((plan) => (
              <article
                key={plan.code}
                className={cn(
                  "pricing-plan",
                  plan.code === "analyst" && "pricing-plan--featured",
                )}
              >
                <div className="pricing-plan__meta">
                  <h4>{plan.name}</h4>
                  <Badge
                    variant={plan.code === "analyst" ? "default" : "secondary"}
                  >
                    {planBadges[plan.code]}
                  </Badge>
                </div>
                <p>{plan.description}</p>
                {plan.pricing && (
                  <div className="pricing-plan__price">
                    <span>Rp</span>
                    <strong>{rupiahAmount.format(plan.pricing.amount)}</strong>
                    <small>/ month</small>
                  </div>
                )}
                <span className="pricing-plan__billing-note">
                  {plan.code === "free"
                    ? "No payment required"
                    : "Online upgrade coming soon"}
                </span>
                <ul>
                  <li>
                    <Check aria-hidden="true" />
                    {plan.screening?.max_symbols ?? 10} stocks per screen
                  </li>
                  <li>
                    <Check aria-hidden="true" />
                    {plan.limits?.custom_rules ?? 0} personal rules ·{" "}
                    {plan.limits?.stock_universes ?? 0} saved universes
                  </li>
                  <li>
                    <Check aria-hidden="true" />
                    {plan.features.includes("backtest")
                      ? "Historical analysis"
                      : "Historical analysis preview"}
                  </li>
                  <li>
                    <Check aria-hidden="true" />
                    Save your matched screening results to journal
                  </li>
                </ul>
                <a
                  className={cn(
                    buttonVariants({
                      variant: plan.code === "analyst" ? "default" : "outline",
                      size: "lg",
                    }),
                    "pricing-plan__action",
                  )}
                  href={
                    plan.code === "free" ? "#register" : "#app/subscription"
                  }
                >
                  {plan.code === "free"
                    ? "Start with Free"
                    : "View plan details"}
                </a>
              </article>
            ))}
        </div>
      )}
      <p className="pricing-section__assurance">
        <ShieldCheck aria-hidden="true" />
        Periodic Yahoo updates, subject to provider availability. Automatic
        billing and licensed real-time data are not included.
      </p>
    </section>
  );
}
