const FLOW_KEY = "signalgen.google-pkce";
export const GOOGLE_CALLBACK_PATH = "/auth/google/callback";
const FLOW_LIFETIME = 10 * 60_000;

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// One pending flow per tab. The verifier never leaves this origin except in
// the one-time POST to our auth gateway; no credentials travel in callback URLs.
export async function createGoogleProof(
  storage: Storage,
  origin: string,
  signal?: AbortSignal,
) {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ),
  );
  signal?.throwIfAborted();
  storage.setItem(
    FLOW_KEY,
    JSON.stringify({ verifier, origin, createdAt: Date.now() }),
  );
  return {
    code_challenge: challenge,
    redirect_to: origin + GOOGLE_CALLBACK_PATH,
  };
}

export function clearGoogleProof(storage: Storage) {
  try {
    storage.removeItem(FLOW_KEY);
  } catch {
    /* Storage may be disabled. */
  }
}

export function consumeGoogleCallback(storage: Storage, href: string) {
  const url = new URL(href);
  const pending = storage.getItem(FLOW_KEY);
  clearGoogleProof(storage);
  if (url.pathname !== GOOGLE_CALLBACK_PATH)
    throw new Error("Invalid Google callback.");
  if (url.searchParams.has("error") || url.hash.includes("error="))
    throw new Error(
      "Google sign-in was cancelled or is not configured. You can try again or use email and password.",
    );
  let flow;
  try {
    flow = pending ? JSON.parse(pending) : null;
  } catch {
    flow = null;
  }
  if (
    !flow ||
    flow.origin !== url.origin ||
    !Number.isFinite(flow.createdAt) ||
    flow.createdAt > Date.now() ||
    Date.now() - flow.createdAt > FLOW_LIFETIME ||
    !/^[A-Za-z0-9_-]{43}$/.test(flow.verifier)
  )
    throw new Error(
      "Google sign-in expired or was opened in another browser. Start again in this tab.",
    );
  const code = url.searchParams.get("code");
  if (!code || code.length > 4096)
    throw new Error(
      "Google did not return a valid sign-in code. Please start again.",
    );
  return { code, code_verifier: flow.verifier as string };
}
