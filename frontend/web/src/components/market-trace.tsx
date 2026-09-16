export function MarketTrace() {
  return (
    <div
      className="market-trace"
      aria-label="Ilustrasi jejak verifikasi signal"
    >
      <div className="market-trace__axis" aria-hidden="true">
        <span>RULE</span>
        <span>DATA</span>
        <span>STATE</span>
        <span>SIGNAL</span>
      </div>
      <svg
        viewBox="0 0 680 260"
        role="img"
        aria-label="Rule bergerak melalui data dan state menuju signal terverifikasi"
      >
        <defs>
          <linearGradient id="trace-line" x1="0" x2="1">
            <stop stopColor="#168f5a" />
            <stop offset="1" stopColor="#7af5bd" />
          </linearGradient>
          <linearGradient id="trace-area" x1="0" x2="0" y1="0" y2="1">
            <stop stopColor="#45e69f" stopOpacity=".18" />
            <stop offset="1" stopColor="#45e69f" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          className="trace-grid"
          d="M0 42H680M0 101H680M0 160H680M0 219H680"
        />
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
      <div className="market-trace__legend">
        <span>
          <i /> Rule state
        </span>
        <strong>Explainable by design</strong>
      </div>
    </div>
  );
}
