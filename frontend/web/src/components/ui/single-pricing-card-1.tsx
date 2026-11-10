import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { api } from "@/api/client";
import { monthlyPrice } from "@/lib/tier-access";
import type { SubscriptionPlan } from "@/types";

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
        <h3>Start screening. Grow your analysis.</h3>
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
              (a, b) =>
                ["free", "analyst", "pro"].indexOf(a.code) -
                ["free", "analyst", "pro"].indexOf(b.code),
            )
            .map((plan) => (
              <article
                key={plan.code}
                className={`pricing-plan ${plan.code === "analyst" ? "pricing-plan--featured" : ""}`}
              >
                <div className="pricing-plan__meta">
                  <h4>{plan.name}</h4>
                  {plan.code === "analyst" && <span>Personal screening</span>}
                </div>
                <p>{plan.description}</p>
                <div className="pricing-plan__price">
                  <strong>
                    {plan.pricing
                      ? monthlyPrice(plan.pricing.amount)
                      : "See plan details"}
                  </strong>
                  <small>/ month</small>
                </div>
                <span className="pricing-plan__billing-note">
                  {plan.code === "free"
                    ? "No payment required"
                    : "One-month activation by operator"}
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
                  className="ui-button ui-button--primary pricing-plan__action"
                  href={
                    plan.code === "free" ? "#register" : "#app/subscription"
                  }
                >
                  {plan.code === "free"
                    ? "Coba screening gratis"
                    : "Ajukan aktivasi"}
                </a>
              </article>
            ))}
        </div>
      )}
      <p className="pricing-trust-note">
        Periodic Yahoo updates, subject to provider availability. Automatic
        billing and licensed real-time data are not included.
      </p>
    </section>
  );
}
