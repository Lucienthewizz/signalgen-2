// Package contract embeds the reviewed API contract in the executable. Docker
// and local builds serve the same document without reading the working tree.
package contract

import (
	_ "embed"
	"strings"
)

//go:embed openapi.yaml
var document string

// OpenAPI returns an immutable string, so callers cannot modify shared bytes.
func OpenAPI() string { return document }

// Version reads the info block from our checked-in, validated document. This
// deliberately avoids a second version constant drifting away from OpenAPI.
func Version() string {
	_, info, ok := strings.Cut(document, "\ninfo:\n")
	if !ok {
		return "unknown"
	}
	for _, line := range strings.Split(info, "\n") {
		if line != "" && !strings.HasPrefix(line, " ") {
			break
		}
		if value, ok := strings.CutPrefix(line, "  version: "); ok {
			return strings.Trim(strings.TrimSpace(value), "\"'")
		}
	}
	return "unknown"
}
