package collection

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

func retentionFixture(t *testing.T) (string, []string) {
	t.Helper()
	c, o, p := syncFixture(t)
	names := []string{}
	for i := 0; i < 5; i++ {
		if _, err := Sync(context.Background(), c, p, o, 7, nil); err != nil {
			t.Fatal(err)
		}
		a, err := publishedArchive(o.Directory)
		if err != nil {
			t.Fatal(err)
		}
		names = append(names, filepath.Base(a.directory))
		o.To = o.To.AddDate(0, 0, 1)
		o.From = o.To.AddDate(-5, 0, 0)
	}
	index, err := readRetirements(o.Directory)
	if err != nil {
		t.Fatal(err)
	}
	for i, name := range names[:4] {
		index.Retired[name] = time.Now().Add(time.Duration(-10+i) * 24 * time.Hour).UTC().Format(time.RFC3339Nano)
	}
	if err = writeJSON(filepath.Join(o.Directory, "retired.json"), index); err != nil {
		t.Fatal(err)
	}
	return o.Directory, names
}
func TestRetentionDryRunAndApplyPreserveCurrentAndRollback(t *testing.T) {
	root, names := retentionFixture(t)
	options := RetentionOptions{Keep: 2, MinAge: 72 * time.Hour, DryRun: true}
	result, err := Prune(context.Background(), root, options)
	if err != nil || len(result.Eligible) != 3 || len(result.Removed) != 0 {
		t.Fatalf("dry run: %+v %v", result, err)
	}
	for _, name := range names {
		if _, err = os.Stat(filepath.Join(root, name)); err != nil {
			t.Fatal("dry run removed data", err)
		}
	}
	options.DryRun = false
	result, err = Prune(context.Background(), root, options)
	if err != nil || len(result.Removed) != 3 {
		t.Fatalf("apply: %+v %v", result, err)
	}
	for _, name := range names[3:] {
		if _, err = os.Stat(filepath.Join(root, name)); err != nil {
			t.Fatal("removed current or rollback", err)
		}
	}
	provider, err := NewStoreProvider(root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = provider.Daily(context.Background(), []universe.Instrument{{Symbol: "BBCA.JK", ProviderSymbol: "BBCA.JK"}}, 20); err != nil {
		t.Fatal("current no longer readable", err)
	}
	result, err = Prune(context.Background(), root, options)
	if err != nil || len(result.Removed) != 0 {
		t.Fatalf("not idempotent: %+v %v", result, err)
	}
}
func TestRetentionGraceIsSinceRetirement(t *testing.T) {
	root, names := retentionFixture(t)
	index, _ := readRetirements(root)
	index.Retired[names[0]] = time.Now().Add(-time.Hour).UTC().Format(time.RFC3339Nano)
	writeJSON(filepath.Join(root, "retired.json"), index)
	// The most recently retired generation is protected by Keep; the previous
	// one is protected by the age gate even when it falls outside Keep.
	index.Retired[names[1]] = time.Now().Add(-2 * time.Hour).UTC().Format(time.RFC3339Nano)
	writeJSON(filepath.Join(root, "retired.json"), index)
	r, err := Prune(context.Background(), root, RetentionOptions{Keep: 2, MinAge: 72 * time.Hour})
	if err != nil || len(r.Removed) != 2 {
		t.Fatalf("grace: %+v %v", r, err)
	}
	for _, name := range names[:2] {
		if _, err = os.Stat(filepath.Join(root, name)); err != nil {
			t.Fatal("recent retirement removed", err)
		}
	}
}
func TestRetentionSkipsForeignLinksAndActiveGeneration(t *testing.T) {
	root, names := retentionFixture(t)
	os.WriteFile(filepath.Join(root, names[0], "notes.txt"), []byte("operator file"), 0600)
	target := filepath.Join(t.TempDir(), "keep.txt")
	os.WriteFile(target, []byte("keep"), 0600)
	os.Remove(filepath.Join(root, names[1], "BBCA.json"))
	if err := os.Symlink(target, filepath.Join(root, names[1], "BBCA.json")); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(root, names[2], ".collect.lock"), nil, 0600)
	r, err := Prune(context.Background(), root, RetentionOptions{Keep: 2, MinAge: 72 * time.Hour})
	if err != nil || len(r.Removed) != 0 || len(r.Skipped) != 3 {
		t.Fatalf("unsafe candidates: %+v %v", r, err)
	}
	if b, err := os.ReadFile(target); err != nil || string(b) != "keep" {
		t.Fatal("symlink target modified")
	}
}
func TestRetentionRejectsLockAndInvalidPolicyAndCancellation(t *testing.T) {
	root, _ := retentionFixture(t)
	valid := RetentionOptions{Keep: 2, MinAge: 72 * time.Hour}
	os.WriteFile(filepath.Join(root, ".sync.lock"), nil, 0600)
	if _, err := Prune(context.Background(), root, valid); err == nil {
		t.Fatal("active sync accepted")
	}
	os.Remove(filepath.Join(root, ".sync.lock"))
	for _, o := range []RetentionOptions{{Keep: 1, MinAge: 72 * time.Hour}, {Keep: 2, MinAge: time.Hour}} {
		if _, err := Prune(context.Background(), root, o); err == nil {
			t.Fatal("unsafe policy accepted")
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := Prune(ctx, root, valid); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation lost: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, ".sync.lock")); !os.IsNotExist(err) {
		t.Fatal("cleanup leaked lock")
	}
}
func TestRetentionSkipsIncompleteAndRejectsUnsafeIndex(t *testing.T) {
	root, names := retentionFixture(t)
	directory := filepath.Join(root, names[0])
	r, _ := readReport(directory)
	r.Entries[0].Status = "failed"
	r.Entries[0].Error = "provider_unavailable"
	writeJSON(filepath.Join(directory, "report.json"), r)
	out, err := Prune(context.Background(), root, RetentionOptions{Keep: 2, MinAge: 72 * time.Hour})
	if err != nil || len(out.Skipped) != 1 {
		t.Fatalf("incomplete folder: %+v %v", out, err)
	}
	if _, err = os.Stat(directory); err != nil {
		t.Fatal("incomplete generation deleted")
	}
	writeJSON(filepath.Join(root, "retired.json"), retirementIndex{Schema: "idx-retention-1", Retired: map[string]string{"generation-../../outside": time.Now().Format(time.RFC3339)}})
	if _, err = Prune(context.Background(), root, RetentionOptions{Keep: 2, MinAge: 72 * time.Hour}); err == nil {
		t.Fatal("unsafe index accepted")
	}
}

func TestRetentionPreservesRollbackWhenCurrentSnapshotIsCorrupt(t *testing.T) {
	root, names := retentionFixture(t)
	if err := os.WriteFile(filepath.Join(root, names[4], "BBCA.json"), []byte(`{}`), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := Prune(context.Background(), root, RetentionOptions{Keep: 2, MinAge: 72 * time.Hour}); err == nil {
		t.Fatal("pruned rollback while current snapshot corrupt")
	}
	for _, name := range names {
		if _, err := os.Stat(filepath.Join(root, name)); err != nil {
			t.Fatal("rollback lost", err)
		}
	}
}

func TestRetentionKeepsNewestValidRollback(t *testing.T) {
	root, names := retentionFixture(t)
	if err := os.WriteFile(filepath.Join(root, names[3], "operator-notes.txt"), []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	result, err := Prune(context.Background(), root, RetentionOptions{Keep: 2, MinAge: 72 * time.Hour})
	if err != nil || len(result.Removed) != 2 {
		t.Fatalf("rollback selection: %+v %v", result, err)
	}
	if _, err = os.Stat(filepath.Join(root, names[2])); err != nil {
		t.Fatal("newest valid rollback removed", err)
	}
}
