package auth

import (
	"context"
	"errors"
	"strings"
	"time"

	platformhttp "github.com/Lucienthewizz/signalgen-2/backend/internal/platform/http"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

type publicKeyVerifier struct {
	issuer string
	keys   *publicKeys
}

type userClaims struct {
	jwt.RegisteredClaims
	Email     string `json:"email"`
	Role      string `json:"role"`
	SessionID string `json:"session_id"`
	Metadata  struct {
		FullName string `json:"full_name"`
	} `json:"user_metadata"`
}

func newPublicKeyVerifier(issuer string, client HTTPClient) *publicKeyVerifier {
	return &publicKeyVerifier{issuer: issuer, keys: &publicKeys{url: issuer + "/.well-known/jwks.json", client: client}}
}

func (verifier *publicKeyVerifier) verify(ctx context.Context, raw string, remote func(context.Context, string) (Principal, error)) (Principal, error) {
	if len(raw) > 16*1024 {
		return Principal{}, ErrTokenInvalid
	}
	// This untrusted header only selects a verification method, never an identity.
	header, _, err := jwt.NewParser().ParseUnverified(raw, &userClaims{})
	if err != nil {
		return Principal{}, ErrTokenInvalid
	}
	if header.Method.Alg() == "HS256" {
		return remote(ctx, raw)
	}
	started := time.Now()
	defer func() { platformhttp.RecordTiming(ctx, platformhttp.AuthLocal, time.Since(started)) }()
	claims := &userClaims{}
	token, err := jwt.ParseWithClaims(raw, claims, func(token *jwt.Token) (any, error) {
		kid, _ := token.Header["kid"].(string)
		if strings.TrimSpace(kid) == "" || len(kid) > 128 {
			return nil, ErrTokenInvalid
		}
		return verifier.keys.key(ctx, kid, token.Method.Alg())
	}, jwt.WithValidMethods([]string{"ES256", "RS256"}), jwt.WithIssuer(verifier.issuer),
		jwt.WithAudience("authenticated"), jwt.WithExpirationRequired(), jwt.WithIssuedAt())
	if err != nil {
		if errors.Is(err, ErrProviderUnavailable) {
			return Principal{}, ErrProviderUnavailable
		}
		return Principal{}, ErrTokenInvalid
	}
	if !token.Valid || claims.Role != "authenticated" || claims.IssuedAt == nil ||
		!validUUID(claims.Subject) || !validUUID(claims.SessionID) {
		return Principal{}, ErrTokenInvalid
	}
	// User metadata is presentation only; role/status/entitlement come from DB.
	return Principal{ID: claims.Subject, Email: claims.Email, FullName: claims.Metadata.FullName}, nil
}

func validUUID(value string) bool {
	id, err := uuid.Parse(value)
	return err == nil && id != uuid.Nil
}
