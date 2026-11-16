package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

// fetch downloads daily history serially and resumably; existing files are kept.
func fetch(symbolsPath, outDir string, delay time.Duration) error {
	raw, err := os.ReadFile(symbolsPath)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(outDir, 0o700); err != nil {
		return err
	}
	provider, err := marketdata.NewYahooFinance("https://query1.finance.yahoo.com", nil)
	if err != nil {
		return err
	}
	ok, failed, skipped := 0, 0, 0
	for _, line := range strings.Split(string(raw), "\n") {
		symbol := strings.TrimSpace(line)
		if symbol == "" {
			continue
		}
		path := filepath.Join(outDir, symbol+".json")
		if _, err := os.Stat(path); err == nil {
			skipped++
			continue
		}
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		series, err := provider.Daily(ctx, []universe.Instrument{{Symbol: symbol, ProviderSymbol: symbol, Exchange: "XIDX", Currency: "IDR"}}, 1300)
		cancel()
		if err != nil {
			failed++
			fmt.Printf("%s failed: %v\n", symbol, err)
		} else {
			body, _ := json.Marshal(series[0])
			if err := os.WriteFile(path, body, 0o600); err != nil {
				return err
			}
			ok++
			fmt.Printf("%s ok candles=%d\n", symbol, len(series[0].Candles))
		}
		time.Sleep(delay)
	}
	fmt.Printf("done ok=%d failed=%d skipped=%d\n", ok, failed, skipped)
	return nil
}
