export type DemoRule = {
  id: string;
  name: string;
  logic: string;
  version: string;
  scope: "System" | "Yours";
  enabled: boolean;
};

export type DemoTransaction = {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  fee: number;
  date: string;
};

export const demoRules: DemoRule[] = [
  {
    id: "r-momentum",
    name: "Momentum confirmation",
    logic: "Close > EMA20 · RSI(14) 52–68 · Volume > SMA20",
    version: "v1.4",
    scope: "System",
    enabled: true,
  },
  {
    id: "r-breakout",
    name: "Quiet breakout",
    logic: "Close > High(20) · ATR contraction · Volume 1.5×",
    version: "v1.1",
    scope: "System",
    enabled: true,
  },
  {
    id: "r-pullback",
    name: "Pullback test",
    logic: "Trend up · Low ≤ EMA20 · Close > Open",
    version: "draft 03",
    scope: "Yours",
    enabled: false,
  },
];

export const demoSignals = [
  {
    symbol: "BBCA",
    state: "Match",
    close: "9.675",
    score: "86",
    reason: "Trend, RSI, and volume confirmed",
  },
  {
    symbol: "TLKM",
    state: "Match",
    close: "3.180",
    score: "78",
    reason: "Valid breakout; volume is not yet optimal",
  },
  {
    symbol: "ASII",
    state: "Watch",
    close: "5.225",
    score: "64",
    reason: "Valid trend; RSI remains below the threshold",
  },
  {
    symbol: "BMRI",
    state: "No match",
    close: "6.025",
    score: "48",
    reason: "Close moved back below EMA20",
  },
];

export const initialTransactions: DemoTransaction[] = [
  {
    id: "tx-1",
    symbol: "BBCA",
    side: "BUY",
    quantity: 10,
    price: 9450,
    fee: 141,
    date: "2026-09-08",
  },
  {
    id: "tx-2",
    symbol: "TLKM",
    side: "BUY",
    quantity: 20,
    price: 3090,
    fee: 185,
    date: "2026-09-11",
  },
];

export const demoSessions = [
  {
    id: "current",
    device: "Chrome · MacBook Air",
    place: "Denpasar, ID",
    active: "Now",
    current: true,
  },
  {
    id: "secondary",
    device: "Safari · iPhone",
    place: "Denpasar, ID",
    active: "2 hours ago",
    current: false,
  },
];

export const faqItems = [
  [
    "Does Signalgen provide buy or sell recommendations?",
    "No. Signalgen helps you build rules and inspect the evidence behind a signal. Every investment decision remains yours.",
  ],
  [
    "Is the preview using live data?",
    "No. Every value in the demo workspace is static fixture data used to evaluate the workflow before the analysis API is available.",
  ],
  [
    "Can I create my own rules?",
    "Yes, within the MVP scope. Choose from supported indicators, operators, and values. System rules remain read-only, while your rules can be edited or deleted.",
  ],
  [
    "How are analysis results explained?",
    "Every result includes condition states, match reasons, assumptions, rule versions, and data quality—not just an isolated signal label.",
  ],
  [
    "Is web authentication connected?",
    "Sign-in, registration, and profile retrieval use the available authorization endpoints. API connectivity is always visible, and failures are never hidden.",
  ],
];

export const sampleRatings = [
  {
    score: "4.8",
    initials: "IA",
    role: "Active investor",
    quote:
      "The workflow is clear: I can see which rule ran and why a stock passed.",
  },
  {
    score: "4.6",
    initials: "ST",
    role: "Swing trader",
    quote:
      "The results table is dense but easy to scan, and the demo status is always clear.",
  },
  {
    score: "4.9",
    initials: "PR",
    role: "Research learner",
    quote:
      "The journal feels connected to analysis instead of added as a separate feature.",
  },
  {
    score: "4.7",
    initials: "RA",
    role: "Rule analyst",
    quote:
      "I can compare rule conditions without losing the screening context.",
  },
  {
    score: "4.8",
    initials: "PJ",
    role: "Journal user",
    quote:
      "A signal can move into a trade record without re-entering the same data.",
  },
  {
    score: "4.6",
    initials: "PM",
    role: "MVP tester",
    quote:
      "Navigation stays consistent across features, and demo data is clearly labeled.",
  },
];
