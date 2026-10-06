/**
 * Lightweight authentication gate for the SignalGen desktop demo.
 * The access token is kept only for the current WebView/browser session.
 */

const SignalGenAuth = {
  tokenKey: "signalgen_access_token",
  user: null,

  getAccessToken() {
    return sessionStorage.getItem(this.tokenKey);
  },

  async init() {
    this.form = document.getElementById("auth-login-form");
    this.emailInput = document.getElementById("auth-email");
    this.passwordInput = document.getElementById("auth-password");
    this.submitButton = document.getElementById("auth-submit");
    this.feedback = document.getElementById("auth-feedback");
    this.registerForm = document.getElementById("auth-register-form");
    this.registerSubmitButton = document.getElementById("auth-register-submit");
    this.registerFeedback = document.getElementById("auth-register-feedback");

    this.form.addEventListener("submit", (event) => this.login(event));
    this.registerForm.addEventListener("submit", (event) => this.register(event));
    document.getElementById("auth-login-tab").addEventListener("click", () => this.switchMode("login"));
    document.getElementById("auth-register-tab").addEventListener("click", () => this.switchMode("register"));
    document.getElementById("auth-open-login").addEventListener("click", () => this.switchMode("login"));
    document.getElementById("auth-open-register").addEventListener("click", () => this.switchMode("register"));
    document
      .getElementById("auth-logout")
      .addEventListener("click", () => this.logout());

    const token = this.getAccessToken();
    if (!token) {
      this.showLogin();
      return false;
    }

    try {
      const user = await this.fetchCurrentUser(token);
      this.showApplication(user);
      return true;
    } catch (_error) {
      sessionStorage.removeItem(this.tokenKey);
      this.showLogin("Sesi sebelumnya telah berakhir. Silakan masuk kembali.");
      return false;
    }
  },

  async register(event) {
    event.preventDefault();
    const password = document.getElementById("auth-register-password").value;
    const confirmation = document.getElementById("auth-register-confirm").value;

    if (password !== confirmation) {
      this.setRegisterFeedback("Konfirmasi password belum sama.", true);
      return;
    }

    this.setRegisterLoading(true);
    this.setRegisterFeedback("");

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: document.getElementById("auth-register-name").value.trim(),
          email: document.getElementById("auth-register-email").value.trim(),
          password,
        }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.detail || "Registrasi gagal. Periksa kembali data Anda.");
      }

      if (payload.access_token) {
        sessionStorage.setItem(this.tokenKey, payload.access_token);
        const user = await this.fetchCurrentUser(payload.access_token);
        this.registerForm.reset();
        this.showApplication(user);
        window.dispatchEvent(new CustomEvent("signalgen:authenticated"));
        return;
      }

      const registeredEmail = document.getElementById("auth-register-email").value.trim();
      this.registerForm.reset();
      this.switchMode("login");
      this.emailInput.value = registeredEmail;
      this.setFeedback("Registrasi berhasil. Cek email untuk konfirmasi, lalu masuk.");
    } catch (error) {
      this.setRegisterFeedback(error.message, true);
    } finally {
      this.setRegisterLoading(false);
    }
  },

  switchMode(mode) {
    const isLogin = mode === "login";
    document.getElementById("auth-login-view").classList.toggle("hidden", !isLogin);
    document.getElementById("auth-register-view").classList.toggle("hidden", isLogin);
    document.getElementById("auth-login-tab").classList.toggle("active", isLogin);
    document.getElementById("auth-register-tab").classList.toggle("active", !isLogin);
    this.setFeedback("");
    this.setRegisterFeedback("");
    window.setTimeout(() => {
      document.getElementById(isLogin ? "auth-email" : "auth-register-name").focus();
    }, 50);
  },

  async login(event) {
    event.preventDefault();
    this.setLoading(true);
    this.setFeedback("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: this.emailInput.value.trim(),
          password: this.passwordInput.value,
        }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.detail || "Login gagal. Periksa kembali akun Anda.");
      }

      sessionStorage.setItem(this.tokenKey, payload.access_token);
      const user = await this.fetchCurrentUser(payload.access_token);
      this.passwordInput.value = "";
      this.showApplication(user);
      window.dispatchEvent(new CustomEvent("signalgen:authenticated"));
    } catch (error) {
      sessionStorage.removeItem(this.tokenKey);
      this.setFeedback(error.message, true);
    } finally {
      this.setLoading(false);
    }
  },

  async fetchCurrentUser(token) {
    const response = await fetch("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.detail || "Sesi tidak valid.");
    }

    return payload;
  },

  showApplication(user) {
    this.user = user;
    document.getElementById("auth-gate").classList.add("auth-gate--hidden");
    document.getElementById("signalgen-shell").classList.remove("hidden");
    document.getElementById("auth-user").classList.remove("hidden");
    document.getElementById("auth-user-name").textContent =
      user.full_name || user.email || "SignalGen User";
    document.getElementById("auth-user-email").textContent = user.email || "";
    document.getElementById("auth-user-initial").textContent = (
      user.full_name || user.email || "S"
    )
      .charAt(0)
      .toUpperCase();
  },

  showLogin(message = "") {
    this.user = null;
    document.getElementById("signalgen-shell").classList.add("hidden");
    document.getElementById("auth-gate").classList.remove("auth-gate--hidden");
    this.setFeedback(message, Boolean(message));
    window.setTimeout(() => this.emailInput.focus(), 50);
  },

  logout() {
    sessionStorage.removeItem(this.tokenKey);
    this.passwordInput.value = "";
    this.showLogin("Anda telah keluar dari sesi demo.");
  },

  setLoading(isLoading) {
    this.submitButton.disabled = isLoading;
    this.submitButton.querySelector("span").textContent = isLoading
      ? "Memeriksa akun..."
      : "Masuk ke SignalGen";
    this.submitButton.querySelector("i").className = isLoading
      ? "fas fa-circle-notch fa-spin"
      : "fas fa-arrow-right";
  },

  setFeedback(message, isError = false) {
    this.feedback.textContent = message;
    this.feedback.classList.toggle("auth-feedback--error", isError);
    this.feedback.classList.toggle("hidden", !message);
  },

  setRegisterLoading(isLoading) {
    this.registerSubmitButton.disabled = isLoading;
    this.registerSubmitButton.querySelector("span").textContent = isLoading
      ? "Membuat akun..."
      : "Buat akun";
    this.registerSubmitButton.querySelector("i").className = isLoading
      ? "fas fa-circle-notch fa-spin"
      : "fas fa-user-plus";
  },

  setRegisterFeedback(message, isError = false) {
    this.registerFeedback.textContent = message;
    this.registerFeedback.classList.toggle("auth-feedback--error", isError);
    this.registerFeedback.classList.toggle("hidden", !message);
  },
};

window.SignalGenAuth = SignalGenAuth;
