import { api, session, ApiError } from "@/api/client";
import { historicalCache, historicalScope } from "../data/historical-cache";
import type { DatasetManifest } from "../types";

/** Every hit still requires an ONLINE session/entitlement/ownership check. */
export async function loadScreenerDataset(
  prepared: DatasetManifest,
  signal: AbortSignal,
) {
  const revision = session.getIdentityRevision();
  const check = () => {
    signal.throwIfAborted();
    if (revision !== session.getIdentityRevision() || !session.getToken())
      throw new ApiError("Akun berubah. Analisis dibatalkan.", 401);
  };
  check();
  const [user, manifest] = await Promise.all([
    api.me(signal),
    api.getDatasetManifest(prepared.dataset_id, signal),
  ]);
  check();
  if (
    manifest.version !== prepared.version ||
    manifest.checksum !== prepared.checksum ||
    manifest.schema_version !== prepared.schema_version ||
    manifest.dataset_id !== prepared.dataset_id
  )
    throw new ApiError("Versi snapshot berubah. Jalankan ulang analisis.", 409);
  const scope = await historicalScope(
    session.getApiOrigin(),
    user.id,
    session.getInstallationId(),
  );
  check();
  const data = await historicalCache.load(
    scope,
    manifest,
    async () => {
      check();
      const text = await api.getDatasetContentText(manifest.dataset_id, signal);
      check();
      return text;
    },
    signal,
  );
  check();
  return data;
}
