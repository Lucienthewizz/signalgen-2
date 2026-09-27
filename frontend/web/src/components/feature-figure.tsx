import type { ReactNode } from "react";

type FeatureFigureProps = {
  kind: "analysis" | "rules" | "journal" | "access";
};

const lineProps = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.1,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  vectorEffect: "non-scaling-stroke" as const,
};

function FigureShell({
  children,
  kind,
}: {
  children: ReactNode;
  kind: FeatureFigureProps["kind"];
}) {
  return (
    <svg
      className={`feature-figure feature-figure--${kind}`}
      viewBox="0 0 300 250"
      aria-hidden="true"
    >
      <g className="feature-figure__art" {...lineProps}>
        {children}
      </g>
    </svg>
  );
}

function AnalysisFigure() {
  return (
    <FigureShell kind="analysis">
      <g className="figure-stack figure-stack--base" opacity=".24">
        <path d="m50 115 100 50 100-50v17l-100 51-100-51Z" />
        <path d="m50 140 100 50 100-50v17l-100 51-100-51Z" />
      </g>
      <path
        className="figure-stack figure-stack--middle"
        d="m50 91 100 50 100-50v18l-100 50-100-50Z"
        opacity=".52"
      />
      <path
        className="figure-stack figure-stack--top"
        d="m50 83 100-50 100 50-100 51Z"
      />
      <path
        className="figure-contour"
        d="M93 84c10-18 29-29 57-29 27 0 47 11 57 29M91 91h118M102 101h96M115 111h70"
        opacity=".52"
      />
      <path
        className="figure-accent figure-wave"
        d="m89 91 22-12 17 8 24-25 19 19 17-7 21 17"
      />
      <circle
        className="figure-accent figure-beacon"
        cx="152"
        cy="62"
        r="3.2"
      />
      <path
        className="figure-guide"
        d="M150 134v74"
        opacity=".2"
        strokeDasharray="2 5"
      />
    </FigureShell>
  );
}

function RulesFigure() {
  return (
    <FigureShell kind="rules">
      <g className="figure-connectors" opacity=".3">
        <path d="M94 91 150 59l57 33M94 91v64l56 32m57-95v63l-57 32" />
        <path d="M150 59v128" strokeDasharray="2 5" />
      </g>
      <g className="figure-cube figure-cube--top">
        <path d="m150 21 48 24v54l-48 25-48-25V45Z" />
        <path d="m102 45 48 25 48-25M150 70v54" opacity=".62" />
      </g>
      <g className="figure-cube figure-cube--left">
        <path d="m48 87 46-24 47 24v64l-47 24-46-24Z" />
        <path d="m48 87 46 24 47-24M94 111v64" opacity=".62" />
      </g>
      <g className="figure-cube figure-cube--right">
        <path d="m159 92 47-24 46 24v63l-46 25-47-25Z" />
        <path d="m159 92 47 24 46-24M206 116v64" opacity=".62" />
      </g>
      <g className="figure-cube figure-cube--front">
        <path d="m104 153 46-24 47 24v55l-47 24-46-24Z" />
        <path d="m104 153 46 24 47-24M150 177v55" opacity=".62" />
      </g>
      <g
        className="figure-rule-dots figure-accent"
        fill="currentColor"
        stroke="none"
      >
        <circle cx="141" cy="47" r="1.6" />
        <circle cx="150" cy="43" r="1.6" />
        <circle cx="159" cy="47" r="1.6" />
        <circle cx="85" cy="89" r="1.6" />
        <circle cx="94" cy="85" r="1.6" />
        <circle cx="103" cy="89" r="1.6" />
      </g>
    </FigureShell>
  );
}

function JournalFigure() {
  return (
    <FigureShell kind="journal">
      <g className="figure-ledger-stack" opacity=".25">
        <path d="m49 137 101-57 101 57-101 58Z" />
        <path d="m49 153 101-57 101 57-101 58Z" />
        <path d="m49 169 101-57 101 57-101 58Z" />
      </g>
      <g className="figure-ledger figure-ledger--back" opacity=".4">
        <path d="m77 93 73-42 74 42v73l-74 42-73-42Z" />
        <path d="m77 93 73 42 74-42M150 135v73" />
      </g>
      <g className="figure-ledger figure-ledger--front">
        <path d="m55 78 95-54 95 54v76l-95 55-95-55Z" />
        <path d="m55 78 95 55 95-55M150 133v76" opacity=".62" />
        <path d="m91 75 59-34 59 34-59 34Z" opacity=".38" />
        <path
          d="m107 74 43-24 43 24M119 82l31-18 31 18M132 90l18-11 18 11"
          opacity=".5"
        />
      </g>
      <path className="figure-accent figure-tick" d="m132 76 11 7 24-20" />
    </FigureShell>
  );
}

function AccessFigure() {
  return (
    <FigureShell kind="access">
      <g className="figure-device-stack" opacity=".22">
        <path d="M66 59 231 151v65L66 124Z" />
        <path d="M55 83 220 175v48L55 131Z" />
      </g>
      <path
        className="figure-device figure-device--back"
        d="M84 31a6 6 0 0 1 6 0l150 84a8 8 0 0 1 4 7v75l-160-90Z"
        opacity=".48"
      />
      <path
        className="figure-device figure-device--middle"
        d="M62 78a6 6 0 0 1 6 0l150 84a8 8 0 0 1 4 7v55L62 134Z"
        opacity=".72"
      />
      <path
        className="figure-device figure-device--front"
        d="M41 123a6 6 0 0 1 6 0l150 84a8 8 0 0 1 4 7v18L41 142Z"
      />
      <path
        className="figure-guide"
        d="m84 42 149 84M62 89l149 84M41 134l149 84"
        opacity=".24"
      />
      <g className="figure-access-node figure-accent">
        <circle cx="145" cy="140" r="14" />
        <path d="M139 140h12M145 134v12" />
      </g>
    </FigureShell>
  );
}

export function FeatureFigure({ kind }: FeatureFigureProps) {
  if (kind === "analysis") return <AnalysisFigure />;
  if (kind === "rules") return <RulesFigure />;
  if (kind === "journal") return <JournalFigure />;
  return <AccessFigure />;
}
