import { useEffect, useState } from "react";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ManagedAccount, OperatorAccountPage } from "@/types";

export function AdminAccountDirectory({
  selectedId,
  disabled,
  onSelect,
}: {
  selectedId: string;
  disabled: boolean;
  onSelect: (account: ManagedAccount) => void;
}) {
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState({ q: "", status: "all" });
  const [cursors, setCursors] = useState([""]);
  const [result, setResult] = useState<OperatorAccountPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const after = cursors.at(-1) ?? "";
  useEffect(() => {
    const controller = new AbortController();
    let ignore = false;
    setLoading(true);
    setError("");
    setResult(null);
    api
      .listOperatorAccounts(
        {
          q: query.q,
          after,
          ...(query.status === "all"
            ? {}
            : { status: query.status as "active" | "suspended" }),
        },
        controller.signal,
      )
      .then((page) => {
        if (!ignore) {
          if (!Array.isArray(page.items))
            throw new Error("The account list could not be read.");
          setResult(page);
        }
      })
      .catch((cause) => {
        if (!ignore)
          setError(
            cause instanceof Error
              ? cause.message
              : "Accounts could not be loaded.",
          );
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
      controller.abort();
    };
  }, [query, after, attempt]);
  return (
    <div
      className="admin-directory"
      role="region"
      aria-label="Account directory"
    >
      <form
        className="admin-directory-search"
        onSubmit={(event) => {
          event.preventDefault();
          setCursors([""]);
          setQuery({ q: draft.trim(), status });
        }}
      >
        <div>
          <label htmlFor="admin-search">Search by email or User ID</label>
          <Input
            id="admin-search"
            type="search"
            value={draft}
            maxLength={200}
            placeholder="e.g. member@example.com"
            disabled={disabled}
            onChange={(event) => setDraft(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="admin-status-filter">Account status</label>
          <Select
            value={status}
            disabled={disabled}
            onValueChange={(value) => setStatus(value ?? "all")}
          >
            <SelectTrigger id="admin-status-filter">
              <SelectValue>
                {status === "all"
                  ? "All accounts"
                  : status === "active"
                    ? "Active"
                    : "Suspended"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All accounts</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" disabled={disabled || loading}>
          Search accounts
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={disabled || loading}
          onClick={() => setAttempt((value) => value + 1)}
        >
          Refresh accounts
        </Button>
      </form>
      <p className="admin-help">
        {query.q ? `Results for “${query.q}”. ` : ""}Registered application
        profiles only. Ask new members to sign in once if they are missing.
      </p>
      {loading ? (
        <p role="status">Loading accounts…</p>
      ) : error ? (
        <div role="alert">
          <p>{error}</p>
          <Button
            variant="outline"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Retry account list
          </Button>
        </div>
      ) : !result?.items.length ? (
        <p role="status">No accounts found. Try a different email or status.</p>
      ) : (
        <>
          <Table aria-label="Registered accounts">
            <TableHeader>
              <TableRow>
                <TableHead>Email / User ID</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.items.map((item) => (
                <TableRow
                  key={item.user_id}
                  data-state={
                    selectedId === item.user_id ? "selected" : undefined
                  }
                >
                  <TableCell>
                    <strong>{item.email || "Email unavailable"}</strong>
                    <small>{item.user_id}</small>
                  </TableCell>
                  <TableCell>
                    {item.role === "operator" ? "Operator" : "User"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        item.status === "active" ? "secondary" : "outline"
                      }
                    >
                      {item.status === "active" ? "Active" : "Suspended"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant={
                        selectedId === item.user_id ? "secondary" : "outline"
                      }
                      disabled={disabled}
                      aria-label={`Select ${item.email || item.user_id}`}
                      aria-pressed={selectedId === item.user_id}
                      onClick={() => onSelect(item)}
                    >
                      {selectedId === item.user_id
                        ? "Selected"
                        : "Select account"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="admin-directory-pages">
            <Button
              variant="outline"
              disabled={disabled || cursors.length === 1}
              onClick={() => setCursors((items) => items.slice(0, -1))}
            >
              Previous accounts
            </Button>
            <span>
              Page {cursors.length} · {result.items.length} accounts shown
            </span>
            <Button
              variant="outline"
              disabled={disabled || !result.next_cursor}
              onClick={() =>
                setCursors((items) => [...items, result.next_cursor!])
              }
            >
              Next accounts
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
