import { QueryClient } from "@tanstack/query-core";

export type UiResource = "rules" | "universes" | "stocks" | "subscription";
const retention = 5 * 60_000;
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: retention } },
});
const key = (revision: number, owner: string, resource: UiResource) =>
  ["ui", revision, owner, resource] as const;

// Memory-only presentation data. Credentials, account authorization, grants
// and candles stay outside; plan labels never authorize an action.
export function peekUiResource<T>(
  revision: number,
  owner: string | undefined,
  resource: UiResource,
): T | undefined {
  if (!owner) return undefined;
  const state = client.getQueryState<T>(key(revision, owner, resource));
  if (!state?.data || Date.now() - state.dataUpdatedAt >= retention)
    return undefined;
  return structuredClone(state.data);
}

export async function loadUiResource<T>(
  revision: number,
  owner: string | undefined,
  resource: UiResource,
  load: (signal: AbortSignal) => Promise<T>,
  refresh = false,
): Promise<T> {
  if (!owner) return load(new AbortController().signal);
  const queryKey = key(revision, owner, resource);
  if (refresh)
    await client.invalidateQueries({
      queryKey,
      exact: true,
      refetchType: "none",
    });
  const data = await client.fetchQuery({
    queryKey,
    queryFn: ({ signal }) => load(signal),
    staleTime: resource === "stocks" ? retention : 30_000,
  });
  // Forms cannot accidentally mutate the shared snapshot by editing a reference.
  return structuredClone(data);
}

export function clearUiCache() {
  client.clear();
}

export function invalidateUiCache(path: string) {
  let resources: UiResource[] = [];
  if (/^\/api\/v1\/rules(?:\/|$)/.test(path)) resources = ["rules"];
  if (/^\/api\/v1\/stock-universes(?:\/|$)/.test(path))
    resources = ["universes"];
  if (/^\/api\/v1\/(?:subscription(?:\/|$)|operator\/)/.test(path))
    resources = ["rules", "universes", "subscription"];
  if (!resources.length) return;
  // Destroy pending reads too: a response started before a write must not
  // repopulate the cache with its older version after that write completes.
  client.removeQueries({
    predicate: (query) =>
      query.queryKey[0] === "ui" &&
      resources.includes(query.queryKey[3] as UiResource),
  });
}
