const candles = [
  { x: 34, open: 218, close: 208, high: 201, low: 224, volume: 18 },
  { x: 62, open: 207, close: 212, high: 203, low: 219, volume: 24 },
  { x: 90, open: 214, close: 198, high: 191, low: 219, volume: 29 },
  { x: 118, open: 198, close: 187, high: 180, low: 204, volume: 22 },
  { x: 146, open: 188, close: 193, high: 182, low: 201, volume: 31 },
  { x: 174, open: 194, close: 176, high: 169, low: 199, volume: 37 },
  { x: 202, open: 178, close: 165, high: 158, low: 184, volume: 28 },
  { x: 230, open: 164, close: 169, high: 157, low: 176, volume: 33 },
  { x: 258, open: 170, close: 151, high: 144, low: 175, volume: 44 },
  { x: 286, open: 153, close: 140, high: 132, low: 159, volume: 35 },
  { x: 314, open: 139, close: 145, high: 134, low: 151, volume: 40 },
  { x: 342, open: 146, close: 127, high: 120, low: 151, volume: 48 },
  { x: 370, open: 129, close: 116, high: 109, low: 135, volume: 42 },
  { x: 398, open: 115, close: 121, high: 108, low: 128, volume: 51 },
  { x: 426, open: 122, close: 103, high: 96, low: 127, volume: 58 },
  { x: 454, open: 105, close: 92, high: 85, low: 110, volume: 49 },
  { x: 482, open: 93, close: 98, high: 87, low: 104, volume: 56 },
  { x: 510, open: 99, close: 78, high: 70, low: 104, volume: 66 },
  { x: 538, open: 80, close: 68, high: 61, low: 86, volume: 61 },
  { x: 566, open: 67, close: 73, high: 62, low: 80, volume: 73 },
  { x: 594, open: 74, close: 54, high: 47, low: 79, volume: 82 },
  { x: 622, open: 55, close: 43, high: 36, low: 61, volume: 77 },
  { x: 650, open: 44, close: 35, high: 27, low: 50, volume: 88 },
] as const;

export function MarketTrace() {
  return (
    <svg
      className="market-trace"
      viewBox="0 0 680 260"
      preserveAspectRatio="none"
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="trace-line" x1="0" x2="1">
          <stop stopColor="#174d35" />
          <stop offset="1" stopColor="#58c98c" />
        </linearGradient>
        <linearGradient id="trace-area" x1="0" x2="0" y1="0" y2="1">
          <stop stopColor="#3f9e70" stopOpacity=".24" />
          <stop offset="1" stopColor="#102b1e" stopOpacity="0" />
        </linearGradient>
        <pattern
          id="trace-grid"
          width="68"
          height="52"
          patternUnits="userSpaceOnUse"
        >
          <path className="trace-grid__line" d="M 68 0 L 0 0 0 52" />
        </pattern>
      </defs>
      <rect className="trace-grid" width="680" height="260" />
      <path
        className="trace-area"
        d="M0 217 C72 210 88 181 143 187 S229 133 288 148 S377 95 431 113 S518 56 567 78 S634 34 680 42 V260 H0Z"
      />
      <path
        className="trace-line"
        d="M0 217 C72 210 88 181 143 187 S229 133 288 148 S377 95 431 113 S518 56 567 78 S634 34 680 42"
      />
      <g className="trace-volume">
        {candles.map((candle) => (
          <rect
            key={`volume-${candle.x}`}
            className={candle.close < candle.open ? "is-up" : "is-down"}
            x={candle.x - 6}
            y={260 - candle.volume * 0.42}
            width="12"
            height={candle.volume * 0.42}
          />
        ))}
      </g>
      <g className="trace-candles">
        {candles.map((candle) => {
          const up = candle.close < candle.open;
          return (
            <g
              key={candle.x}
              className={up ? "trace-candle is-up" : "trace-candle is-down"}
            >
              <line
                x1={candle.x}
                x2={candle.x}
                y1={candle.high}
                y2={candle.low}
              />
              <rect
                x={candle.x - 5}
                y={Math.min(candle.open, candle.close)}
                width="10"
                height={Math.max(4, Math.abs(candle.open - candle.close))}
                rx="1.5"
              />
            </g>
          );
        })}
      </g>
      <circle cx="680" cy="42" r="5" />
    </svg>
  );
}
