package account

import (
	"context"
	"encoding/hex"
	"errors"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
)

var ErrStatusConflict = errors.New("account status changed concurrently")

// ManagementRepository is deliberately separate from the ordinary owner profile
// contract. Every operation takes a server-verified operator, never a body actor.
type ManagementRepository interface {
	ListAccounts(context.Context, string, AccountQuery) (AccountPage, error)
	SetStatusAudited(context.Context, string, string, string, StatusUpdate) (ManagedAccount, error)
	ListAccountAudit(context.Context, string, AuditQuery) (AuditPage, error)
}

// ManagedAccount exposes administration metadata only, not rules, features,
// dataset content, token hashes, passwords or the editable private biography.
type ManagedAccount struct {
	UserID    string    `json:"user_id"`
	Email     string    `json:"email"`
	Role      string    `json:"role"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type AccountQuery struct {
	Limit                       int
	After, Role, Status, Search string
}
type AccountPage struct {
	Items      []ManagedAccount `json:"items"`
	NextCursor string           `json:"next_cursor,omitempty"`
}
type StatusUpdate struct {
	Status         string `json:"status"`
	ExpectedStatus string `json:"expected_status"`
	Reason         string `json:"reason"`
}

// Audit DTO intentionally excludes stored before/after JSON. Future audit
// payload additions must not silently expose private data through this endpoint.
type ManagementAudit struct {
	ID           string    `json:"id"` // decimal string: preserve bigint precision in JavaScript
	Actor        string    `json:"actor"`
	Action       string    `json:"action"`
	TargetUserID string    `json:"target_user_id"`
	Feature      string    `json:"feature,omitempty"`
	Reason       string    `json:"reason"`
	RequestID    string    `json:"request_id"`
	CreatedAt    time.Time `json:"created_at"`
}
type AuditQuery struct {
	UserID string
	Limit  int
	Before int64
}
type AuditPage struct {
	Items      []ManagementAudit `json:"items"`
	NextCursor string            `json:"next_cursor,omitempty"`
}

func ValidUserID(value string) bool {
	if len(value) != 36 || value[8] != '-' || value[13] != '-' || value[18] != '-' || value[23] != '-' {
		return false
	}
	compact := strings.ReplaceAll(value, "-", "")
	if len(compact) != 32 {
		return false
	}
	_, err := hex.DecodeString(compact)
	return err == nil
}

func NormalizeAccountQuery(query AccountQuery) (AccountQuery, error) {
	query.Search = strings.TrimSpace(query.Search)
	if !utf8.ValidString(query.Search) || utf8.RuneCountInString(query.Search) > 200 {
		return query, access.ErrInvalidValue
	}
	for _, char := range query.Search {
		if unicode.IsControl(char) {
			return query, access.ErrInvalidValue
		}
	}
	if query.Limit == 0 {
		query.Limit = 25
	}
	if query.Limit < 1 || query.Limit > 100 || (query.After != "" && !ValidUserID(query.After)) ||
		(query.Role != "" && query.Role != access.RoleUser && query.Role != access.RoleOperator) ||
		(query.Status != "" && !validStatus(query.Status)) {
		return query, access.ErrInvalidValue
	}
	return query, nil
}

func NormalizeAuditQuery(query AuditQuery) (AuditQuery, error) {
	if query.Limit == 0 {
		query.Limit = 25
	}
	if !ValidUserID(query.UserID) || query.Limit < 1 || query.Limit > 100 || query.Before < 0 {
		return query, access.ErrInvalidValue
	}
	return query, nil
}

func NormalizeStatusUpdate(input StatusUpdate) (StatusUpdate, error) {
	input.Reason = strings.TrimSpace(input.Reason)
	if !validStatus(input.Status) || !validStatus(input.ExpectedStatus) || !utf8.ValidString(input.Reason) ||
		utf8.RuneCountInString(input.Reason) < 1 || utf8.RuneCountInString(input.Reason) > 500 {
		return input, access.ErrInvalidValue
	}
	for _, char := range input.Reason {
		if unicode.IsControl(char) {
			return input, access.ErrInvalidValue
		}
	}
	return input, nil
}

func validStatus(status string) bool {
	return status == access.StatusActive || status == access.StatusSuspended
}
func auditCursor(id int64) string { return strconv.FormatInt(id, 10) }
