// Fixed catalog is generated from Claudio's RuleEngine by export_claudio_indicators.py.
import { claudioOperands } from "./indicator-catalog";

export const INDICATOR_CATALOG = "claudio-indicators-1";
export const dynamicFamilies = [
  "MA",
  "EMA",
  "RSI",
  "ADX",
  "SMA_VOLUME_",
  "REL_VOLUME_",
] as const;

export function operandParts(value: string) {
  const previous = value.match(/^(.+)_PREV_(\d*)$/);
  const suffix = !previous && value.endsWith("_PREV");
  const base = previous ? previous[1] : suffix ? value.slice(0, -5) : value;
  const dynamic = base.match(/^(MA|EMA|RSI|ADX|SMA_VOLUME_|REL_VOLUME_)(\d*)$/);
  return {
    base,
    offset: previous ? previous[2] : suffix ? "1" : "0",
    suffix,
    family: dynamic?.[1],
    period: dynamic?.[2],
  };
}

export function isIndicator(value: string): boolean {
  if (claudioOperands.includes(value)) return true;
  const previous = value.match(/^(.+)_PREV_([1-9]\d{0,2})$/);
  if (previous)
    return (
      Number(previous[2]) <= 250 &&
      !previous[1].endsWith("_PREV") &&
      !previous[1].includes("_PREV_") &&
      isIndicator(previous[1])
    );
  const base = value.endsWith("_PREV") ? value.slice(0, -5) : value;
  const dynamic = base.match(
    /^(MA|EMA|RSI|ADX|SMA_VOLUME_|REL_VOLUME_)([1-9]\d{0,2})$/,
  );
  return !!dynamic && Number(dynamic[2]) <= 250;
}

const names: Record<string, string> = {
  PRICE: "Close price",
  OPEN: "Open price",
  HIGH: "High price",
  LOW: "Low price",
  CLOSE: "Candle close",
  PREV_OPEN: "Previous open",
  PREV_CLOSE: "Previous close",
  MACD: "MACD (12, 26)",
  MACD_SIGNAL: "MACD signal (9)",
  MACD_HIST: "MACD histogram",
  BB_UPPER: "Bollinger upper (20, 2)",
  BB_MIDDLE: "Bollinger middle (20)",
  BB_LOWER: "Bollinger lower (20, 2)",
  BB_WIDTH: "Bollinger width",
  STOCH_K: "Stochastic %K (14)",
  STOCH_D: "Stochastic %D (14, 3)",
  ICHIMOKU_CONVERSION: "Ichimoku conversion (9)",
  ICHIMOKU_BASE: "Ichimoku base (26)",
  ICHIMOKU_A: "Ichimoku span A",
  ICHIMOKU_B: "Ichimoku span B (52)",
  VOLUME: "Volume",
  PRICE_EMA20_DIFF_PCT: "Distance from EMA 20 (ratio)",
  PATTERN_CDLDOJI: "Doji",
  PATTERN_CDLHAMMER: "Hammer",
  PATTERN_CDLSHOOTINGSTAR: "Shooting star",
  PATTERN_BULLISH_ENGULFING: "Bullish engulfing",
  PATTERN_BEARISH_ENGULFING: "Bearish engulfing",
  PATTERN_CDLMORNINGSTAR: "Morning star",
  PATTERN_CDLEVENINGSTAR: "Evening star",
  PATTERN_CDLHARAMI: "Harami",
  PATTERN_CDLPIERCING: "Piercing",
  PATTERN_CDLDARKCLOUDCOVER: "Dark cloud cover",
};

export function indicatorLabel(value: string): string {
  if (names[value]) return names[value];
  const { base, offset, family, period } = operandParts(value);
  const label = family
    ? `${family === "SMA_VOLUME_" ? "Average volume" : family === "REL_VOLUME_" ? "Relative volume" : family} ${period}`
    : (names[base] ?? base);
  return offset === "0"
    ? label
    : `${label} · ${offset} candle${offset === "1" ? "" : "s"} ago`;
}

export const indicatorLabels: Record<string, string> = Object.fromEntries(
  claudioOperands.map((value) => [value, indicatorLabel(value)]),
);

function group(value: string) {
  if (value.endsWith("_PREV") || value.startsWith("PREV_"))
    return "Previous values";
  if (value.startsWith("PATTERN_")) return "Candlestick patterns · 0 or 1";
  if (value.startsWith("EMA")) return "Exponential moving averages";
  if (/^MA\d/.test(value)) return "Simple moving averages";
  if (value.startsWith("MACD")) return "MACD";
  if (value.startsWith("RSI")) return "RSI";
  if (value.startsWith("ADX")) return "ADX";
  if (value.startsWith("BB_")) return "Bollinger bands";
  if (value.startsWith("STOCH_")) return "Stochastic";
  if (value.startsWith("ICHIMOKU_")) return "Ichimoku";
  if (value.includes("VOLUME")) return "Volume";
  if (value === "PRICE_EMA20_DIFF_PCT") return "Calculated metrics";
  return "Price and candle";
}
const grouped = claudioOperands.reduce<Record<string, string[]>>(
  (groups, value) => {
    (groups[group(value)] ??= []).push(value);
    return groups;
  },
  {},
);
export const indicatorGroups: [string, string[]][] = [
  "Price and candle",
  "Simple moving averages",
  "Exponential moving averages",
  "MACD",
  "RSI",
  "ADX",
  "Bollinger bands",
  "Stochastic",
  "Ichimoku",
  "Volume",
  "Calculated metrics",
  "Candlestick patterns · 0 or 1",
  "Previous values",
].map((name) => [name, grouped[name] ?? []]);

export function thresholdError(operand: string, value: number): string {
  const { base, family } = operandParts(operand);
  if (
    (family === "RSI" || family === "ADX" || base.startsWith("STOCH_")) &&
    (value < 0 || value > 100)
  )
    return "Oscillator thresholds must be from 0 to 100.";
  if (
    (["PRICE", "OPEN", "HIGH", "LOW", "CLOSE"].includes(base) ||
      family === "MA" ||
      family === "EMA") &&
    value <= 0
  )
    return "Price and moving average thresholds must be greater than zero.";
  return "";
}
