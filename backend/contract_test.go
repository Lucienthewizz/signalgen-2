package contract

import (
	"strings"
	"testing"

	"github.com/goccy/go-yaml"
)

func TestOpenAPIDocumentAndLocalReferences(t *testing.T) {
	var document map[string]any
	if err := yaml.Unmarshal([]byte(OpenAPI()), &document); err != nil {
		t.Fatal(err)
	}
	if Version() != "0.14.0" {
		t.Fatal("unexpected API version")
	}
	var walk func(any)
	walk = func(value any) {
		switch node := value.(type) {
		case map[string]any:
			if ref, ok := node["$ref"].(string); ok && strings.HasPrefix(ref, "#/") {
				var target any = document
				for _, part := range strings.Split(strings.TrimPrefix(ref, "#/"), "/") {
					m, ok := target.(map[string]any)
					if !ok {
						t.Fatalf("invalid reference %s", ref)
					}
					target, ok = m[part]
					if !ok {
						t.Fatalf("missing reference %s", ref)
					}
				}
			}
			for _, child := range node {
				walk(child)
			}
		case []any:
			for _, child := range node {
				walk(child)
			}
		}
	}
	walk(document)
}
