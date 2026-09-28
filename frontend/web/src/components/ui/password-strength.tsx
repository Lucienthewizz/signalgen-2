import { Check } from "lucide-react";

export type PasswordRequirement = {
  id: "length" | "case" | "number" | "symbol";
  label: string;
  met: boolean;
};

export type PasswordStrength = {
  score: number;
  label: "Empty" | "Weak" | "Fair" | "Good" | "Strong";
  requirements: PasswordRequirement[];
};

const symbol = /[!-/:-@[-`{-~]/;

export function getPasswordStrength(value: string): PasswordStrength {
  const requirements: PasswordRequirement[] = [
    { id: "length", label: "8 characters or more", met: value.length >= 8 },
    {
      id: "case",
      label: "Upper and lower case",
      met: /[a-z]/.test(value) && /[A-Z]/.test(value),
    },
    { id: "number", label: "A number", met: /\d/.test(value) },
    { id: "symbol", label: "A symbol", met: symbol.test(value) },
  ];
  const score = requirements.filter((requirement) => requirement.met).length;
  const label = (["Empty", "Weak", "Fair", "Good", "Strong"] as const)[
    value.length === 0 ? 0 : score
  ];

  return { score: value.length === 0 ? 0 : Math.max(score, 1), label, requirements };
}

export function meetsPasswordRequirements(value: string) {
  return value.length >= 8;
}

export function PasswordStrengthIndicator({ value }: { value: string }) {
  const { score, label, requirements } = getPasswordStrength(value);
  const tone = score <= 1 ? "weak" : score === 2 ? "fair" : score === 3 ? "good" : "strong";

  return (
    <div className="password-strength" data-tone={tone} id="password-guidance">
      <div
        className="password-strength__meter"
        role="meter"
        aria-label="Password strength"
        aria-valuemin={0}
        aria-valuemax={4}
        aria-valuenow={score}
        aria-valuetext={label}
      >
        {requirements.map((requirement, index) => (
          <i
            aria-hidden="true"
            className={index < score ? "is-filled" : ""}
            key={requirement.id}
          />
        ))}
      </div>
      <p className="password-strength__label">{label}</p>
      <ul className="password-strength__requirements">
        {requirements.map((requirement) => (
          <li className={requirement.met ? "is-met" : ""} key={requirement.id}>
            <span aria-hidden="true">
              <Check />
            </span>
            {requirement.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
