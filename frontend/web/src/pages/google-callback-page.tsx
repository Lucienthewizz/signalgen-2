import { useEffect, useRef, useState } from "react";
import { api, session } from "@/api/client";
import { consumeGoogleCallback } from "@/api/google-oauth";
import { Brand } from "@/components/brand";
import type { LoginResponse, User } from "@/types";

export function GoogleCallbackPage({
  onAuthenticated,
}: {
  onAuthenticated: (user: User) => void;
}) {
  const [error, setError] = useState("");
  const exchange = useRef<Promise<LoginResponse> | null>(null);
  useEffect(() => {
    let active = true;
    const identity = session.getIdentityRevision();
    if (!exchange.current) {
      const href = location.href;
      // Remove codes/provider errors before making any workspace requests.
      history.replaceState(null, "", "/auth/google/callback");
      exchange.current = Promise.resolve().then(() => {
        const input = consumeGoogleCallback(sessionStorage, href);
        return api.exchangeGoogleCode(input.code, input.code_verifier);
      });
    }
    void exchange.current
      .then(async (result) => {
        if (!active || identity !== session.getIdentityRevision()) return;
        session.setAuth(result);
        await api.ensureAppSession();
        if (active) {
          history.replaceState(null, "", "/");
          onAuthenticated(result.user);
        }
      })
      .catch((reason: unknown) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "Google sign-in failed. Please start again.",
          );
      });
    return () => {
      active = false;
    };
  }, [onAuthenticated]);
  return (
    <main className="splash">
      <Brand />
      {error ? (
        <div role="alert">
          <p>{error}</p>
          <a href="/#login">Back to sign in</a>
        </div>
      ) : (
        <p role="status">Completing Google sign-in…</p>
      )}
    </main>
  );
}
