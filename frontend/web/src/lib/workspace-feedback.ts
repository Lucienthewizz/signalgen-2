import type {
  RuleCondition,
  ScreenerFeatureVector,
  ScreenerDecision,
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
  prevFeatures?: ScreenerFeatureVector | null,
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

  // Crossover memerlukan dua candle. Data lama yang kehilangan candle sebelumnya
  // tidak boleh ditampilkan sebagai kondisi false seolah-olah sudah terverifikasi.
  let previous: { left: number; right: number } | undefined;
  if (condition.op === "CROSS_UP" || condition.op === "CROSS_DOWN") {
    if (!prevFeatures) return null;
    const previousValues: Record<string, number> = {
      PRICE: prevFeatures.price,
      EMA9: prevFeatures.ema9,
      EMA20: prevFeatures.ema20,
      RSI14: prevFeatures.rsi14,
    };
    const prevLeft = previousValues[condition.left];
    const prevRight =
      typeof condition.right === "number"
        ? condition.right
        : previousValues[condition.right];
    if (!Number.isFinite(prevLeft) || !Number.isFinite(prevRight)) return null;
    previous = { left: prevLeft, right: prevRight };
  }
  let passed = false;
  switch (condition.op) {
    case ">":
      passed = left > right;
      break;
    case ">=":
      passed = left >= right;
      break;
    case "<":
      passed = left < right;
      break;
    case "<=":
      passed = left <= right;
      break;
    case "CROSS_UP":
      passed = Boolean(
        previous && previous.left <= previous.right && left > right,
      );
      break;
    case "CROSS_DOWN":
      passed = Boolean(
        previous && previous.left >= previous.right && left < right,
      );
      break;
    default:
      return null;
  }

  return {
    label: `${condition.left} ${condition.op} ${condition.right}`,
    left,
    right,
    passed,
    ...(previous ? { previous } : {}),
  };
}

/** Match adalah status lolos rule; BUY/SELL adalah arah yang ditentukan rule.
 * Riwayat lama tanpa signal_type tidak cukup untuk menyimpulkan BUY. */
export function decisionLabel(
  decision: Pick<ScreenerDecision, "matched" | "signal_type" | "reason_codes">,
) {
  if (!decision.matched)
    return decision.reason_codes.includes("COOLDOWN_ACTIVE")
      ? "Cooldown"
      : "Not matched";
  return decision.signal_type === "BUY" || decision.signal_type === "SELL"
    ? decision.signal_type
    : "Matched";
}

export function decisionReasons(reasons: string[], logic?: "AND" | "OR") {
  if (!reasons.length) return "No decision reason was provided.";
  return reasons
    .map((reason) => {
      if (reason === "RULE_MATCHED")
        return logic === "OR"
          ? "At least one condition met."
          : logic === "AND"
            ? "All conditions met."
            : "Rule matched.";
      if (reason === "CONDITIONS_NOT_MET")
        return logic === "OR"
          ? "No conditions met."
          : logic === "AND"
            ? "At least one condition was not met."
            : "Rule conditions were not met.";
      if (reason === "COOLDOWN_ACTIVE")
        return "Rule conditions met, but the repeat-signal cooldown is active.";
      return reason.toLowerCase().replaceAll("_", " ");
    })
    .join(" ");
}

export function decisionDescription(
  decision: Pick<ScreenerDecision, "matched" | "signal_type" | "reason_codes">,
) {
  const label = decisionLabel(decision);
  if (decision.matched)
    return label === "Matched"
      ? "Matched rule · signal direction unavailable"
      : `Matched rule · ${label} signal (not an order)`;
  return label === "Cooldown"
    ? "Rule conditions met · signal withheld by cooldown"
    : "Did not match rule";
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
