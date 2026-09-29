package api

import (
	"errors"
	"net"
	"net/http"
	"net/mail"
	"strings"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
)

// apiStatus returns public metadata used to identify the active Go API.
func (server *Server) apiStatus(writer http.ResponseWriter, _ *http.Request) {
	writeJSON(writer, http.StatusOK, map[string]string{
		"name":        "SignalGen Go API",
		"version":     "0.9.0",
		"description": "Go authentication, account access, and hybrid analysis API.",
		"docs":        "/backend/openapi.yaml",
		"status":      "ok",
	})
}

// register validates public input and delegates account creation to Supabase.
func (server *Server) register(writer http.ResponseWriter, request *http.Request) {
	if !server.allowPublicAuthRate(writer, request, "auth:register") {
		return
	}
	var input struct {
		FullName string `json:"full_name"`
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := decodeJSON(request, &input); err != nil {
		writeJSONInputError(writer, request, err, "Nama, email, dan password tidak valid.")
		return
	}
	input.FullName = strings.TrimSpace(input.FullName)
	input.Email = normalizeEmail(input.Email)
	if len(input.FullName) < 2 || len(input.FullName) > 100 || !validEmail(input.Email) || !validPassword(input.Password) {
		writeError(writer, request, http.StatusUnprocessableEntity, "INVALID_REQUEST", "Nama, email, atau panjang password tidak valid.")
		return
	}
	if server.auth == nil {
		writeError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Layanan autentikasi belum dikonfigurasi.")
		return
	}
	result, err := server.auth.Register(request.Context(), input.Email, input.Password, input.FullName)
	if err != nil {
		server.writeAuthProviderError(writer, request, err, "Pendaftaran gagal. Periksa data lalu coba kembali.")
		return
	}
	var accessToken interface{}
	if result.AccessToken != "" {
		accessToken = result.AccessToken
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	writeJSON(writer, http.StatusOK, map[string]interface{}{
		"message": func() string {
			if result.AccessToken == "" {
				return "Pendaftaran berhasil. Periksa email untuk konfirmasi akun."
			}
			return "Pendaftaran berhasil."
		}(),
		"requires_email_confirmation": result.AccessToken == "",
		"access_token":                accessToken,
		"user":                        publicUser(result.User),
	})
}

// login exchanges email/password for a short-lived Supabase access token.
func (server *Server) login(writer http.ResponseWriter, request *http.Request) {
	if !server.allowPublicAuthRate(writer, request, "auth:login") {
		return
	}
	var input struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := decodeJSON(request, &input); err != nil {
		writeJSONInputError(writer, request, err, "Email dan password wajib diisi.")
		return
	}
	input.Email = normalizeEmail(input.Email)
	if !validEmail(input.Email) || input.Password == "" || len(input.Password) > 1024 {
		writeError(writer, request, http.StatusUnauthorized, "AUTH_INVALID", "Email atau password salah.")
		return
	}
	if server.auth == nil {
		writeError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Layanan autentikasi belum dikonfigurasi.")
		return
	}
	result, err := server.auth.Login(request.Context(), input.Email, input.Password)
	if err != nil {
		server.writeAuthProviderError(writer, request, err, "Email atau password salah.")
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	writeJSON(writer, http.StatusOK, map[string]interface{}{
		"access_token": result.AccessToken,
		"token_type":   result.TokenType,
		"expires_in":   result.ExpiresIn,
		"user":         publicUser(result.User),
	})
}

// me verifies the bearer token and returns the authenticated identity only.
func (server *Server) me(writer http.ResponseWriter, request *http.Request) {
	principal, ok := server.requirePrincipal(writer, request)
	if !ok {
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	writeJSON(writer, http.StatusOK, publicUser(principal))
}

// requestPasswordReset asks Supabase to email a recovery link. Its response is
// intentionally identical for known and unknown emails to prevent enumeration.
func (server *Server) requestPasswordReset(redirectURL string) http.HandlerFunc {
	return func(writer http.ResponseWriter, request *http.Request) {
		if !server.allowPublicAuthRate(writer, request, "auth:password-reset-request") {
			return
		}
		var input struct {
			Email string `json:"email"`
		}
		if err := decodeJSON(request, &input); err != nil {
			writeJSONInputError(writer, request, err, "Email wajib diisi.")
			return
		}
		input.Email = normalizeEmail(input.Email)
		if !validEmail(input.Email) {
			writeError(writer, request, http.StatusUnprocessableEntity, "INVALID_REQUEST", "Format email tidak valid.")
			return
		}
		if server.auth == nil {
			writeError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Layanan autentikasi belum dikonfigurasi.")
			return
		}
		err := server.auth.RequestPasswordReset(request.Context(), input.Email, redirectURL)
		if err != nil && !errors.Is(err, auth.ErrRecoveryInvalid) {
			server.writeAuthProviderError(writer, request, err, "Permintaan reset password belum dapat diproses.")
			return
		}
		// Deliberately identical for registered and unknown addresses.
		writeJSON(writer, http.StatusOK, map[string]string{
			"message": "Jika akun tersedia, tautan reset password sudah dikirim.",
		})
	}
}

// resetPassword completes a Supabase recovery flow using tokens from the email.
func (server *Server) resetPassword(writer http.ResponseWriter, request *http.Request) {
	if !server.allowPublicAuthRate(writer, request, "auth:password-reset") {
		return
	}
	var input struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		Password     string `json:"password"`
	}
	if err := decodeJSON(request, &input); err != nil {
		writeJSONInputError(writer, request, err, "Token pemulihan dan password wajib diisi.")
		return
	}
	if strings.TrimSpace(input.AccessToken) == "" || strings.TrimSpace(input.RefreshToken) == "" || !validPassword(input.Password) {
		writeError(writer, request, http.StatusUnprocessableEntity, "INVALID_REQUEST", "Token pemulihan atau panjang password tidak valid.")
		return
	}
	if server.auth == nil {
		writeError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Layanan autentikasi belum dikonfigurasi.")
		return
	}
	if err := server.auth.ResetPassword(request.Context(), input.AccessToken, input.RefreshToken, input.Password); err != nil {
		server.writeAuthProviderError(writer, request, err, "Tautan reset tidak valid atau sudah kedaluwarsa.")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]string{"message": "Password berhasil diperbarui."})
}

// writeAuthProviderError maps provider-specific failures to a stable API error.
func (server *Server) writeAuthProviderError(writer http.ResponseWriter, request *http.Request, err error, invalidMessage string) {
	switch {
	case errors.Is(err, auth.ErrCredentialsInvalid):
		writeError(writer, request, http.StatusUnauthorized, "AUTH_INVALID", invalidMessage)
	case errors.Is(err, auth.ErrRegistrationRejected), errors.Is(err, auth.ErrRecoveryInvalid), errors.Is(err, auth.ErrPasswordRejected):
		writeError(writer, request, http.StatusBadRequest, "AUTH_REJECTED", invalidMessage)
	case errors.Is(err, auth.ErrAuthRateLimited):
		writeError(writer, request, http.StatusTooManyRequests, "RATE_LIMITED", "Terlalu banyak permintaan autentikasi; coba lagi nanti.")
	default:
		writeError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Layanan autentikasi sedang tidak tersedia.")
	}
}

// allowPublicAuthRate keys public-auth limits by remote IP because no user is
// authenticated yet.
func (server *Server) allowPublicAuthRate(writer http.ResponseWriter, request *http.Request, operation string) bool {
	return server.allowRate(writer, request, operation, remoteIP(request))
}

// remoteIP extracts the direct peer address. Trusted-proxy handling can be
// added at the deployment boundary if the API later sits behind a proxy.
func remoteIP(request *http.Request) string {
	host, _, err := net.SplitHostPort(request.RemoteAddr)
	if err == nil && host != "" {
		return host
	}
	if trimmed := strings.TrimSpace(request.RemoteAddr); trimmed != "" {
		return trimmed
	}
	return "unknown"
}

func normalizeEmail(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func validEmail(value string) bool {
	address, err := mail.ParseAddress(value)
	return err == nil && address.Address == value && len(value) <= 320
}

func validPassword(value string) bool {
	return len(value) >= 8 && len(value) <= 1024
}

func publicUser(principal auth.Principal) map[string]interface{} {
	return map[string]interface{}{
		"id":        principal.ID,
		"email":     principal.Email,
		"full_name": nullableString(principal.FullName),
	}
}

func nullableString(value string) interface{} {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}
