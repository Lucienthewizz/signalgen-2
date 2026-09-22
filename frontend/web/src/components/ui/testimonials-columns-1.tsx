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
              <article
                className="testimonial-marquee__card"
                key={`${setIndex}-${testimonial.role}`}
              >
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
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
