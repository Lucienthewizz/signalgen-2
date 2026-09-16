import logoLockup from "@/assets/signalgen-logo-lockup.png";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`brand ${compact ? "brand--compact" : ""}`}>
      <span className="brand__viewport">
        <img src={logoLockup} alt="Signalgen" className="brand__lockup" />
      </span>
    </span>
  );
}
