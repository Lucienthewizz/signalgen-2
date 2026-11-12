package collection

import (
	"context"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type retirementIndex struct {
	Schema  string            `json:"schema"`
	Retired map[string]string `json:"retired"`
}
type RetentionOptions struct {
	Keep   int
	MinAge time.Duration
	DryRun bool
}
type RetentionResult struct {
	Eligible []string `json:"eligible"`
	Removed  []string `json:"removed"`
	Skipped  []string `json:"skipped"`
}

func validGeneration(name string) bool {
	if !strings.HasPrefix(name, "generation-") || len(name) != 43 {
		return false
	}
	_, err := hex.DecodeString(strings.TrimPrefix(name, "generation-"))
	return err == nil && strings.ToLower(name) == name
}
func readRetirements(root string) (retirementIndex, error) {
	index := retirementIndex{Schema: "idx-retention-1", Retired: map[string]string{}}
	err := readJSON(filepath.Join(root, "retired.json"), &index)
	if os.IsNotExist(err) {
		return index, nil
	}
	if err != nil {
		return index, err
	}
	if index.Schema != "idx-retention-1" || index.Retired == nil {
		return index, fmt.Errorf("invalid retirement index")
	}
	for name, stamp := range index.Retired {
		if !validGeneration(name) {
			return index, fmt.Errorf("invalid retirement path")
		}
		if _, err = time.Parse(time.RFC3339Nano, stamp); err != nil {
			return index, fmt.Errorf("invalid retirement timestamp")
		}
	}
	return index, nil
}
func publishGeneration(root, name string, previous *ArchiveProvider) error {
	if previous != nil {
		index, err := readRetirements(root)
		if err != nil {
			return err
		}
		index.Retired[filepath.Base(previous.directory)] = time.Now().UTC().Format(time.RFC3339Nano)
		if err = writeJSON(filepath.Join(root, "retired.json"), index); err != nil {
			return err
		}
	}
	return writeJSON(filepath.Join(root, "current.json"), Publication{Schema: "idx-store-1", Generation: name})
}

// Prune serializes with Sync and removes only recognized, complete, retired
// generations. MinAge starts at retirement, not creation of an old publication.
// API requests must finish within this grace period. No live data is pruned.
func Prune(ctx context.Context, directory string, options RetentionOptions) (RetentionResult, error) {
	out := RetentionResult{Eligible: []string{}, Removed: []string{}, Skipped: []string{}}
	if options.Keep < 2 || options.MinAge < 24*time.Hour {
		return out, fmt.Errorf("retention requires at least two generations and a 24-hour retirement grace")
	}
	root, err := os.OpenRoot(directory)
	if err != nil {
		return out, err
	}
	defer root.Close()
	lock, err := root.OpenFile(".sync.lock", os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return out, fmt.Errorf("incremental store is locked: %w", err)
	}
	lock.Close()
	defer root.Remove(".sync.lock")
	current, err := publishedArchive(directory)
	if err != nil {
		return out, err
	}
	for _, instrument := range current.items {
		if err = ctx.Err(); err != nil {
			return out, err
		}
		if _, err = readSnapshot(current.directory, instrument, current.from, current.to); err != nil {
			return out, fmt.Errorf("current publication is invalid; retain rollback archives: %w", err)
		}
	}
	index, err := readRetirements(directory)
	if err != nil {
		return out, err
	}
	type candidate struct {
		name    string
		retired time.Time
	}
	items := []candidate{}
	for name, stamp := range index.Retired {
		if name == filepath.Base(current.directory) {
			continue
		}
		retired, _ := time.Parse(time.RFC3339Nano, stamp)
		items = append(items, candidate{name, retired})
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].retired.Equal(items[j].retired) {
			return items[i].name > items[j].name
		}
		return items[i].retired.After(items[j].retired)
	})
	kept := 0
	for _, item := range items {
		if err = ctx.Err(); err != nil {
			return out, err
		}
		info, e := root.Lstat(item.name)
		if e != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			out.Skipped = append(out.Skipped, item.name)
			continue
		}
		archive, e := NewArchiveProvider(filepath.Join(directory, item.name))
		if e != nil {
			out.Skipped = append(out.Skipped, item.name)
			continue
		}
		report, e := readReport(archive.directory)
		if e != nil || report.StoppedReason != "" {
			out.Skipped = append(out.Skipped, item.name)
			continue
		}
		allowed := map[string]bool{"catalog.json": true, "report.json": true}
		complete := true
		for _, entry := range report.Entries {
			if entry.Status != "success" {
				complete = false
				break
			}
			allowed[entry.Code+".json"] = true
		}
		if !complete {
			out.Skipped = append(out.Skipped, item.name)
			continue
		}
		generation, e := root.OpenRoot(item.name)
		if e != nil {
			return out, e
		}
		dir, e := generation.Open(".")
		if e != nil {
			generation.Close()
			return out, e
		}
		files, e := dir.ReadDir(-1)
		dir.Close()
		if e != nil {
			generation.Close()
			return out, e
		}
		if len(files) != len(allowed) {
			complete = false
		}
		for _, file := range files {
			if !file.Type().IsRegular() || !allowed[file.Name()] {
				complete = false
			}
		}
		// Validate every snapshot before treating the folder as collector-owned.
		if complete {
			for _, instrument := range archive.items {
				if _, e = readSnapshot(archive.directory, instrument, archive.from, archive.to); e != nil {
					complete = false
					break
				}
			}
		}
		if !complete {
			generation.Close()
			out.Skipped = append(out.Skipped, item.name)
			continue
		}
		if kept < options.Keep-1 {
			kept++
			generation.Close()
			continue
		}
		if time.Since(item.retired) < options.MinAge {
			generation.Close()
			continue
		}
		out.Eligible = append(out.Eligible, item.name)
		if !options.DryRun {
			for _, file := range files {
				if err = ctx.Err(); err != nil {
					generation.Close()
					return out, err
				}
				if err = generation.Remove(file.Name()); err != nil {
					generation.Close()
					return out, err
				}
			}
		}
		generation.Close()
		if !options.DryRun {
			if err = root.Remove(item.name); err != nil {
				return out, err
			}
			out.Removed = append(out.Removed, item.name)
			delete(index.Retired, item.name)
		}
	}
	if !options.DryRun && len(out.Removed) > 0 {
		err = writeJSON(filepath.Join(directory, "retired.json"), index)
	}
	return out, err
}
