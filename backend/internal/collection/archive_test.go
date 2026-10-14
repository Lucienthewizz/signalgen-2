package collection

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

type archiveHistory struct{ count int }

func (fake archiveHistory) DailyHistory(_ context.Context, item universe.Instrument, from, _ time.Time) (marketdata.History, error) {
	series := marketdata.Series{Symbol: item.Symbol, Timezone: "UTC"}
	for index := 0; index < fake.count; index++ {
		series.Candles = append(series.Candles, core.Candle{Timestamp: from.AddDate(0, 0, index).Format(time.RFC3339), Open: 100, High: 102, Low: 99, Close: 101, Volume: 1000})
	}
	return marketdata.History{Series: series}, nil
}

// Build fixtures with the real collector to keep archive/reader contracts aligned.
func makeArchive(t *testing.T, count int) (string, []universe.Instrument) {
	t.Helper()
	from := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	catalog := Catalog{SourceURL: "https://www.idx.co.id/", RetrievedAt: from.Format(time.RFC3339), SourceSHA256: strings.Repeat("a", 64), Items: []Instrument{{Code: "BBCA", Name: "Bank Central Asia", ProviderSymbol: "BBCA.JK", ListingDate: "2000-05-31"}, {Code: "TLKM", Name: "Telkom", ProviderSymbol: "TLKM.JK", ListingDate: "1995-11-14"}}}
	directory := t.TempDir()
	_, err := Run(context.Background(), catalog, archiveHistory{count}, Options{Directory: directory, From: from, To: from.AddDate(0, 3, 0)}, nil)
	if err != nil {
		t.Fatal(err)
	}
	return directory, []universe.Instrument{{Symbol: "BBCA.JK", ProviderSymbol: "BBCA.JK"}, {Symbol: "TLKM.JK", ProviderSymbol: "TLKM.JK"}}
}

func TestArchiveReturnsBoundedValidatedCopies(t *testing.T) {
	directory, instruments := makeArchive(t, 25)
	provider, err := NewArchiveProvider(directory)
	if err != nil {
		t.Fatal(err)
	}
	series, err := provider.Daily(context.Background(), instruments, 20)
	if err != nil || len(series) != 2 || len(series[0].Candles) != 20 || series[0].Candles[0].Timestamp != "2026-01-06T00:00:00Z" {
		t.Fatalf("series=%+v error=%v", series, err)
	}
	series[0].Candles[0].Close = 1
	again, err := provider.Daily(context.Background(), instruments, 100)
	if err != nil || len(again[0].Candles) != 25 || again[0].Candles[5].Close != 101 {
		t.Fatal("caller mutated archive or short history was fabricated")
	}
	source := provider.Source()
	if !strings.Contains(source.Warnings[0], "NOT real-time") || !strings.Contains(source.Warnings[1], "2/2") {
		t.Fatalf("missing archive provenance: %+v", source)
	}
	source.Warnings[0] = "corrupt"
	if provider.Source().Warnings[0] == "corrupt" {
		t.Fatal("caller mutated source metadata")
	}
	var group sync.WaitGroup
	for range 8 {
		group.Add(1)
		go func() {
			defer group.Done()
			if _, err := provider.Daily(context.Background(), instruments, 20); err != nil {
				t.Error(err)
			}
		}()
	}
	group.Wait()
}

func TestArchiveRejectsUnboundedOrUnboundRequests(t *testing.T) {
	directory, instruments := makeArchive(t, 25)
	provider, _ := NewArchiveProvider(directory)
	for _, test := range []struct {
		name  string
		items []universe.Instrument
		size  int
	}{
		{"empty", nil, 20},
		{"too few candles", instruments, 19},
		{"too many candles", instruments, 5001},
		{"too many symbols", append(append([]universe.Instrument{}, instruments...), instruments...), 20},
		{"duplicate", []universe.Instrument{instruments[0], instruments[0]}, 20},
		{"path traversal", []universe.Instrument{{Symbol: "../BBCA", ProviderSymbol: "BBCA.JK"}}, 20},
		{"provider mismatch", []universe.Instrument{{Symbol: "BBCA.JK", ProviderSymbol: "TLKM.JK"}}, 20},
	} {
		t.Run(test.name, func(t *testing.T) {
			if _, err := provider.Daily(context.Background(), test.items, test.size); !errors.Is(err, marketdata.ErrInvalidData) {
				t.Fatalf("error=%v", err)
			}
		})
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := provider.Daily(ctx, instruments, 20); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel error=%v", err)
	}
}

func TestArchiveDoesNotSubstituteMissingOrShortData(t *testing.T) {
	for _, status := range []string{"failed", "pending", "missing file", "short history"} {
		t.Run(status, func(t *testing.T) {
			count := 25
			if status == "short history" {
				count = 19
			}
			directory, instruments := makeArchive(t, count)
			if status == "missing file" {
				if err := os.Remove(filepath.Join(directory, "TLKM.json")); err != nil {
					t.Fatal(err)
				}
			} else if status != "short history" {
				var report Report
				_ = readJSON(filepath.Join(directory, "report.json"), &report)
				report.Entries[1].Status = status
				if err := writeJSON(filepath.Join(directory, "report.json"), report); err != nil {
					t.Fatal(err)
				}
			}
			provider, err := NewArchiveProvider(directory)
			if err != nil {
				t.Fatal(err)
			}
			if result, err := provider.Daily(context.Background(), instruments, 20); !errors.Is(err, marketdata.ErrUnavailable) || result != nil {
				t.Fatalf("partial result=%+v error=%v", result, err)
			}
		})
	}
}

func TestArchiveRejectsCorruptSnapshot(t *testing.T) {
	for _, mutation := range []string{"hash", "symbol", "window", "chronology", "report count", "null count", "unknown field", "trailing JSON", "symlink"} {
		t.Run(mutation, func(t *testing.T) {
			directory, instruments := makeArchive(t, 25)
			provider, _ := NewArchiveProvider(directory)
			path := filepath.Join(directory, "BBCA.json")
			var snapshot Snapshot
			if err := readJSON(path, &snapshot); err != nil {
				t.Fatal(err)
			}
			switch mutation {
			case "hash":
				snapshot.DataSHA256 = strings.Repeat("0", 64)
			case "symbol":
				snapshot.History.Series.Symbol = "TLKM.JK"
			case "window":
				snapshot.RequestedFrom = "2025-01-01T00:00:00Z"
			case "chronology":
				snapshot.History.Series.Candles[1].Timestamp = snapshot.History.Series.Candles[0].Timestamp
			case "report count":
				snapshot.History.Series.Candles = snapshot.History.Series.Candles[1:]
			case "null count":
				snapshot.History.SkippedNullRows = 1
			}
			// Rehash some invalid data: SHA alone must not pass semantic validation.
			if mutation != "hash" {
				data, _ := json.Marshal(snapshot.History)
				hash := sha256.Sum256(data)
				snapshot.DataSHA256 = hex.EncodeToString(hash[:])
			}
			if err := writeJSON(path, snapshot); err != nil {
				t.Fatal(err)
			}
			switch mutation {
			case "unknown field":
				_ = os.WriteFile(path, []byte(`{"unexpected":true}`), 0600)
			case "trailing JSON":
				raw, _ := os.ReadFile(path)
				_ = os.WriteFile(path, append(raw, []byte(`{}`)...), 0600)
			case "symlink":
				if err := os.Remove(path); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(filepath.Join(directory, "TLKM.json"), path); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := provider.Daily(context.Background(), instruments[:1], 20); !errors.Is(err, marketdata.ErrInvalidData) {
				t.Fatalf("corrupt %s accepted: %v", mutation, err)
			}
		})
	}
}

func TestArchiveRejectsBadMetadataAndActiveWriter(t *testing.T) {
	for _, mutation := range []string{"schema", "hash binding", "status", "window", "duplicate", "path code", "no successes", "lock"} {
		t.Run(mutation, func(t *testing.T) {
			directory, _ := makeArchive(t, 25)
			var report Report
			var catalog Catalog
			_ = readJSON(filepath.Join(directory, "report.json"), &report)
			_ = readJSON(filepath.Join(directory, "catalog.json"), &catalog)
			switch mutation {
			case "schema":
				report.Schema = "other"
			case "hash binding":
				report.CatalogSHA256 = strings.Repeat("b", 64)
			case "status":
				report.Entries[0].Status = "unknown"
			case "window":
				report.RequestedToExclusive = report.RequestedFrom
			case "duplicate":
				catalog.Items[1] = catalog.Items[0]
				report.Entries[1] = report.Entries[0]
			case "path code":
				catalog.Items[0].Code = "../x"
			case "no successes":
				for i := range report.Entries {
					report.Entries[i].Status = "failed"
				}
			case "lock":
				_ = os.WriteFile(filepath.Join(directory, ".collect.lock"), nil, 0600)
			}
			_ = writeJSON(filepath.Join(directory, "report.json"), report)
			_ = writeJSON(filepath.Join(directory, "catalog.json"), catalog)
			if _, err := NewArchiveProvider(directory); err == nil {
				t.Fatalf("bad %s archive accepted", mutation)
			}
		})
	}
}

// Opt-in local artifact check. It never contacts Yahoo or a database, and does
// not make the unit suite depend on a private absolute path or archived prices.
func TestArchiveResearchFiles(t *testing.T) {
	directory := os.Getenv("SIGNALGEN_IDX_HISTORY_TEST_DIR")
	if directory == "" {
		t.Skip("set SIGNALGEN_IDX_HISTORY_TEST_DIR to check a local research archive")
	}
	provider, err := NewArchiveProvider(directory)
	if err != nil {
		t.Fatal(err)
	}
	instruments := []universe.Instrument{{Symbol: "BBCA.JK", ProviderSymbol: "BBCA.JK"}, {Symbol: "BBRI.JK", ProviderSymbol: "BBRI.JK"}, {Symbol: "TLKM.JK", ProviderSymbol: "TLKM.JK"}}
	series, err := provider.Daily(context.Background(), instruments, 100)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range series {
		if len(item.Candles) != 100 {
			t.Fatalf("%s has %d candles", item.Symbol, len(item.Candles))
		}
		t.Logf("%s: %d candles, %s .. %s", item.Symbol, len(item.Candles), item.Candles[0].Timestamp, item.Candles[len(item.Candles)-1].Timestamp)
	}
}
