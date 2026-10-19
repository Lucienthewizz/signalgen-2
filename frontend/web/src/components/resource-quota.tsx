import { useEffect, useState } from "react";
import { api } from "@/api/client";
import type { ResourceUsage } from "@/types";

// Server-owned capacity: a local plan badge is never an authorization source.
export function ResourceQuota({
  kind,
  revision = 0,
}: {
  kind?: keyof ResourceUsage["limits"];
  revision?: number;
}) {
  const [usage, setUsage] = useState<ResourceUsage | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    setError(false);
    api
      .resourceUsage()
      .then((value) => {
        if (active) setUsage(value);
      })
      .catch(() => {
        if (active) {
          setUsage(null);
          setError(true);
        }
      });
    return () => {
      active = false;
    };
  }, [revision]);
  const keys: Array<keyof ResourceUsage["limits"]> = kind
    ? [kind]
    : ["custom_rules", "stock_universes"];
  return (
    <div className="resource-quota" role="status" aria-live="polite">
      {error ? (
        <span>
          Usage is unavailable. Limits are still checked when you save.
        </span>
      ) : !usage ? (
        <span>Checking usage…</span>
      ) : (
        keys.map((key) => (
          <span
            key={key}
            data-capacity={
              usage.used[key] >= usage.limits[key]
                ? "full"
                : usage.used[key] >= usage.limits[key] * 0.8
                  ? "near"
                  : "available"
            }
          >
            <strong>
              {usage.used[key]} / {usage.limits[key]}
            </strong>{" "}
            {key === "custom_rules" ? "personal rules" : "stock universes"}
            <small>
              {usage.limits[key] === 0
                ? "Not included in this plan"
                : usage.used[key] >= usage.limits[key]
                  ? "Limit reached · edit or remove an existing item"
                  : `${Math.max(0, usage.limits[key] - usage.used[key])} slots remaining${usage.used[key] >= usage.limits[key] * 0.8 ? " · nearing your limit" : ""}`}
            </small>
          </span>
        ))
      )}
    </div>
  );
}
