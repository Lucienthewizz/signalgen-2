import type { RuleCondition, UserRuleDefinition } from "@/types";

import { indicatorLabel, isIndicator, thresholdError } from "./indicators";
export { indicatorLabels } from "./indicators";

export const operatorLabels = {
  ">": "is above",
  ">=": "is at or above",
  "<": "is below",
  "<=": "is at or below",
  CROSS_UP: "crosses above",
  CROSS_DOWN: "crosses below",
};
export const operatorSymbols: Record<RuleCondition["op"], string> = {
  ">": ">",
  ">=": "≥",
  "<": "<",
  "<=": "≤",
  CROSS_UP: "↗",
  CROSS_DOWN: "↘",
};
export const rulePresets: {
  id: string;
  name: string;
  description: string;
  definition: UserRuleDefinition;
}[] = [
  {
    id: "bullish-cross",
    name: "Bullish EMA cross",
    description: "EMA 9 moves from at or below EMA 20 to above it.",
    definition: {
      name: "Bullish EMA cross",
      signal_type: "BUY",
      logic: "AND",
      cooldown_sec: 300,
      conditions: [{ left: "EMA9", op: "CROSS_UP", right: "EMA20" }],
    },
  },
  {
    id: "bearish-cross",
    name: "Bearish EMA cross",
    description: "EMA 9 moves from at or above EMA 20 to below it.",
    definition: {
      name: "Bearish EMA cross",
      signal_type: "SELL",
      logic: "AND",
      cooldown_sec: 300,
      conditions: [{ left: "EMA9", op: "CROSS_DOWN", right: "EMA20" }],
    },
  },
  {
    id: "rsi-low",
    name: "RSI below 30",
    description: "Find stocks with RSI 14 below a threshold you can adjust.",
    definition: {
      name: "RSI below 30",
      signal_type: "BUY",
      logic: "AND",
      cooldown_sec: 300,
      conditions: [{ left: "RSI14", op: "<", right: 30 }],
    },
  },
  {
    id: "rsi-high",
    name: "RSI above 70",
    description: "Find stocks with RSI 14 above a threshold you can adjust.",
    definition: {
      name: "RSI above 70",
      signal_type: "SELL",
      logic: "AND",
      cooldown_sec: 300,
      conditions: [{ left: "RSI14", op: ">", right: 70 }],
    },
  },
  {
    id: "price-cross",
    name: "Price breakout",
    description:
      "The close price crosses above EMA 20 between two daily candles.",
    definition: {
      name: "Price breakout",
      signal_type: "BUY",
      logic: "AND",
      cooldown_sec: 300,
      conditions: [{ left: "PRICE", op: "CROSS_UP", right: "EMA20" }],
    },
  },
  {
    id: "trend",
    name: "Trend confirmation",
    description: "Require both a rising EMA structure and price above EMA 9.",
    definition: {
      name: "Trend confirmation",
      signal_type: "BUY",
      logic: "AND",
      cooldown_sec: 300,
      conditions: [
        { left: "EMA9", op: ">", right: "EMA20" },
        { left: "PRICE", op: ">", right: "EMA9" },
      ],
    },
  },
];

export function conditionSummary(condition: RuleCondition) {
  const right =
    typeof condition.right === "number"
      ? String(condition.right)
      : indicatorLabel(condition.right);
  return `${indicatorLabel(condition.left)} ${operatorLabels[condition.op] ?? condition.op} ${right}`;
}

export function ruleSummary(definition?: UserRuleDefinition) {
  if (!definition?.conditions.length)
    return "Add a condition to describe this screen.";
  return `${definition.signal_type || "BUY"} when ${definition.logic === "OR" ? "any" : "all"} of these daily conditions match: ${definition.conditions.map(conditionSummary).join(definition.logic === "OR" ? "; or " : "; and ")}.`;
}

export function validateRule(definition: UserRuleDefinition) {
  const name = !definition.name.trim()
    ? "Enter a rule name."
    : new TextEncoder().encode(definition.name.trim()).length > 100
      ? "Use a name of at most 100 bytes."
      : "";
  const cooldown =
    !Number.isInteger(definition.cooldown_sec) ||
    definition.cooldown_sec < 0 ||
    definition.cooldown_sec > 86400
      ? "Use whole seconds from 0 to 86,400."
      : "";
  const conditions = definition.conditions.map((condition) => {
    if (!isIndicator(condition.left) || !(condition.op in operatorLabels))
      return "Choose a supported indicator and comparison.";
    if (typeof condition.right === "string") {
      if (!isIndicator(condition.right))
        return "Choose a Claudio indicator (period/history 1–250) or a number.";
      if (condition.right === condition.left)
        return "Choose a different reference; an indicator cannot compare with itself.";
    } else if (!Number.isFinite(condition.right))
      return "Enter a finite number.";
    else return thresholdError(condition.left, condition.right);
    return "";
  });
  const count =
    definition.conditions.length < 1 || definition.conditions.length > 20
      ? "Use between 1 and 20 conditions."
      : "";
  return {
    name,
    cooldown,
    conditions,
    count,
    valid: !name && !cooldown && !count && conditions.every((error) => !error),
  };
}
