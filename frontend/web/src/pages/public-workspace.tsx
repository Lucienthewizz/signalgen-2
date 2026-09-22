import { useState } from "react";
import {
  ArrowRight,
  BarChart3,
  BookOpenCheck,
  Braces,
  Check,
  Gauge,
  ShieldCheck,
} from "lucide-react";
import { Brand } from "@/components/brand";
import { FeatureFigure } from "@/components/feature-figure";
import { MarketTrace } from "@/components/market-trace";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Pricing } from "@/components/ui/single-pricing-card-1";
import { TestimonialsMarquee } from "@/components/ui/testimonials-columns-1";
import { faqItems, sampleRatings } from "@/data/demo";
import { cn } from "@/lib/utils";
import type { User } from "@/types";
const productViews = [
  {
    id: "overview",
    label: "Overview",
    icon: Gauge,
  },
  {
    id: "analysis",
    label: "Analysis",
    icon: BarChart3,
  },
  {
    id: "rules",
    label: "Rules",
    icon: Braces,
  },
  {
    id: "journal",
    label: "Journal",
    icon: BookOpenCheck,
  },
  {
    id: "access",
    label: "Access",
    icon: ShieldCheck,
  },
] as const;

const capabilityViews = [
  {
    id: "analysis",
    title: "Screening & backtest",
    description:
      "Configure a run, track progress, cancel safely, and inspect every signal.",
  },
  {
    id: "rules",
    title: "Rule management",
    description:
      "Review read-only system rules and manage private rules in the builder.",
  },
  {
    id: "journal",
    title: "Journal & position",
    description:
      "Turn results into drafts, log trades, and review positions and P&L.",
  },
  {
    id: "access",
    title: "Entitlement & devices",
    description: "Review access, active devices, session controls, and cache.",
  },
] as const;

export function PublicWorkspace({
  backendOnline,
  user,
}: {
  backendOnline: boolean;
  user: User | null;
}) {
  const [selectedView, setSelectedView] = useState(0);

  return (
    <main className="workbench landing-shell">
      <section className="workspace landing-workspace">
        <header className="landing-header">
          <div className="landing-header__inner">
            <a
              className="landing-header__brand"
              href="#home"
              aria-label="Signalgen home"
            >
              <Brand compact />
            </a>
            <nav className="landing-header__nav" aria-label="Main navigation">
              <a href="#product-tour">Preview</a>
              <a href="#capabilities">Features</a>
              <a href="#pricing">Pricing</a>
              <a href="#reviews">Reviews</a>
              <a href="#faq">FAQ</a>
              <a href="#app/overview">Demo</a>
            </nav>
            <div className="landing-header__actions">
              {!user && (
                <a className="landing-header__register" href="#register">
                  Register
                </a>
              )}
              <a
                className="landing-header__session"
                href={user ? "#app/overview" : "#login"}
              >
                {user ? "Dashboard" : "Sign in"}
              </a>
            </div>
          </div>
        </header>
        <div className="workspace__content landing-content">
          <section className="market-hero">
            <div className="market-hero__chart" aria-hidden="true">
              <MarketTrace />
            </div>
            <div className="market-hero__copy">
              <span
                className={`hero-data-note ${backendOnline ? "is-online" : ""}`}
              >
                <i /> Local preview · Not live market data
              </span>
              <h2>
                Read the market.
                <br />
                <em>Verify the signal.</em>
              </h2>
              <p>
                Build rules, run screenings, and inspect the evidence behind
                every IDX signal in one focused web workspace.
              </p>
              <div className="hero-actions">
                <Button
                  className="ui-button ui-button--primary"
                  onClick={() => {
                    location.hash = "app/overview";
                  }}
                >
                  Explore the workflow <ArrowRight />
                </Button>
                <a className="ui-button" href="#capabilities">
                  View features
                </a>
              </div>
              <div className="hero-proof">
                <span>
                  <Check /> Transparent rules
                </span>
                <span>
                  <Check /> Explainable results
                </span>
                <span>
                  <Check /> Connected journal
                </span>
              </div>
            </div>
          </section>
          <div className="landing-product-flow">
            <section className="product-tour" id="product-tour">
              <div className="product-tour__heading">
                <div>
                  <h3>See the workspace before you start.</h3>
                  <p>
                    Every preview comes directly from a feature you can explore
                    now.
                  </p>
                </div>
                <a
                  href={`#app/${productViews[selectedView].id}`}
                  className="text-link"
                >
                  Open {productViews[selectedView].label} <ArrowRight />
                </a>
              </div>
              <div
                className="product-tour__tabs"
                role="tablist"
                aria-label="Web feature preview"
              >
                {productViews.map((view, index) => {
                  const Icon = view.icon;
                  return (
                    <button
                      key={view.id}
                      role="tab"
                      aria-selected={selectedView === index}
                      className={cn(
                        "product-tour__tab",
                        selectedView === index && "active",
                      )}
                      onClick={() => setSelectedView(index)}
                    >
                      <Icon aria-hidden="true" />
                      <strong>{view.label}</strong>
                    </button>
                  );
                })}
              </div>
              <figure className="product-tour__frame">
                <div className="product-tour__image">
                  <iframe
                    key={productViews[selectedView].id}
                    src={`?preview=product-tour#app/${productViews[selectedView].id}`}
                    title={`Current ${productViews[selectedView].label} view in Signalgen web`}
                    loading={selectedView === 0 ? "eager" : "lazy"}
                    tabIndex={-1}
                  />
                </div>
                <figcaption>
                  <strong>{productViews[selectedView].label}</strong>
                  <span>Live preview from the current workspace build.</span>
                </figcaption>
              </figure>
            </section>
            <section className="capability-section" id="capabilities">
              <div className="section-heading split-heading">
                <div>
                  <h3>Every core feature in one workspace.</h3>
                  <p>
                    Explore the complete PRD workflow with one consistent demo
                    dataset.
                  </p>
                </div>
                <a className="ui-button" href="#app/overview">
                  Open workspace <ArrowRight />
                </a>
              </div>
              <div className="feature-gallery">
                {capabilityViews.map((feature) => (
                  <a
                    className="feature-gallery__item"
                    href={`#app/${feature.id}`}
                    key={feature.id}
                  >
                    <div className="feature-gallery__figure">
                      <FeatureFigure kind={feature.id} />
                    </div>
                    <div className="feature-gallery__copy">
                      <strong>{feature.title}</strong>
                      <p>{feature.description}</p>
                      <span>
                        Open feature <ArrowRight />
                      </span>
                    </div>
                  </a>
                ))}
              </div>
            </section>
            <Pricing />
            <section className="rating-section" id="reviews">
              <div className="rating-context">
                <h3>What Signalgen feels like in practice.</h3>
                <p>
                  Cards move horizontally and pause on hover or touch. These are
                  demo profiles for UX review, not verified testimonials.
                </p>
              </div>
              <TestimonialsMarquee testimonials={sampleRatings} />
            </section>
            <section className="faq-section" id="faq">
              <div className="faq-intro">
                <h3>Answers before you begin.</h3>
                <p>
                  Essential details about product scope, demo data, and the web
                  MVP.
                </p>
              </div>
              <Accordion className="faq-list" defaultValue={["faq-0"]}>
                {faqItems.map(([question, answer], index) => (
                  <AccordionItem key={question} value={`faq-${index}`}>
                    <AccordionTrigger>{question}</AccordionTrigger>
                    <AccordionContent>
                      <p>{answer}</p>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </section>
            <section className="boundary-panel landing-cta">
              <ShieldCheck />
              <div>
                <h3>Analysis support, not investment advice.</h3>
                <p>
                  Start with the demo, review the complete workflow, then use
                  your account when the backend is ready.
                </p>
              </div>
              <a href="#app/overview">
                Open the demo <ArrowRight />
              </a>
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}
