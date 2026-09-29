package session

import (
	"errors"
	"time"
)

var (
	ErrInvalid        = errors.New("app session is invalid")
	ErrExpired        = errors.New("app session is expired")
	ErrRevoked        = errors.New("app session is revoked")
	ErrInvalidRequest = errors.New("invalid session request")
	ErrNotFound       = errors.New("app session was not found")
	ErrSessionLimit   = errors.New("active session limit reached")
	ErrDeviceCooldown = errors.New("device switch cooldown is active")
)

type Session struct {
	ID             string     `json:"id"`
	UserID         string     `json:"-"`
	InstallationID string     `json:"installation_id"`
	Label          string     `json:"label"`
	CreatedAt      time.Time  `json:"created_at"`
	ExpiresAt      time.Time  `json:"expires_at"`
	LastSeenAt     time.Time  `json:"last_seen_at"`
	RevokedAt      *time.Time `json:"revoked_at,omitempty"`
}

type Created struct {
	Session Session `json:"session"`
	Token   string  `json:"session_token"`
}

type Device struct {
	ID         string    `json:"id"`
	Label      string    `json:"label"`
	Status     string    `json:"status"`
	CreatedAt  time.Time `json:"created_at"`
	LastSeenAt time.Time `json:"last_seen_at"`
}
