package collection

import (
	"context"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

type auditProvider struct {
	calls map[string]int
	fail  map[string]error
	short string
}

func (p *auditProvider) DailyHistory(ctx context.Context, item universe.Instrument, from, to time.Time) (marketdata.History, error) {
	p.calls[item.Symbol]++
	if err := p.fail[item.Symbol]; err != nil {
		return marketdata.History{}, err
	}
	n := 20
	if item.Symbol == p.short {
		n = 3
	}
	series := marketdata.Series{Symbol: item.Symbol, Timezone: "UTC"}
	for i := 0; i < n; i++ {
		series.Candles = append(series.Candles, core.Candle{Timestamp: from.AddDate(0, 0, i).Format(time.RFC3339), Open: 100, High: 102, Low: 99, Close: 101, Volume: 10})
	}
	return marketdata.History{Series: series}, nil
}

func auditFixture(n int) []universe.Instrument {
	items := make([]universe.Instrument, n)
	for i := range items {
		symbol := fmt.Sprintf("T%02d", i)
		items[i] = universe.Instrument{Symbol: symbol, ProviderSymbol: symbol, Exchange: "XNAS", Currency: "USD"}
	}
	return items
}

func TestCatalogAuditVisitsBeyondTenAndResumesWithoutDuplicates(t *testing.T) {
	items, dir := auditFixture(23), t.TempDir()
	from := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	to := from.AddDate(0, 0, 90)
	p := &auditProvider{calls: map[string]int{}, fail: map[string]error{"T02": &marketdata.HTTPError{Status: 404}}, short: "T04"}
	report, err := AuditCatalog(context.Background(), items, "US", dir, from, to, 500*time.Millisecond, false, p, nil)
	if err != nil || !report.CoverageComplete || report.AllUsable || report.Counts["valid"] != 21 || report.Counts["insufficient"] != 1 || report.Counts["failed"] != 1 || len(p.calls) != 23 {
		t.Fatalf("incorrect coverage: counts=%v error=%v", report.Counts, err)
	}
	if _, err = AuditCatalog(context.Background(), items, "US", dir, from, to, 500*time.Millisecond, false, p, nil); err != nil {
		t.Fatal(err)
	}
	for _, n := range p.calls {
		if n != 1 {
			t.Fatal("resume downloaded an already visited ticker")
		}
	}
	delete(p.fail, "T02")
	p.short = ""
	report, err = AuditCatalog(context.Background(), items, "US", dir, from, to, 500*time.Millisecond, true, p, nil)
	if err != nil || !report.AllUsable || p.calls["T02"] != 2 || p.calls["T04"] != 2 || p.calls["T00"] != 1 {
		t.Fatal("retry did not target only failures/short histories")
	}
	items[0].ProviderSymbol = "OTHER"
	if _, err = AuditCatalog(context.Background(), items, "US", dir, from, to, 500*time.Millisecond, false, p, nil); err == nil {
		t.Fatal("changed catalog reused old coverage")
	}
	var persisted AuditReport
	if err = readJSON(filepath.Join(dir, "report.json"), &persisted); err != nil || !persisted.AllUsable {
		t.Fatal("coverage not persisted")
	}
}

func TestCatalogAuditRateLimitAndCancellationKeepPendingVisible(t *testing.T) {
	items := auditFixture(4)
	from := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	to := from.AddDate(0, 0, 90)
	p := &auditProvider{calls: map[string]int{}, fail: map[string]error{"T00": &marketdata.HTTPError{Status: 429}}}
	report, err := AuditCatalog(context.Background(), items, "US", t.TempDir(), from, to, 500*time.Millisecond, false, p, nil)
	if err != nil || report.CoverageComplete || report.StoppedReason != "provider_rate_limited" || report.Counts["pending"] != 3 || len(p.calls) != 1 {
		t.Fatal("provider limit was ignored or partial report looked complete")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	report, err = AuditCatalog(ctx, items, "US", t.TempDir(), from, to, 500*time.Millisecond, false, p, nil)
	if err != nil || report.Counts["pending"] != 4 || report.StoppedReason != "budget_or_cancel" {
		t.Fatal("cancelled catalog lost unvisited coverage")
	}
}
