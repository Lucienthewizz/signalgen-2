import markUrl from "../../public/signalgen-mark-web.png";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`brand ${compact ? "brand--compact" : ""}`}>
      <span className="brand__mark" aria-hidden="true">
        <img src={markUrl} alt="" />
      </span>
      <span>
        Signalgen <b>2.0</b>
      </span>
    </span>
  );
}
