package apitests

import (
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// Feature adapters must not depend on the API composition root or SQL drivers.
// This guards the folder responsibilities, not just the endpoint behavior.
func TestHTTPFeaturePackageBoundaries(t *testing.T) {
	err := filepath.WalkDir("..", func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") || filepath.Dir(path) == ".." {
			return nil
		}
		file, err := parser.ParseFile(token.NewFileSet(), path, nil, parser.ImportsOnly)
		if err != nil {
			return err
		}
		for _, spec := range file.Imports {
			dependency, err := strconv.Unquote(spec.Path.Value)
			if err != nil {
				return err
			}
			if dependency == "github.com/Lucienthewizz/signalgen-2/backend/internal/api" || dependency == "database/sql" || strings.HasPrefix(dependency, "github.com/jackc/pgx") || dependency == "modernc.org/sqlite" {
				t.Errorf("%s imports %s: adapters must use domain contracts instead", path, dependency)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
