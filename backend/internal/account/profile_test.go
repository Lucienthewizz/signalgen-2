package account

import (
	"errors"
	"strings"
	"testing"
)

func textPointer(value string) *string { return &value }

func TestNormalizeProfileUpdate(t *testing.T) {
	for _, tc := range []struct {
		name    string
		input   UpdateProfileInput
		invalid bool
	}{
		{"name", UpdateProfileInput{DisplayName: textPointer("  Lucien  "), Version: 1}, false},
		{"unicode", UpdateProfileInput{DisplayName: textPointer(strings.Repeat("界", 100)), Version: 1}, false},
		{"clear", UpdateProfileInput{Bio: textPointer(""), Version: 2}, false},
		{"multiline", UpdateProfileInput{Bio: textPointer("Hello\nworld"), Version: 1}, false},
		{"empty", UpdateProfileInput{Version: 1}, true},
		{"version", UpdateProfileInput{Bio: textPointer("bio")}, true},
		{"long_name", UpdateProfileInput{DisplayName: textPointer(strings.Repeat("界", 101)), Version: 1}, true},
		{"long_bio", UpdateProfileInput{Bio: textPointer(strings.Repeat("x", 281)), Version: 1}, true},
		{"control_name", UpdateProfileInput{DisplayName: textPointer("a\nb"), Version: 1}, true},
		{"control_bio", UpdateProfileInput{Bio: textPointer("a\x00b"), Version: 1}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			input, err := NormalizeProfileUpdate(tc.input)
			if errors.Is(err, ErrProfileInvalid) != tc.invalid {
				t.Fatalf("error = %v", err)
			}
			if !tc.invalid && input.DisplayName != nil && *input.DisplayName != strings.TrimSpace(*tc.input.DisplayName) {
				t.Fatal("name not normalized")
			}
		})
	}
}
