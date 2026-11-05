package authapi

import (
	"encoding/base64"
	"errors"
	"net/http"
	"net/url"
	"regexp"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/api/shared"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
)

var pkceVerifier = regexp.MustCompile(`^[A-Za-z0-9._~-]{43,128}$`)

// StartGoogle accepts only our fixed callback on an explicitly trusted frontend
// origin. Neither Host/forwarded headers nor client JSON can add a redirect host.
func (server *Handler) StartGoogle(origins map[string]struct{}) http.HandlerFunc {
	return func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Cache-Control", "private, no-store")
		if !server.allowPublicAuthRate(writer, request, "auth:google-start") {
			return
		}
		var input struct {
			RedirectTo string `json:"redirect_to"`
			Challenge  string `json:"code_challenge"`
		}
		if err := shared.DecodeJSON(request, &input); err != nil {
			shared.WriteJSONInputError(writer, request, err, "Permintaan login Google tidak valid.")
			return
		}
		callback, err := url.Parse(input.RedirectTo)
		validOrigin := false
		if err == nil {
			_, validOrigin = origins[callback.Scheme+"://"+callback.Host]
		}
		proof, proofErr := base64.RawURLEncoding.DecodeString(input.Challenge)
		if !validOrigin || callback.User != nil || callback.Path != "/auth/google/callback" || callback.RawPath != "" || callback.RawQuery != "" || callback.Fragment != "" || proofErr != nil || len(proof) != 32 || len(input.Challenge) != 43 {
			shared.WriteError(writer, request, http.StatusUnprocessableEntity, "INVALID_REQUEST", "Callback atau bukti login Google tidak valid.")
			return
		}
		provider, ok := server.Auth.(auth.OAuthService)
		if !ok {
			shared.WriteError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Login Google belum tersedia.")
			return
		}
		authorizationURL, err := provider.GoogleAuthorizationURL(request.Context(), input.RedirectTo, input.Challenge)
		if errors.Is(err, auth.ErrGoogleNotConfigured) {
			shared.WriteError(writer, request, http.StatusServiceUnavailable, "GOOGLE_NOT_CONFIGURED", "Google sign-in is not configured yet. Use email and password, or finish the Google provider setup in Supabase.")
			return
		}
		if err != nil {
			server.writeAuthProviderError(writer, request, err, "Login Google belum tersedia.")
			return
		}
		shared.WriteJSON(writer, http.StatusOK, map[string]string{"url": authorizationURL})
	}
}

func (server *Handler) ExchangeGoogle(writer http.ResponseWriter, request *http.Request) {
	writer.Header().Set("Cache-Control", "private, no-store")
	if !server.allowPublicAuthRate(writer, request, "auth:google-exchange") {
		return
	}
	var input struct {
		Code     string `json:"code"`
		Verifier string `json:"code_verifier"`
	}
	if err := shared.DecodeJSON(request, &input); err != nil {
		shared.WriteJSONInputError(writer, request, err, "Kode login Google tidak valid.")
		return
	}
	if input.Code == "" || len(input.Code) > 4096 || !pkceVerifier.MatchString(input.Verifier) {
		shared.WriteError(writer, request, http.StatusUnprocessableEntity, "INVALID_REQUEST", "Kode atau bukti login Google tidak valid.")
		return
	}
	provider, ok := server.Auth.(auth.OAuthService)
	if !ok {
		shared.WriteError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Login Google belum tersedia.")
		return
	}
	result, err := provider.ExchangeOAuthCode(request.Context(), input.Code, input.Verifier)
	if err != nil {
		server.writeAuthProviderError(writer, request, err, "Login Google kedaluwarsa atau dibatalkan. Silakan mulai lagi.")
		return
	}
	shared.WriteJSON(writer, http.StatusOK, map[string]interface{}{
		"access_token": result.AccessToken, "refresh_token": result.RefreshToken,
		"token_type": result.TokenType, "expires_in": result.ExpiresIn, "user": publicUser(result.User),
	})
}
