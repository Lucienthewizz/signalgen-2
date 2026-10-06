package authapi

import (
	"errors"
	"net"
	"net/http"
	"net/mail"
	"strings"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/api/shared"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
)

// Register validates public input and delegates account creation to Supabase.
func (server *Handler) Register(writer http.ResponseWriter, request *http.Request) {
	if !server.allowPublicAuthRate(writer, request, "auth:register") {
		return
	}
	var input struct {
		FullName string `json:"full_name"`
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := shared.DecodeJSON(request, &input); err != nil {
		shared.WriteJSONInputError(writer, request, err, "Nama, email, dan password tidak valid.")
		return
	}
	input.FullName = strings.TrimSpace(input.FullName)
	input.Email = normalizeEmail(input.Email)
	if len(input.FullName) < 2 || len(input.FullName) > 100 || !validEmail(input.Email) || !validPassword(input.Password) {
		shared.WriteError(writer, request, http.StatusUnprocessableEntity, "INVALID_REQUEST", "Nama, email, atau panjang password tidak valid.")
		return
	}
	if server.Auth == nil {
		shared.WriteError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Layanan autentikasi belum dikonfigurasi.")
		return
	}
	result, err := server.Auth.Register(request.Context(), input.Email, input.Password, input.FullName)
	if err != nil {
		server.writeAuthProviderError(writer, request, err, "Pendaftaran gagal. Periksa data lalu coba kembali.")
		return
	}
	var accessToken interface{}
	var refreshToken interface{}
	if result.AccessToken != "" {
		accessToken = result.AccessToken
		refreshToken = result.RefreshToken
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	shared.WriteJSON(writer, http.StatusOK, map[string]interface{}{
		"message": func() string {
			if result.AccessToken == "" {
				return "Pendaftaran berhasil. Periksa email untuk konfirmasi akun."
			}
			return "Pendaftaran berhasil."
		}(),
		"requires_email_confirmation": result.AccessToken == "",
		"access_token":                accessToken,
		"refresh_token":               refreshToken,
		"token_type":                  result.TokenType,
		"expires_in":                  result.ExpiresIn,
		"user":                        publicUser(result.User),
	})
}

// Login exchanges email/password for a short-lived Supabase access token.
func (server *Handler) Login(writer http.ResponseWriter, request *http.Request) {
	if !server.allowPublicAuthRate(writer, request, "auth:login") {
		return
	}
	var input struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := shared.DecodeJSON(request, &input); err != nil {
		shared.WriteJSONInputError(writer, request, err, "Email dan password wajib diisi.")
		return
	}
	input.Email = normalizeEmail(input.Email)
	if !validEmail(input.Email) || input.Password == "" || len(input.Password) > 1024 {
		shared.WriteError(writer, request, http.StatusUnauthorized, "AUTH_INVALID", "Email atau password salah.")
		return
	}
	if server.Auth == nil {
		shared.WriteError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Layanan autentikasi belum dikonfigurasi.")
		return
	}
	result, err := server.Auth.Login(request.Context(), input.Email, input.Password)
	if err != nil {
		server.writeAuthProviderError(writer, request, err, "Email atau password salah.")
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	shared.WriteJSON(writer, http.StatusOK, map[string]interface{}{
		"access_token":  result.AccessToken,
		"refresh_token": result.RefreshToken,
		"token_type":    result.TokenType,
		"expires_in":    result.ExpiresIn,
		"user":          publicUser(result.User),
	})
}

// RefreshAuth accepts a refresh token rather than an access bearer, because
// the access token may already be expired. The returned pair replaces both
// client tokens; server-owned app-session expiry and permissions stay intact.
func (server *Handler) RefreshAuth(writer http.ResponseWriter, request *http.Request) {
	writer.Header().Set("Cache-Control", "private, no-store")
	if !server.allowPublicAuthRate(writer, request, "auth:refresh") {
		return
	}
	var input struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := shared.DecodeJSON(request, &input); err != nil {
		shared.WriteJSONInputError(writer, request, err, "Refresh token wajib diisi.")
		return
	}
	if strings.TrimSpace(input.RefreshToken) == "" || len(input.RefreshToken) > 4096 {
		shared.WriteError(writer, request, http.StatusUnprocessableEntity, "INVALID_REQUEST", "Refresh token tidak valid.")
		return
	}
	if server.Auth == nil {
		shared.WriteError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Layanan autentikasi belum dikonfigurasi.")
		return
	}
	result, err := server.Auth.Refresh(request.Context(), input.RefreshToken)
	if err != nil {
		server.writeAuthProviderError(writer, request, err, "Sesi login tidak valid. Silakan login kembali.")
		return
	}
	shared.WriteJSON(writer, http.StatusOK, map[string]interface{}{
		"access_token": result.AccessToken, "refresh_token": result.RefreshToken,
		"token_type": result.TokenType, "expires_in": result.ExpiresIn,
		"user": publicUser(result.User),
	})
}

// Me verifies the bearer token and returns the authenticated identity only.
func (server *Handler) Me(writer http.ResponseWriter, request *http.Request) {
	principal, ok := server.RequirePrincipal(writer, request)
	if !ok {
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	shared.WriteJSON(writer, http.StatusOK, publicUser(principal))
}

// RequestPasswordReset asks Supabase to email a recovery link. Its response is
// intentionally identical for known and unknown emails to prevent enumeration.
func (server *Handler) RequestPasswordReset(redirectURL string) http.HandlerFunc {
	return func(writer http.ResponseWriter, request *http.Request) {
		if !server.allowPublicAuthRate(writer, request, "auth:password-reset-request") {
			return
		}
		var input struct {
			Email string `json:"email"`
		}
		if err := shared.DecodeJSON(request, &input); err != nil {
			shared.WriteJSONInputError(writer, request, err, "Email wajib diisi.")
			return
		}
		input.Email = normalizeEmail(input.Email)
		if !validEmail(input.Email) {
			shared.WriteError(writer, request, http.StatusUnprocessableEntity, "INVALID_REQUEST", "Format email tidak valid.")
			return
		}
		if server.Auth == nil {
			shared.WriteError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Layanan autentikasi belum dikonfigurasi.")
			return
		}
		err := server.Auth.RequestPasswordReset(request.Context(), input.Email, redirectURL)
		if err != nil && !errors.Is(err, auth.ErrRecoveryInvalid) {
			server.writeAuthProviderError(writer, request, err, "Permintaan reset password belum dapat diproses.")
			return
		}
		// Deliberately identical for registered and unknown addresses.
		shared.WriteJSON(writer, http.StatusOK, map[string]string{
			"message": "Jika akun tersedia, tautan reset password sudah dikirim.",
		})
	}
}

// ResetPassword completes a Supabase recovery flow using tokens from the email.
func (server *Handler) ResetPassword(writer http.ResponseWriter, request *http.Request) {
	if !server.allowPublicAuthRate(writer, request, "auth:password-reset") {
		return
	}
	var input struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		Password     string `json:"password"`
	}
	if err := shared.DecodeJSON(request, &input); err != nil {
		shared.WriteJSONInputError(writer, request, err, "Token pemulihan dan password wajib diisi.")
		return
	}
	if strings.TrimSpace(input.AccessToken) == "" || strings.TrimSpace(input.RefreshToken) == "" || !validPassword(input.Password) {
		shared.WriteError(writer, request, http.StatusUnprocessableEntity, "INVALID_REQUEST", "Token pemulihan atau panjang password tidak valid.")
		return
	}
	if server.Auth == nil {
		shared.WriteError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Layanan autentikasi belum dikonfigurasi.")
		return
	}
	if err := server.Auth.ResetPassword(request.Context(), input.AccessToken, input.RefreshToken, input.Password); err != nil {
		server.writeAuthProviderError(writer, request, err, "Tautan reset tidak valid atau sudah kedaluwarsa.")
		return
	}
	shared.WriteJSON(writer, http.StatusOK, map[string]string{"message": "Password berhasil diperbarui."})
}

// writeAuthProviderError maps provider-specific failures to a stable API error.
func (server *Handler) writeAuthProviderError(writer http.ResponseWriter, request *http.Request, err error, invalidMessage string) {
	switch {
	case errors.Is(err, auth.ErrCredentialsInvalid), errors.Is(err, auth.ErrRefreshInvalid):
		shared.WriteError(writer, request, http.StatusUnauthorized, "AUTH_INVALID", invalidMessage)
	case errors.Is(err, auth.ErrRegistrationRejected), errors.Is(err, auth.ErrRecoveryInvalid), errors.Is(err, auth.ErrPasswordRejected):
		shared.WriteError(writer, request, http.StatusBadRequest, "AUTH_REJECTED", invalidMessage)
	case errors.Is(err, auth.ErrAuthRateLimited):
		shared.WriteError(writer, request, http.StatusTooManyRequests, "RATE_LIMITED", "Terlalu banyak permintaan autentikasi; coba lagi nanti.")
	default:
		shared.WriteError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Layanan autentikasi sedang tidak tersedia.")
	}
}

// allowPublicAuthRate keys public-auth limits by remote IP because no user is
// authenticated yet.
func (server *Handler) allowPublicAuthRate(writer http.ResponseWriter, request *http.Request, operation string) bool {
	return server.AllowRate(writer, request, operation, remoteIP(request))
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
