import PixelCard from "@/components/react-bits/PixelCard";
import { useVisualPreferences } from "@/lib/visual-preferences";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

export type TestimonialItem = {
  quote: string;
  role: string;
  score: string;
  initials: string;
};

export function TestimonialsMarquee({
  className,
  testimonials,
}: {
  className?: string;
  testimonials: TestimonialItem[];
}) {
  const { light, reduced } = useVisualPreferences();
  return (
    <div className={cn("testimonial-marquee", className)}>
      <div className="testimonial-marquee__track">
        {[0, 1].map((setIndex) => (
          <div
            className="testimonial-marquee__set"
            aria-hidden={setIndex === 1}
            key={setIndex}
          >
            {testimonials.map((testimonial) => (
              <PixelCard
                key={`${setIndex}-${testimonial.role}-${reduced}`}
                className="testimonial-pixels"
                colors={["#010907", "#064c35", "#064c35"]}
                glowColor="#010907"
                gap={5}
                pixelSize={2}
                speed={35}
                opacity={0.35}
                fade={0.7}
                radius={14}
                intro={false}
                noFocus={setIndex === 1}
                theme={light ? "light" : "dark"}
              >
                <article className="testimonial-marquee__card">
                  <header>
                    <span className="testimonial-marquee__avatar">
                      {testimonial.initials}
                    </span>
                    <span>
                      <strong>{testimonial.role}</strong>
                      <small>Demo profile</small>
                    </span>
                    <span className="testimonial-marquee__score">
                      <Star aria-hidden="true" />
                      {testimonial.score}
                    </span>
                  </header>
                  <blockquote>“{testimonial.quote}”</blockquote>
                </article>
              </PixelCard>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
