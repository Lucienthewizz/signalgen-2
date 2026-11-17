// React Bits Stepper: read-only process indicator adapted to Signalgen.
// See LICENSE.md. Stage changes come from the actual request state.
import "./WorkspaceMotion.css";
export default function Stepper({
  stage,
  partial = false,
}: {
  stage: 0 | 1 | 2;
  partial?: boolean;
}) {
  return (
    <ol className="run-stepper" aria-label="Run stages">
      {["Configure", "Process", partial ? "Partial results" : "Results"].map(
        (label, index) => (
          <li
            key={index}
            data-state={
              stage === 0
                ? "waiting"
                : index < stage
                  ? "complete"
                  : index === stage
                    ? "current"
                    : "waiting"
            }
            aria-current={index === stage ? "step" : undefined}
          >
            <span className="run-stepper__number" aria-hidden="true">
              {index + 1}
            </span>
            <span className="run-stepper__label">{label}</span>
          </li>
        ),
      )}
    </ol>
  );
}
