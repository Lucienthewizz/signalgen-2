package main

import "testing"

// The deployed CLI has no provider variable by default. Its first live smoke
// caught an empty URL being passed through; keep that startup path covered.
func TestHistorySourceDefault(t *testing.T) {
	if source, err := historySource(""); err != nil || source == nil {
		t.Fatalf("default collector cannot start: %v", err)
	}
	if _, err := historySource("ftp://provider.invalid"); err == nil {
		t.Fatal("invalid provider configuration accepted")
	}
}
