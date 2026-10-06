package account

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

var (
	ErrProfileInvalid  = errors.New("invalid profile update")
	ErrProfileConflict = errors.New("profile version conflict")
)

// Profile is editable presentation data, not the account's authorization state.
// Email/password belong to Supabase Auth; role/status remain server-controlled.
type Profile struct {
	UserID      string    `json:"user_id"`
	DisplayName string    `json:"display_name"`
	Bio         string    `json:"bio"`
	Version     int64     `json:"version"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// UpdateProfileInput is a partial update. Version comes from the last GET so
// concurrent browser tabs cannot silently overwrite each other's changes.
type UpdateProfileInput struct {
	DisplayName *string `json:"display_name"`
	Bio         *string `json:"bio"`
	Version     int64   `json:"version"`
}

// ProfileRepository never accepts an owner in the profile payload. The caller
// must pass the server-verified user ID as the separate ownership argument.
type ProfileRepository interface {
	Profile(context.Context, string) (Profile, error)
	UpdateProfile(context.Context, string, UpdateProfileInput) (Profile, error)
}

// NormalizeProfileUpdate is shared by the HTTP boundary and repository. Calling
// a repository directly must not bypass input validation.
func NormalizeProfileUpdate(input UpdateProfileInput) (UpdateProfileInput, error) {
	if input.Version < 1 || (input.DisplayName == nil && input.Bio == nil) {
		return input, ErrProfileInvalid
	}
	if input.DisplayName != nil {
		value := strings.TrimSpace(*input.DisplayName)
		if !validProfileText(value, 100, false) {
			return input, ErrProfileInvalid
		}
		input.DisplayName = &value
	}
	if input.Bio != nil {
		value := strings.TrimSpace(*input.Bio)
		if !validProfileText(value, 280, true) {
			return input, ErrProfileInvalid
		}
		input.Bio = &value
	}
	return input, nil
}

func validProfileText(value string, max int, multiline bool) bool {
	if !utf8.ValidString(value) || utf8.RuneCountInString(value) > max {
		return false
	}
	for _, char := range value {
		if unicode.IsControl(char) && !(multiline && (char == '\n' || char == '\r' || char == '\t')) {
			return false
		}
	}
	return true
}
