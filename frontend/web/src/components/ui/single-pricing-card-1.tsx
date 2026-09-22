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
    note: "Jelajahi alur Signalgen dengan data demonstrasi statik.",
    badge: "Demo",
    featured: false,
    features: [
      "Workspace demo",
      "Data fixture lokal",
      "Preview rule dan hasil",
    ],
    action: "Buka demo",
    href: "#app/overview",
  },
  {
    name: "Analyst",
    monthlyPrice: "79.000",
    annualPrice: "69.000",
    note: "Toolkit lengkap untuk membangun dan menguji proses analisis.",
    badge: "Direkomendasikan",
    featured: true,
    features: [
      "Screening penuh",
      "Custom rules dan backtest",
      "Jurnal transaksi",
    ],
    action: "Pilih Analyst",
    href: "#register",
  },
  {
    name: "Pro",
    monthlyPrice: "159.000",
    annualPrice: "139.000",
    note: "Ruang lebih besar untuk workflow analisis yang lebih intensif.",
    badge: "Batas lebih besar",
    featured: false,
    features: [
      "Semua fitur Analyst",
      "Fitur lanjutan dan ekspor",
      "Prioritas data dan support",
    ],
    action: "Pilih Pro",
    href: "#register",
  },
] as const;

export function Pricing() {
  const [annual, setAnnual] = useState(true);

  return (
    <section className="pricing-section" id="pricing">
      <div className="pricing-section__heading">
        <h3>Akses Signalgen sesuai cara Anda menganalisis.</h3>
        <p>
          Mulai dari demo, lanjutkan ke workflow analisis penuh, lalu tingkatkan
          batas saat kebutuhan Anda bertambah.
        </p>
        <div className="pricing-billing">
          <span className={!annual ? "active" : ""}>Bulanan</span>
          <Switch
            checked={annual}
            onCheckedChange={setAnnual}
            aria-label="Gunakan harga tahunan"
          />
          <span className={annual ? "active" : ""}>Tahunan</span>
          <Badge variant="secondary">Hemat hingga 13%</Badge>
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
              <small>/ bulan</small>
            </div>
            <span className="pricing-plan__billing-note">
              {plan.name === "Free"
                ? "Tidak memerlukan pembayaran"
                : annual
                  ? "Ditagihkan tahunan"
                  : "Ditagihkan bulanan"}
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
        <ShieldCheck aria-hidden="true" /> Harga masih berupa simulasi UI;
        checkout belum diaktifkan.
      </p>
    </section>
  );
}
