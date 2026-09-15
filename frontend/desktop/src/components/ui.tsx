import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { Search } from "lucide-react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "default" | "sm" | "icon";
}>(function Button({
  variant = "secondary",
  size = "default",
  className = "",
  children,
  ...props
}, ref) {
  return <button ref={ref} className={`ui-button ui-button--${variant} ui-button--${size} ${className}`} {...props}>{children}</button>;
});

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "success" | "warning" | "danger" | "info" }) {
  return <span className={`ui-badge ui-badge--${tone}`}><i />{children}</span>;
}

export function SearchField({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <label className={`ui-search ${className}`}><Search size={15} /><input type="search" aria-label={props["aria-label"] ?? props.placeholder ?? "Search"} {...props} /></label>;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return <div className="ui-segmented" role="group" aria-label={label}>{options.map((option) => (
    <button key={option.value} aria-pressed={value === option.value} className={value === option.value ? "is-active" : ""} onClick={() => onChange(option.value)}>{option.label}</button>
  ))}</div>;
}

export function SectionHeading({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="section-heading"><div><h2>{title}</h2><p>{description}</p></div>{action && <div className="section-heading__action">{action}</div>}</div>;
}

export function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><span>{icon}</span><h3>{title}</h3><p>{description}</p>{action}</div>;
}
