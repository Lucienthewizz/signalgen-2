import { FormEvent, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  ShieldCheck,
  X,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  meetsPasswordRequirements,
  PasswordStrengthIndicator,
} from "@/components/ui/password-strength";
import { Brand } from "@/components/brand";
import { api, ApiError, session } from "@/api/client";
import type { User } from "@/types";

export type AuthView =
  "login" | "register" | "forgot-password" | "reset-password";

type Notice = {
  kind: "error" | "success";
  title: string;
  detail: string;
} | null;

export function AuthPage({
  view,
  backendOnline,
  onAuthenticated,
}: {
  view: AuthView;
  backendOnline: boolean;
  onAuthenticated: (user: User) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerConfirmation, setRegisterConfirmation] = useState("");
  const recovery = useMemo(() => {
    const hashParams = new URLSearchParams(location.hash.replace(/^#/, ""));
    const searchParams = new URLSearchParams(location.search);
    return {
      accessToken:
        hashParams.get("access_token") ??
        searchParams.get("access_token") ??
        "",
      refreshToken:
        hashParams.get("refresh_token") ??
        searchParams.get("refresh_token") ??
        "",
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");
    setLoading(true);
    setNotice(null);
    try {
      if (view === "forgot-password") {
        await api.requestPasswordReset(email);
        setNotice({
          kind: "success",
          title: "Check your inbox",
          detail:
            "If that account exists, a reset link has been sent. The link is valid for one recovery session.",
        });
      } else if (view === "reset-password") {
        const confirmation = String(data.get("confirmation") ?? "");
        if (!recovery.accessToken || !recovery.refreshToken)
          throw new ApiError(
            "The reset link is incomplete or has expired.",
            400,
          );
        if (password !== confirmation)
          throw new ApiError("The passwords do not match.", 400);
        await api.resetPassword(
          recovery.accessToken,
          recovery.refreshToken,
          password,
        );
        history.replaceState(null, "", location.pathname);
        setNotice({
          kind: "success",
          title: "Password updated",
          detail: "You can now sign in with your new password.",
        });
        setTimeout(() => {
          location.hash = "login";
        }, 900);
      } else if (view === "register") {
        const confirmation = String(data.get("confirmation") ?? "");
        if (!meetsPasswordRequirements(password))
          throw new ApiError("Use at least 8 characters.", 400);
        if (password !== confirmation)
          throw new ApiError("The passwords do not match.", 400);
        const result = await api.register(
          String(data.get("fullName") ?? "").trim(),
          email,
          password,
        );
        if (result.access_token) {
          session.setToken(result.access_token);
          await api.ensureAppSession();
          onAuthenticated(result.user);
        } else {
          setNotice({
            kind: "success",
            title: "Account created",
            detail: "Confirm your email, then sign in to the workspace.",
          });
        }
      } else {
        const result = await api.login(email, password);
        session.setToken(result.access_token);
        await api.ensureAppSession();
        onAuthenticated(result.user);
      }
    } catch (error) {
      setNotice({
        kind: "error",
        title: "Request failed",
        detail:
          error instanceof Error
            ? error.message
            : "Something went wrong. Try again.",
      });
    } finally {
      setLoading(false);
    }
  }

  const copy = {
    login: [
      "Continue to Signalgen",
      "Use the same account across web and desktop.",
    ],
    register: [
      "Create your account",
      "One identity for every Signalgen workspace.",
    ],
    "forgot-password": [
      "Recover your password",
      "Enter the email linked to your Signalgen account.",
    ],
    "reset-password": [
      "Choose a new password",
      "Use at least 8 characters and avoid reusing another password.",
    ],
  }[view];

  return (
    <main
      className={`auth-layout ${view === "forgot-password" ? "auth-layout--recovery" : ""}`}
    >
      {view !== "forgot-password" && (
        <section className="auth-story">
          <a href="#home" aria-label="Back to Signalgen">
            <Brand />
          </a>
          <div className="auth-story__content">
            <h1>
              Read the market.
              <br />
              <span>Verify the signal.</span>
            </h1>
            <p>
              Build rules, test hypotheses, and understand the evidence behind
              every IDX signal.
            </p>
            <div className="auth-proof">
              <div>
                <ShieldCheck />
                <span>
                  <b>Private by account</b>
                  <small>Your strategies remain isolated by account</small>
                </span>
              </div>
              <div>
                <KeyRound />
                <span>
                  <b>Backend authorization</b>
                  <small>Sessions are verified by Supabase</small>
                </span>
              </div>
            </div>
          </div>
          <footer>
            <span
              className={`status-dot ${backendOnline ? "is-online" : ""}`}
            />{" "}
            Backend {backendOnline ? "verified" : "not connected"}
          </footer>
        </section>
      )}
      <section className="auth-panel">
        <div className="auth-card">
          <div className="auth-card__top">
            {view === "forgot-password" ? (
              <a
                className="auth-recovery__brand"
                href="#home"
                aria-label="Signalgen home"
              >
                <Brand compact />
              </a>
            ) : (
              <>
                <a className="mobile-logo" href="#home">
                  <Brand compact />
                </a>
                {view === "login" || view === "register" ? (
                  <div
                    className="auth-switch"
                    aria-label="Authentication options"
                  >
                    <a
                      className={view === "login" ? "active" : ""}
                      href="#login"
                    >
                      Sign in
                    </a>
                    <a
                      className={view === "register" ? "active" : ""}
                      href="#register"
                    >
                      Register
                    </a>
                  </div>
                ) : (
                  <a className="back-link" href="#login">
                    <ArrowLeft /> Back to sign in
                  </a>
                )}
              </>
            )}
          </div>
          <div className="auth-heading">
            <h2>{copy[0]}</h2>
            <p>{copy[1]}</p>
          </div>
          <form className="auth-form" onSubmit={submit}>
            <FieldGroup className="auth-fields">
              {view === "register" && (
                <AuthField
                  label="Full name"
                  name="fullName"
                  type="text"
                  placeholder="Your name"
                  minLength={2}
                  autoComplete="name"
                />
              )}
              {view !== "reset-password" && (
                <AuthField
                  label="Email"
                  name="email"
                  type="email"
                  placeholder="name@email.com"
                  autoComplete="email"
                />
              )}
              {view === "register" && (
                <PasswordField
                  aria-describedby="password-guidance"
                  autoComplete="new-password"
                  label="Password"
                  minLength={8}
                  name="password"
                  onChange={(event) => setRegisterPassword(event.target.value)}
                  placeholder="Create a password"
                  value={registerPassword}
                >
                  <PasswordStrengthIndicator value={registerPassword} />
                  <FieldDescription className="sr-only">
                    Use at least 8 characters.
                  </FieldDescription>
                </PasswordField>
              )}
              {(view === "login" || view === "reset-password") && (
                <PasswordField
                  label={
                    view === "reset-password" ? "New password" : "Password"
                  }
                  name="password"
                  placeholder={
                    view === "login" ? "Your password" : "At least 8 characters"
                  }
                  minLength={view === "login" ? 1 : 8}
                  autoComplete={
                    view === "login" ? "current-password" : "new-password"
                  }
                />
              )}
              {(view === "register" || view === "reset-password") && (
                <PasswordField
                  aria-invalid={
                    view === "register" &&
                    registerConfirmation.length > 0 &&
                    registerConfirmation !== registerPassword
                  }
                  label="Confirm password"
                  name="confirmation"
                  onChange={(event) =>
                    view === "register" &&
                    setRegisterConfirmation(event.target.value)
                  }
                  placeholder="Repeat your password"
                  minLength={8}
                  autoComplete="new-password"
                  value={view === "register" ? registerConfirmation : undefined}
                />
              )}
            </FieldGroup>
            {view === "login" && (
              <a className="forgot-link" href="#forgot-password">
                Forgot your password?
              </a>
            )}
            {notice && (
              <Alert
                className={`auth-alert is-${notice.kind}`}
                variant={notice.kind === "error" ? "destructive" : "default"}
              >
                {notice.kind === "error" ? <X /> : <Check />}
                <AlertTitle>{notice.title}</AlertTitle>
                <AlertDescription>{notice.detail}</AlertDescription>
              </Alert>
            )}
            <Button
              className="ui-button ui-button--primary auth-submit"
              disabled={loading || !backendOnline}
              type="submit"
            >
              {loading
                ? "Processing…"
                : view === "login"
                  ? "Sign in to workspace"
                  : view === "register"
                    ? "Create account"
                    : view === "forgot-password"
                      ? "Send reset link"
                      : "Save new password"}
              <ArrowRight />
            </Button>
          </form>
          {!backendOnline && (
            <p className="auth-note">
              The backend is unavailable. This form will reactivate when the
              connection returns.
            </p>
          )}
          {view === "forgot-password" ? (
            <>
              <p className="auth-recovery__note">
                We will send a one-time reset link to your inbox.
              </p>
              <p className="auth-recovery__signin">
                Remembered your password? <a href="#login">Sign in</a>
              </p>
            </>
          ) : (
            <p className="auth-note">
              Signalgen supports analysis. It does not provide personalized
              investment advice.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}

function AuthField(props: {
  label: string;
  name: string;
  type: string;
  placeholder: string;
  minLength?: number;
  autoComplete: string;
  value?: string;
  onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
  "aria-invalid"?: boolean;
}) {
  return (
    <Field className="auth-field">
      <FieldLabel htmlFor={props.name}>{props.label}</FieldLabel>
      <Input id={props.name} className="auth-input" required {...props} />
      <FieldDescription className="sr-only">
        Enter {props.label.toLowerCase()}
      </FieldDescription>
    </Field>
  );
}

function PasswordField({
  label,
  name,
  children,
  ...inputProps
}: {
  label: string;
  name: string;
  placeholder: string;
  minLength?: number;
  autoComplete: string;
  value?: string;
  onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
  children?: React.ReactNode;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}) {
  const [visible, setVisible] = useState(false);
  const inputId = name;

  return (
    <Field className="auth-field auth-password-field">
      <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
      <div className="auth-password-control">
        <Input
          {...inputProps}
          id={inputId}
          name={name}
          className="auth-input auth-input--password"
          required
          type={visible ? "text" : "password"}
        />
        <button
          aria-label={
            visible
              ? `Hide ${label.toLowerCase()}`
              : `Show ${label.toLowerCase()}`
          }
          aria-pressed={visible}
          className="auth-password-toggle"
          onClick={() => setVisible((current) => !current)}
          type="button"
        >
          {visible ? <EyeOff /> : <Eye />}
        </button>
      </div>
      {children}
      <FieldDescription className="sr-only">
        Enter {label.toLowerCase()}
      </FieldDescription>
    </Field>
  );
}
