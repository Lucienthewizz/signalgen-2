import { useState } from "react";
import { Check, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

const plans = [
  {
    name: "Free",
    monthlyPrice: "0",
    annualPrice: "0",
    note: "Explore the Signalgen workflow with static demo data.",
    badge: "Demo",
    featured: false,
    features: [
      "Demo workspace",
      "Local fixture data",
      "Rule and result previews",
    ],
    action: "Open demo",
    href: "#app/overview",
  },
  {
    name: "Analyst",
    monthlyPrice: "79.000",
    annualPrice: "69.000",
    note: "A complete toolkit for building and testing an analysis workflow.",
    badge: "Recommended",
    featured: true,
    features: ["Full screening", "Custom rules and backtests", "Trade journal"],
    action: "Choose Analyst",
    href: "#register",
  },
  {
    name: "Pro",
    monthlyPrice: "159.000",
    annualPrice: "139.000",
    note: "Higher limits for more intensive analysis workflows.",
    badge: "Higher limits",
    featured: false,
    features: [
      "Everything in Analyst",
      "Advanced features and exports",
      "Priority data and support",
    ],
    action: "Choose Pro",
    href: "#register",
  },
] as const;

export function Pricing() {
  const [annual, setAnnual] = useState(true);

  return (
    <section className="pricing-section" id="pricing">
      <div className="pricing-section__heading">
        <h3>Choose access that fits your analysis.</h3>
        <p>
          Start with the demo, move into the complete workflow, and increase
          your limits as your needs grow.
        </p>
        <div className="pricing-billing">
          <span className={!annual ? "active" : ""}>Monthly</span>
          <Switch
            checked={annual}
            onCheckedChange={setAnnual}
            aria-label="Use annual pricing"
          />
          <span className={annual ? "active" : ""}>Annual</span>
          <Badge variant="secondary">Save up to 13%</Badge>
        </div>
      </div>

      <div className="pricing-card">
        {plans.map((plan) => (
          <article
            className={cn(
              "pricing-plan",
              plan.featured && "pricing-plan--featured",
            )}
            key={plan.name}
          >
            <div className="pricing-plan__meta">
              <h4>{plan.name}</h4>
              <Badge variant={plan.featured ? "default" : "secondary"}>
                {plan.badge}
              </Badge>
            </div>
            <p>{plan.note}</p>
            <div className="pricing-plan__price">
              <span>Rp</span>
              <strong key={`${plan.name}-${annual}`}>
                {annual ? plan.annualPrice : plan.monthlyPrice}
              </strong>
              <small>/ month</small>
            </div>
            <span className="pricing-plan__billing-note">
              {plan.name === "Free"
                ? "No payment required"
                : annual
                  ? "Billed annually"
                  : "Billed monthly"}
            </span>
            <ul>
              {plan.features.map((feature) => (
                <li key={feature}>
                  <Check aria-hidden="true" /> {feature}
                </li>
              ))}
            </ul>
            <a
              className={cn(
                buttonVariants({
                  variant: plan.featured ? "default" : "outline",
                  size: "lg",
                }),
                "pricing-plan__action",
              )}
              href={plan.href}
            >
              {plan.action}
            </a>
          </article>
        ))}
      </div>

      <p className="pricing-section__assurance">
        <ShieldCheck aria-hidden="true" /> Pricing is a UI simulation; checkout
        is not enabled yet.
      </p>
    </section>
  );
}
