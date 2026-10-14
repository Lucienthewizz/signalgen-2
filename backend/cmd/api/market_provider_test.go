package main

import "testing"

func TestConfiguredMarketProviderFailsClosed(t *testing.T) {
	if _, err := configuredMarketProvider("yahoo", "", "https://query1.finance.yahoo.com"); err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"", "typo", "idx_archive"} {
		if _, err := configuredMarketProvider(mode, "", "https://query1.finance.yahoo.com"); err == nil {
			t.Fatalf("invalid mode/directory %q accepted", mode)
		}
	}
}
