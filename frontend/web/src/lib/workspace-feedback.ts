import type {
  RuleCondition,
  ScreenerFeatureVector,
  Subscription,
} from "@/types";
export function screeningFailure(error: {
  status?: number;
  code?: string;
  message?: string;
}) {
  if (error.status === 401)
    return {
      title: "Sign in again",
      detail: "Your session has expired. Sign in before retrying.",
      action: "login",
    };
  if (error.status === 403)
    return {
      title: "Screening access needs attention",
      detail: "Check your plan or ask an operator to restore screening access.",
      action: "subscription",
    };
  if (error.status === 429)
    return {
      title: "Too many requests",
      detail: "Wait a moment, then retry the same rule and universe.",
      action: "retry",
    };
  if (error.status === 404)
    return {
      title: "Rule or universe not found",
      detail: "Reload the rules and stock universes, then choose again.",
      action: "resources",
    };
  if (error.status === 0)
    return {
      title: "Connection interrupted",
      detail:
        "Check your connection and that the backend is running, then retry.",
      action: "retry",
    };
  return {
    title: "Screening could not finish",
    detail:
      error.message ||
      "The server could not evaluate this screen. Retry with the same selection.",
    action: "retry",
  };
}
export function conditionEvidence(
  condition: RuleCondition,
  features: ScreenerFeatureVector,
) {
  const values: Record<string, number> = {
    PRICE: features.price,
    EMA9: features.ema9,
    EMA20: features.ema20,
    RSI14: features.rsi14,
  };
  const left = values[condition.left];
  const right =
    typeof condition.right === "number"
      ? condition.right
      : values[condition.right];
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  const passed =
    condition.op === ">"
      ? left > right
      : condition.op === ">="
        ? left >= right
        : condition.op === "<"
          ? left < right
          : left <= right;
  return {
    label: `${condition.left} ${condition.op} ${condition.right}`,
    left,
    right,
    passed,
  };
}
export function subscriptionState(
  subscription: Subscription,
  now = Date.now(),
) {
  const expired = Date.parse(subscription.current_period_end) <= now;
  const usable =
    !expired && ["active", "trialing"].includes(subscription.status);
  const labels: Record<string, string> = {
    active: "Active",
    trialing: "Trial",
    past_due: "Payment overdue",
    canceled: "Canceled",
    expired: "Expired",
  };
  return {
    usable,
    label: expired
      ? "Expired"
      : labels[subscription.status] || subscription.status,
  };
}
