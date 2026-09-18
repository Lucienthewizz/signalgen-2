type FeatureFigureProps = {
  kind: "analysis" | "rules" | "journal" | "access";
};

const lineProps = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.2,
  vectorEffect: "non-scaling-stroke" as const,
};

export function FeatureFigure({ kind }: FeatureFigureProps) {
  if (kind === "analysis") {
    return (
      <svg viewBox="0 0 260 230" aria-hidden="true">
        <g {...lineProps}>
          <path d="M38 58 130 15l92 43-92 44Z" />
          <path d="m38 58 92 44 92-44v22l-92 44-92-44Z" opacity=".72" />
          <path d="m38 84 92 44 92-44v22l-92 44-92-44Z" opacity=".48" />
          <path d="m38 110 92 44 92-44v22l-92 44-92-44Z" opacity=".28" />
          <path d="M82 65c20-25 38 18 55-6 13-18 27 1 41-17" />
          <path d="M82 78h96" opacity=".32" />
          <circle cx="178" cy="42" r="3" />
        </g>
      </svg>
    );
  }

  if (kind === "rules") {
    return (
      <svg viewBox="0 0 260 230" aria-hidden="true">
        <g {...lineProps}>
          <path d="m130 16 54 31v62l-54 31-54-31V47Z" />
          <path d="m130 36 34 20v39l-34 20-34-20V56Z" opacity=".5" />
          <path d="M76 78H34v73l45 26" />
          <path d="M184 78h42v73l-45 26" />
          <path d="M130 140v52" />
          <rect x="18" y="145" width="61" height="38" rx="5" />
          <rect x="181" y="145" width="61" height="38" rx="5" />
          <rect x="99" y="180" width="62" height="34" rx="5" />
          <circle cx="130" cy="76" r="8" opacity=".72" />
        </g>
      </svg>
    );
  }

  if (kind === "journal") {
    return (
      <svg viewBox="0 0 260 230" aria-hidden="true">
        <g {...lineProps}>
          <path d="M52 37h126l30 30v126H52Z" opacity=".28" />
          <path d="M40 27h126l30 30v126H40Z" opacity=".55" />
          <path d="M28 17h126l30 30v126H28Z" />
          <path d="M154 17v30h30" />
          <path d="M52 73h107M52 98h107M52 123h66M52 148h88" opacity=".66" />
          <path d="m132 122 12 12 26-29" />
        </g>
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 260 230" aria-hidden="true">
      <g {...lineProps}>
        <rect x="38" y="28" width="184" height="142" rx="12" opacity=".28" />
        <rect x="52" y="41" width="156" height="116" rx="10" opacity=".52" />
        <path d="M130 54c19 13 38 15 38 15v34c0 27-18 43-38 54-20-11-38-27-38-54V69s19-2 38-15Z" />
        <path d="m113 104 12 12 24-29" />
        <path d="M82 195h96M105 170v25M155 170v25" opacity=".62" />
      </g>
    </svg>
  );
}
