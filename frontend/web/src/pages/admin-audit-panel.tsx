import { useEffect, useState } from "react";
import { api, session } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import type { AccountAudit } from "@/lib/server-records";
export function AdminAuditPanel({
  userId,
  refresh,
}: {
  userId: string;
  refresh: number;
}) {
  const [items, setItems] = useState<AccountAudit[]>([]),
    [cursor, setCursor] = useState<string | undefined>(),
    [stack, setStack] = useState<Array<string | undefined>>([]),
    [next, setNext] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setCursor(undefined);
    setStack([]);
  }, [refresh]);
  useEffect(() => {
    const controller = new AbortController(),
      revision = session.getIdentityRevision();
    let alive = true;
    const active = () =>
      alive &&
      !controller.signal.aborted &&
      revision === session.getIdentityRevision();
    setLoading(true);
    setError("");
    setItems([]);
    setNext(null);
    const stop = session.onIdentityChange(() => {
      controller.abort();
      setItems([]);
      setNext(null);
    });
    void api
      .listAccountAudit(userId, cursor, controller.signal)
      .then((r) => {
        if (active()) {
          setItems(r.items);
          setNext(r.next_cursor ?? null);
        }
      })
      .catch((e) => {
        if (active())
          setError(
            e instanceof Error
              ? e.message
              : "Audit events could not be loaded.",
          );
      })
      .finally(() => {
        if (active()) setLoading(false);
      });
    return () => {
      alive = false;
      controller.abort();
      stop();
    };
  }, [userId, cursor, refresh, attempt]);
  return (
    <section className="admin-activity" aria-labelledby="admin-audit-title">
      <div className="admin-section-title">
        <div>
          <h3 id="admin-audit-title">Persistent account audit log</h3>
          <p>
            Server-recorded changes for the selected account. Newest first, 20
            events per page. Reasons and request IDs are retained across visits.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={loading}
          onClick={() => setAttempt((n) => n + 1)}
        >
          Refresh audit log
        </Button>
      </div>
      {loading ? (
        <Skeleton className="journal-loading" />
      ) : error ? (
        <Alert variant="destructive">
          <AlertTitle>Audit log unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : items.length ? (
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              <div>
                <strong>
                  {item.action}{" "}
                  {item.feature && (
                    <Badge variant="outline">{item.feature}</Badge>
                  )}
                </strong>
                <span>{item.reason}</span>
                <small>
                  Actor: {item.actor} · Request:{" "}
                  {item.request_id || "Not recorded"}
                </small>
              </div>
              <time dateTime={item.created_at}>
                {new Date(item.created_at).toLocaleString()}
              </time>
            </li>
          ))}
        </ul>
      ) : (
        <p className="admin-help">No audit events for this account.</p>
      )}
      <div className="admin-actions">
        <Button
          variant="outline"
          disabled={loading || !stack.length}
          onClick={() => {
            setCursor(stack.at(-1));
            setStack((s) => s.slice(0, -1));
          }}
        >
          Newer events
        </Button>
        <Button
          variant="outline"
          disabled={loading || !next}
          onClick={() => {
            setStack((s) => [...s, cursor]);
            setCursor(next!);
          }}
        >
          Older events
        </Button>
      </div>
    </section>
  );
}
