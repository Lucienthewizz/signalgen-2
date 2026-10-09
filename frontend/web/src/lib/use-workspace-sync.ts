import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/api/client";
import {
  readWorkspaceData,
  writeWorkspaceData,
  syncMeta,
  setSyncMeta,
  workspaceKinds,
  type WorkspaceKind,
} from "@/lib/workspace-storage";

type SyncState = "loading" | "saved" | "local" | "conflict" | "saving";
// Only presentation state is synchronized. Every privileged action is checked by Go.
export function useWorkspaceSync(userId?: string) {
  const [state, setState] = useState<SyncState>("loading");
  const [ready, setReady] = useState(!userId);
  const [epoch, setEpoch] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const resolve = useRef<(choice: "account" | "device") => Promise<void>>(
    async () => {},
  );
  useEffect(() => {
    if (!userId) {
      setReady(true);
      setState("local");
      return;
    }
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let busy = false;
    const conflicts = new Set<WorkspaceKind>();
    const pending = new Set<WorkspaceKind>();
    const versions = new Map<WorkspaceKind, number>();
    setReady(false);
    setState("loading");
    async function flush() {
      if (!active || busy || conflicts.size) return;
      busy = true;
      setState("saving");
      let succeeded = false;
      try {
        for (const kind of [...pending]) {
          const data = readWorkspaceData(userId!, kind);
          const signature = JSON.stringify(data);
          const saved = await api.saveWorkspace(
            kind,
            versions.get(kind) ?? 0,
            data,
          );
          if (!active) return;
          versions.set(kind, saved.version);
          const changed =
            signature !== JSON.stringify(readWorkspaceData(userId!, kind));
          setSyncMeta(userId!, kind, saved.version, changed);
          if (!changed) pending.delete(kind);
        }
        if (active) setState(pending.size ? "local" : "saved");
        succeeded = true;
      } catch (error) {
        if (active) {
          if (error instanceof ApiError && error.status === 409) {
            for (const kind of pending) conflicts.add(kind);
            setState("conflict");
          } else setState("local");
        }
      } finally {
        busy = false;
        // Edits made while a write was in flight need their own new version.
        // Do not retry failures in a loop; retain the local copy for explicit retry.
        if (active && succeeded && pending.size && !conflicts.size) {
          clearTimeout(timer);
          timer = setTimeout(() => void flush(), 800);
        }
      }
    }
    const changed = (event: Event) => {
      const detail = (
        event as CustomEvent<{ userId: string; kind: WorkspaceKind }>
      ).detail;
      if (
        !active ||
        detail?.userId !== userId ||
        !workspaceKinds.includes(detail.kind)
      )
        return;
      pending.add(detail.kind);
      clearTimeout(timer);
      timer = setTimeout(() => void flush(), 800);
    };
    window.addEventListener("signalgen:workspace-change", changed);
    resolve.current = async (choice) => {
      if (busy || !active) return;
      busy = true;
      setState("saving");
      try {
        const remote = await api.workspace();
        if (!active) return;
        for (const kind of conflicts) {
          const item = remote.items.find((item) => item.kind === kind);
          versions.set(kind, item?.version ?? 0);
          if (choice === "account") {
            if (!writeWorkspaceData(userId!, kind, item?.data ?? null, false))
              throw Error("storage");
            setSyncMeta(userId!, kind, item?.version ?? 0, false);
            pending.delete(kind);
          } else setSyncMeta(userId!, kind, item?.version ?? 0, true);
        }
        conflicts.clear();
        if (choice === "account") setEpoch((value) => value + 1);
        setState(pending.size ? "local" : "saved");
      } catch {
        if (active) setState(conflicts.size ? "conflict" : "local");
      } finally {
        busy = false;
      }
      if (active && !conflicts.size && pending.size) void flush();
    };
    void (async () => {
      try {
        const remote = await api.workspace();
        if (!active) return;
        for (const kind of workspaceKinds) {
          const item = remote.items.find((item) => item.kind === kind);
          const meta = syncMeta(userId, kind);
          const local = readWorkspaceData(userId, kind);
          versions.set(kind, item?.version ?? 0);
          if (
            meta.dirty &&
            item &&
            meta.version !== item.version &&
            JSON.stringify(local) !== JSON.stringify(item.data)
          ) {
            conflicts.add(kind);
            pending.add(kind);
          } else if (meta.dirty || (!item && local !== null)) pending.add(kind);
          else if (item) {
            if (!writeWorkspaceData(userId, kind, item.data, false))
              throw Error("storage");
            setSyncMeta(userId, kind, item.version, false);
          }
        }
        setState(
          conflicts.size ? "conflict" : pending.size ? "local" : "saved",
        );
        if (pending.size && !conflicts.size) void flush();
      } catch {
        if (active) setState("local");
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
      clearTimeout(timer);
      window.removeEventListener("signalgen:workspace-change", changed);
    };
  }, [userId, attempt]);
  return {
    state,
    ready,
    epoch,
    retry: () => setAttempt((n) => n + 1),
    useAccount: () => resolve.current("account"),
    useDevice: () => resolve.current("device"),
  };
}
