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
      <circle cx="680" cy="42" r="5" />
    </svg>
  );
}
