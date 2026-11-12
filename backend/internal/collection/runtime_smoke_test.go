package collection

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

// Opt-in compiled-binary smoke, not an exact Dockerfile image test.
func TestCollectorRuntimeSmoke(t *testing.T) {
	binary := os.Getenv("SIGNALGEN_TEST_COLLECTOR_BINARY")
	if binary == "" {
		t.Skip("set SIGNALGEN_TEST_COLLECTOR_BINARY to an isolated matching build")
	}
	run := func(args ...string) string {
		t.Helper()
		cmd := exec.CommandContext(context.Background(), binary, args...)
		cmd.Env = os.Environ() // The verification container supplies only the explicit safe allowlist.
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("collector %v: %v\n%s", args, err, out)
		}
		return string(out)
	}
	if help := run("-h"); !strings.Contains(help, "prune-only") || !strings.Contains(help, "incremental") {
		t.Fatal("collector flags missing")
	}
	catalog := filepath.Join(t.TempDir(), "catalog.csv")
	if err := os.WriteFile(catalog, []byte("Kode,Nama Perusahaan,Tanggal Pencatatan\nBBCA,Synthetic bank,31 Mei 2000\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if out := run("-catalog", catalog, "-as-of", "2026-01-20", "-validate-only"); !strings.Contains(out, "Validation only; no price download") {
		t.Fatal(out)
	}
	// Existing synthetic provider fixtures make five immutable publications.
	root, generations := retentionFixture(t)
	before, err := os.ReadFile(filepath.Join(root, "current.json"))
	if err != nil {
		t.Fatal(err)
	}
	out := run("-out", root, "-prune-only", "-retention-dry-run", "-keep-generations", "2")
	if !strings.Contains(out, "eligible=3") {
		t.Fatalf("dry-run did not inspect retired generations: %s", out)
	}
	for _, generation := range generations {
		if _, err := os.Stat(filepath.Join(root, generation)); err != nil {
			t.Fatal("dry-run deleted a generation", err)
		}
	}
	after, err := os.ReadFile(filepath.Join(root, "current.json"))
	if err != nil || string(before) != string(after) {
		t.Fatal("dry-run changed publication", err)
	}
	// The adapter must work with a read-only published store, without a provider request.
	err = filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return os.Chmod(path, 0500)
		}
		return os.Chmod(path, 0400)
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
			if err == nil && info.IsDir() {
				return os.Chmod(path, 0700)
			}
			return err
		})
	})
	store, err := NewStoreProvider(root)
	if err != nil {
		t.Fatal(err)
	}
	item := universe.Instrument{Symbol: "BBCA.JK", ProviderSymbol: "BBCA.JK"}
	_, options, _ := syncFixture(t)
	history, err := store.DailyHistory(context.Background(), item, options.From.AddDate(0, 0, 4), options.To)
	if err != nil || len(history.Series.Candles) < 1800 {
		t.Fatalf("read-only store: %v", err)
	}
	t.Log("PASS: compiled collector help, synthetic validate-only, incremental publications, read-only store and prune dry-run; no Yahoo")
}
