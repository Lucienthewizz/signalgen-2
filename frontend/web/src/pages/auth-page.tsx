import { FormEvent, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
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
  const recovery = useMemo(() => {
    const params = new URLSearchParams(location.hash.replace(/^#/, ""));
    return {
      accessToken: params.get("access_token") ?? "",
      refreshToken: params.get("refresh_token") ?? "",
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
          title: "Periksa inbox Anda",
          detail:
            "Jika akun tersebut terdaftar, tautan reset sudah dikirim. Tautan hanya berlaku untuk satu sesi recovery.",
        });
      } else if (view === "reset-password") {
        const confirmation = String(data.get("confirmation") ?? "");
        if (!recovery.accessToken || !recovery.refreshToken)
          throw new ApiError(
            "Tautan reset tidak lengkap atau sudah tidak berlaku.",
            400,
          );
        if (password !== confirmation)
          throw new ApiError("Konfirmasi password belum sama.", 400);
        await api.resetPassword(
          recovery.accessToken,
          recovery.refreshToken,
          password,
        );
        history.replaceState(null, "", location.pathname);
        setNotice({
          kind: "success",
          title: "Password berhasil diperbarui",
          detail: "Anda sekarang dapat masuk menggunakan password baru.",
        });
        setTimeout(() => {
          location.hash = "login";
        }, 900);
      } else if (view === "register") {
        const confirmation = String(data.get("confirmation") ?? "");
        if (password !== confirmation)
          throw new ApiError("Konfirmasi password belum sama.", 400);
        const result = await api.register(
          String(data.get("fullName") ?? "").trim(),
          email,
          password,
        );
        if (result.access_token) {
          session.setToken(result.access_token);
          onAuthenticated(result.user);
        } else {
          setNotice({
            kind: "success",
            title: "Akun berhasil dibuat",
            detail: "Konfirmasi email Anda, lalu masuk ke workspace.",
          });
        }
      } else {
        const result = await api.login(email, password);
        session.setToken(result.access_token);
        onAuthenticated(result.user);
      }
    } catch (error) {
      setNotice({
        kind: "error",
        title: "Permintaan belum berhasil",
        detail:
          error instanceof Error
            ? error.message
            : "Terjadi kesalahan. Coba kembali.",
      });
    } finally {
      setLoading(false);
    }
  }

  const copy = {
    login: [
      "Continue to Signalgen",
      "Gunakan akun yang sama untuk web dan desktop.",
    ],
    register: [
      "Create your account",
      "Satu identitas untuk seluruh workspace Signalgen.",
    ],
    "forgot-password": [
      "Reset your password",
      "Kami akan mengirim tautan recovery ke email akun Anda.",
    ],
    "reset-password": [
      "Choose a new password",
      "Gunakan minimal 8 karakter yang tidak digunakan di layanan lain.",
    ],
  }[view];

  return (
    <main className="auth-layout">
      <section className="auth-story">
        <a href="#home" aria-label="Kembali ke Signalgen">
          <Brand />
        </a>
        <div className="auth-story__content">
          <h1>
            Read the market.
            <br />
            <span>Verify the signal.</span>
          </h1>
          <p>
            Workspace untuk menyusun rule, menguji hipotesis, dan memahami
            alasan di balik setiap signal IDX.
          </p>
          <div className="auth-proof">
            <div>
              <ShieldCheck />
              <span>
                <b>Private by account</b>
                <small>Strategi tidak bercampur antar-user</small>
              </span>
            </div>
            <div>
              <KeyRound />
              <span>
                <b>Backend authorization</b>
                <small>Session diverifikasi oleh Supabase</small>
              </span>
            </div>
          </div>
        </div>
        <footer>
          <span className={`status-dot ${backendOnline ? "is-online" : ""}`} />{" "}
          Backend {backendOnline ? "verified" : "not connected"}
        </footer>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <div className="auth-card__top">
            <a className="mobile-logo" href="#home">
              <Brand compact />
            </a>
            {view === "login" || view === "register" ? (
              <div className="auth-switch" aria-label="Pilihan autentikasi">
                <a className={view === "login" ? "active" : ""} href="#login">
                  Masuk
                </a>
                <a
                  className={view === "register" ? "active" : ""}
                  href="#register"
                >
                  Daftar
                </a>
              </div>
            ) : (
              <a className="back-link" href="#login">
                <ArrowLeft /> Kembali ke masuk
              </a>
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
                  label="Nama lengkap"
                  name="fullName"
                  type="text"
                  placeholder="Nama Anda"
                  minLength={2}
                  autoComplete="name"
                />
              )}
              {view !== "reset-password" && (
                <AuthField
                  label="Email"
                  name="email"
                  type="email"
                  placeholder="nama@email.com"
                  autoComplete="email"
                />
              )}
              {(view === "login" ||
                view === "register" ||
                view === "reset-password") && (
                <AuthField
                  label={
                    view === "reset-password" ? "Password baru" : "Password"
                  }
                  name="password"
                  type="password"
                  placeholder={
                    view === "login" ? "Password Anda" : "Minimal 8 karakter"
                  }
                  minLength={view === "login" ? 1 : 8}
                  autoComplete={
                    view === "login" ? "current-password" : "new-password"
                  }
                />
              )}
              {(view === "register" || view === "reset-password") && (
                <AuthField
                  label="Konfirmasi password"
                  name="confirmation"
                  type="password"
                  placeholder="Ulangi password"
                  minLength={8}
                  autoComplete="new-password"
                />
              )}
            </FieldGroup>
            {view === "login" && (
              <a className="forgot-link" href="#forgot-password">
                Lupa password?
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
                ? "Memproses…"
                : view === "login"
                  ? "Masuk ke workspace"
                  : view === "register"
                    ? "Buat akun"
                    : view === "forgot-password"
                      ? "Kirim tautan reset"
                      : "Simpan password baru"}
              <ArrowRight />
            </Button>
          </form>
          {!backendOnline && (
            <p className="auth-note">
              Backend belum dapat dijangkau. Form akan aktif kembali setelah
              koneksi tersedia.
            </p>
          )}
          <p className="auth-note">
            Signalgen adalah alat analisis, bukan rekomendasi investasi
            personal.
          </p>
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
}) {
  return (
    <Field className="auth-field">
      <FieldLabel htmlFor={props.name}>{props.label}</FieldLabel>
      <Input id={props.name} className="auth-input" required {...props} />
      <FieldDescription className="sr-only">
        Masukkan {props.label.toLowerCase()}
      </FieldDescription>
    </Field>
  );
}
