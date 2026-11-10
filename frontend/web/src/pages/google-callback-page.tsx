import { useEffect, useRef, useState } from "react";
import { api, session } from "@/api/client";
import { consumeGoogleCallback } from "@/api/google-oauth";
import { Brand } from "@/components/brand";
import { GoogleMark } from "@/components/google-mark";
import { Button } from "@/components/ui/button";
import type { LoginResponse, User } from "@/types";

export function GoogleCallbackPage({
  onAuthenticated,
}: {
  onAuthenticated: (user: User, destination?: string) => void;
}) {
  const [error, setError] = useState("");
  const exchange = useRef<Promise<LoginResponse> | null>(null);
  const destination = useRef("app/overview");
  const [stage, setStage] = useState("Verifying your Google sign-in…");
  useEffect(() => {
    let active = true;
    const identity = session.getIdentityRevision();
    if (!exchange.current) {
      const href = location.href;
      // Remove codes/provider errors before making any workspace requests.
      history.replaceState(null, "", "/auth/google/callback");
      exchange.current = Promise.resolve().then(() => {
        const input = consumeGoogleCallback(sessionStorage, href);
        destination.current = input.destination;
        return api.exchangeGoogleCode(input.code, input.code_verifier);
      });
    }
    void exchange.current
      .then(async (result) => {
        if (!active || identity !== session.getIdentityRevision()) return;
        session.setAuth(result);
        setStage("Preparing your private workspace…");
        await api.ensureAppSession();
        if (active) {
          history.replaceState(null, "", "/");
          onAuthenticated(result.user, destination.current);
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
    <main className="splash google-callback" aria-busy={!error}>
      <Brand />
      <GoogleMark />
      {error ? (
        <div role="alert">
          <p>{error}</p>
          <Button
            role="link"
            variant="outline"
            nativeButton={false}
            render={
              <a
                href={`/#login&returnTo=${encodeURIComponent(destination.current)}`}
              />
            }
          >
            Back to sign in
          </Button>
          <p>
            Start a new sign-in attempt. Your password and Google account have
            not been changed.
          </p>
        </div>
      ) : (
        <p role="status" aria-live="polite">
          {stage}
        </p>
      )}
    </main>
  );
}
