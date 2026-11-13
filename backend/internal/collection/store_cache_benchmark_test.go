package collection

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

func publicationFixture(tb testing.TB, n int) (Catalog, Options, *rangeHistory) {
	tb.Helper()
	from := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	c := Catalog{SourceURL: "https://example.test/synthetic-idx", RetrievedAt: from.Format(time.RFC3339), SourceSHA256: strings.Repeat("b", 64)}
	for i := 0; i < n; i++ {
		code := fmt.Sprintf("%c%c%c%c", 'A'+rune(i/17576%26), 'A'+rune(i/676%26), 'A'+rune(i/26%26), 'A'+rune(i%26))
		c.Items = append(c.Items, Instrument{Code: code, Name: "Synthetic " + code, ProviderSymbol: code + ".JK"})
	}
	o := Options{Directory: tb.TempDir(), From: from, To: from.AddDate(0, 0, 40)}
	p := &rangeHistory{price: 100}
	if _, err := Sync(context.Background(), c, p, o, 7, nil); err != nil {
		tb.Fatal(err)
	}
	return c, o, p
}
func TestPublicationCacheMeasurements(t *testing.T) {
	path := os.Getenv("SIGNALGEN_PUBLICATION_PERF_OUTPUT")
	if path == "" {
		t.Skip("opt-in synthetic local filesystem measurements")
	}
	c, o, p := publicationFixture(t, 500)
	store, err := NewStoreProvider(o.Directory)
	if err != nil {
		t.Fatal(err)
	}
	cache, _ := marketdata.NewCachedProvider(store, marketdata.DefaultCacheOptions())
	item := universe.Instrument{Symbol: c.Items[0].ProviderSymbol, ProviderSymbol: c.Items[0].ProviderSymbol}
	ctx := context.Background()
	if _, err := cache.Daily(ctx, []universe.Instrument{item}, 20); err != nil {
		t.Fatal(err)
	}
	rows := []map[string]any{}
	for _, mode := range []string{"store_latest", "cache_hot_latest", "cache_cold_latest", "cache_hot_history"} {
		sample := func() error {
			switch mode {
			case "store_latest":
				_, err := store.Daily(ctx, []universe.Instrument{item}, 20)
				return err
			case "cache_hot_latest":
				_, err := cache.Daily(ctx, []universe.Instrument{item}, 20)
				return err
			case "cache_cold_latest":
				fresh, _ := marketdata.NewCachedProvider(store, marketdata.DefaultCacheOptions())
				_, err := fresh.Daily(ctx, []universe.Instrument{item}, 20)
				return err
			default:
				_, err := cache.DailyHistory(ctx, item, o.From, o.To)
				return err
			}
		}
		for i := 0; i < 3; i++ {
			if err := sample(); err != nil {
				t.Fatal(err)
			}
		}
		values := []float64{}
		for i := 0; i < 15; i++ {
			start := time.Now()
			for j := 0; j < 20; j++ {
				if err := sample(); err != nil {
					t.Fatal(err)
				}
			}
			values = append(values, float64(time.Since(start).Nanoseconds())/1e6/20)
		}
		sorted := append([]float64(nil), values...)
		sort.Float64s(sorted)
		rows = append(rows, map[string]any{"mode": mode, "warmups": 3, "samples": 15, "calls_per_sample": 20, "raw_mean_call_ms": values, "median_mean_call_ms": sorted[7], "p95_mean_call_ms": sorted[14]})
	}
	before, _ := cache.Daily(ctx, []universe.Instrument{item}, 20)
	oldTo := o.To
	o.To = o.To.AddDate(0, 0, 1)
	p.price = 200
	if _, err := Sync(ctx, c, p, o, 7, nil); err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	after, err := cache.Daily(ctx, []universe.Instrument{item}, 20)
	visibility := float64(time.Since(start).Nanoseconds()) / 1e6
	if err != nil {
		t.Fatal(err)
	}
	history, err := cache.DailyHistory(ctx, item, o.From, oldTo)
	if err != nil {
		t.Fatal(err)
	}
	report := map[string]any{"synthetic_catalog_symbols": 500, "candles_per_symbol": 40, "cases": rows, "changed_publication_first_latest_ms": visibility, "latest_before": before[0].Candles[len(before[0].Candles)-1].Close, "latest_after": after[0].Candles[len(after[0].Candles)-1].Close, "warm_history_after": history.Series.Candles[len(history.Series.Candles)-1].Close, "frozen_before_still": before[0].Candles[len(before[0].Candles)-1].Close, "note": "Synthetic local tmpfs, one publication transition; no real catalog/provider/network, not production performance"}
	raw, _ := json.Marshal(report)
	if err := os.WriteFile(path, append(raw, '\n'), 0600); err != nil {
		t.Fatal(err)
	}
}
func BenchmarkPublicationStoreResolution(b *testing.B) {
	c, o, _ := publicationFixture(b, 500)
	store, err := NewStoreProvider(o.Directory)
	if err != nil {
		b.Fatal(err)
	}
	item := universe.Instrument{Symbol: c.Items[0].ProviderSymbol, ProviderSymbol: c.Items[0].ProviderSymbol}
	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		if _, err := store.Daily(context.Background(), []universe.Instrument{item}, 20); err != nil {
			b.Fatal(err)
		}
	}
}
