import { type PointerEvent } from "react";
import { ArrowRight, Check } from "lucide-react";
import { AccountMenu } from "@/components/account-menu";
import { Brand } from "@/components/brand";
import { FeatureFigure } from "@/components/feature-figure";
import { MarketTrace } from "@/components/market-trace";
import { SignalLattice } from "@/components/signal-lattice";
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
import type { User } from "@/types";

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

function setFeatureTilt(event: PointerEvent<HTMLAnchorElement>) {
  if (event.pointerType === "touch") return;
  const bounds = event.currentTarget.getBoundingClientRect();
  const x = (event.clientX - bounds.left) / bounds.width - 0.5;
  const y = (event.clientY - bounds.top) / bounds.height - 0.5;
  event.currentTarget.style.setProperty("--feature-tilt-x", `${y * -7}deg`);
  event.currentTarget.style.setProperty("--feature-tilt-y", `${x * 9}deg`);
}

function resetFeatureTilt(event: PointerEvent<HTMLAnchorElement>) {
  event.currentTarget.style.setProperty("--feature-tilt-x", "0deg");
  event.currentTarget.style.setProperty("--feature-tilt-y", "0deg");
}

export function PublicWorkspace({
  backendOnline,
  user,
  onLogout,
}: {
  backendOnline: boolean;
  user: User | null;
  onLogout: () => void | Promise<void>;
}) {
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
              {user && (
                <AccountMenu
                  user={user}
                  onLogout={onLogout}
                  variant="landing"
                />
              )}
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
            <div className="landing-stage landing-stage--black">
              <SignalLattice />
            </div>
            <div className="landing-stage landing-stage--green landing-stage--footer">
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
                  {capabilityViews.map((feature, index) => (
                    <a
                      className="feature-gallery__item"
                      href={`#app/${feature.id}`}
                      key={feature.id}
                      onPointerMove={setFeatureTilt}
                      onPointerLeave={resetFeatureTilt}
                    >
                      <div className="feature-gallery__figure">
                        <span className="feature-gallery__index">
                          FIG 0.{index + 1}
                        </span>
                        <div className="feature-gallery__depth">
                          <FeatureFigure kind={feature.id} />
                        </div>
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
            </div>
            <div className="landing-stage landing-stage--black">
              <Pricing />
            </div>
            <div className="landing-stage landing-stage--green">
              <section className="rating-section" id="reviews">
                <div className="rating-context">
                  <h3>What Signalgen feels like in practice.</h3>
                  <p>
                    Cards move horizontally and pause on hover or touch. These
                    are demo profiles for UX review, not verified testimonials.
                  </p>
                </div>
                <TestimonialsMarquee testimonials={sampleRatings} />
              </section>
            </div>
            <div className="landing-stage landing-stage--black">
              <section className="faq-section" id="faq">
                <div className="faq-intro">
                  <h3>Answers before you begin.</h3>
                  <p>
                    Essential details about product scope, demo data, and the
                    web MVP.
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
            </div>
            <div className="landing-stage landing-stage--green landing-stage--footer">
              <footer className="landing-footer" aria-label="Signalgen footer">
                <div className="landing-footer__main">
                  <a href="#home" aria-label="Signalgen home">
                    <Brand compact />
                  </a>
                  <nav aria-label="Footer navigation">
                    <a href="#capabilities">Features</a>
                    <a href="#pricing">Pricing</a>
                    <a href="#faq">FAQ</a>
                    <a href="#app/overview">Demo</a>
                    <a href="#creators">Creators</a>
                  </nav>
                </div>
                <div className="landing-footer__legal">
                  <span>© 2026 Signalgen</span>
                  <span>Privacy</span>
                  <span>Terms</span>
                  <span>Not investment advice.</span>
                </div>
              </footer>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
