export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`brand ${compact ? "brand--compact" : ""}`}>
      <span className="brand__viewport">
        <img
          src="/favicon.png?v=signalgen-4"
          alt=""
          className="brand__mark"
          aria-hidden="true"
        />
        <strong className="brand__name">Signalgen</strong>
      </span>
    </span>
  );
}
