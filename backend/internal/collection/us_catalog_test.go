package collection

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

const testNasdaqHeader = "Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares\n"
const testNYSEHeader = "ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol\n"
const testDirectoryFooter = "File Creation Time: 1016202621:31|||||||\n"

func TestUSCatalogParsesWholeDirectoryWithoutTwentyStockCap(t *testing.T) {
	nasdaq := testNasdaqHeader + "AAPL|Apple - Common Stock|Q|N|N|100|N|N\n" +
		"GOOG|Alphabet - Class C Capital Stock|Q|N|N|100|N|N\n" +
		"LOGI|Logitech - Registered Shares|Q|N|N|100|N|N\n" +
		"API|Agora - ADS|Q|N|N|100|N|N\n" +
		"FUND|Fixture - Common Stock|Q|N|N|100|Y|N\n" +
		"TEST|Test - Common Stock|Q|Y|N|100|N|N\n" +
		"ABCW|Fixture - Warrant|Q|N|N|100|N|N\n" +
		"ABCU|Fixture - Units|Q|N|N|100|N|N\n" +
		"ABCR|Fixture - Rights|Q|N|N|100|N|N\n" +
		"ABCP|Fixture - Preferred Stock|Q|N|N|100|N|N\n" +
		"ABCN|Fixture - Senior Notes|Q|N|N|100|N|N\n"
	// Synthetic metadata, not real issuers or coverage evidence.
	for i := 0; i < 1000; i++ {
		nasdaq += fmt.Sprintf("FIX%d|Fixture %d - Common Stock|Q|N|N|100|N|N\n", i, i)
	}
	nasdaq += testDirectoryFooter
	nyse := testNYSEHeader + "BRK.B|Berkshire Common Stock|N|BRK.B|N|100|N|BRK/B\n" +
		"AAP|Advance Auto Parts Inc.|N|AAP|N|100|N|AAP\n" +
		"PREF$A|Preferred instrument|N|PREF$A|N|100|N|PREF-A\n" +
		"ETF|ETF|N|ETF|Y|100|N|ETF\n" +
		"OUT|Different exchange|A|OUT|N|100|N|OUT\n" + testDirectoryFooter
	result, err := ParseUSCatalog([]byte(nasdaq), []byte(nyse), time.Date(2026, 10, 19, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Items) != 1006 || result.ByExchange["XNAS"] != 1004 || result.ByExchange["XNYS"] != 2 {
		t.Fatalf("wrong counts: %d %v", len(result.Items), result.ByExchange)
	}
	found := false
	for _, item := range result.Items {
		if item.Symbol == "BRK-B" {
			found = item.ProviderSymbol == "BRK-B"
		}
		if item.Currency != "USD" || strings.HasSuffix(item.Symbol, ".JK") {
			t.Fatal("incorrect market mapping")
		}
	}
	if !found || len(result.Sources[0].SHA256) != 64 || result.Sources[0].CreationTime != "1016202621:31" {
		t.Fatal("missing mapping/provenance")
	}
	for _, source := range result.Sources {
		accounted := source.Accepted
		for _, count := range source.Skipped {
			accounted += count
		}
		if accounted != source.Rows {
			t.Fatal("unreported skipped rows")
		}
	}
}

func TestUSCatalogRejectsIncompleteMalformedDuplicateAndOversizedInput(t *testing.T) {
	validNasdaq := testNasdaqHeader + "AAPL|Apple - Common Stock|Q|N|N|100|N|N\n" + testDirectoryFooter
	validNYSE := testNYSEHeader + "BRK.B|Berkshire Common Stock|N|BRK.B|N|100|N|BRK/B\n" + testDirectoryFooter
	for _, bad := range []string{
		"<html>not a directory</html>",
		strings.ReplaceAll(validNasdaq, testDirectoryFooter, ""),
		strings.ReplaceAll(validNasdaq, "1016202621:31", "bad-time"),
		strings.ReplaceAll(validNasdaq, "|100|N|N", "|100|UNKNOWN|N"),
		strings.ReplaceAll(validNasdaq, "Security Name", "missing"),
		strings.ReplaceAll(validNasdaq, "AAPL|Apple", "BRK-B|Apple"),
		validNasdaq + "AFTER|Data|Q|N|N|100|N|N\n",
		strings.Repeat("x", maxUSDirectoryBytes+1),
	} {
		if _, err := ParseUSCatalog([]byte(bad), []byte(validNYSE), time.Now()); err == nil {
			t.Fatal("bad directory accepted")
		}
	}
	duplicate := strings.Replace(validNYSE, "BRK.B|Berkshire", "AAPL|Berkshire", 1)
	if _, err := ParseUSCatalog([]byte(validNasdaq), []byte(duplicate), time.Now()); err == nil {
		t.Fatal("cross-exchange duplicate accepted")
	}
}
