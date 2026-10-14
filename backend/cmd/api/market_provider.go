package main

import (
	"fmt"
	"strings"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/collection"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"
)

// configuredMarketProvider is the deployment boundary, not a browser option.
// A typo fails startup rather than quietly switching the research data source.
// Neither mode changes auth, per-user universes or the bounded shared cache.
func configuredMarketProvider(mode, archiveDirectory, yahooBaseURL string) (marketdata.Provider, error) {
	switch strings.TrimSpace(mode) {
	case "yahoo":
		return marketdata.NewYahooFinance(yahooBaseURL, nil)
	case "idx_archive":
		return collection.NewArchiveProvider(archiveDirectory)
	default:
		return nil, fmt.Errorf("SIGNALGEN_MARKET_DATA_MODE must be yahoo or idx_archive")
	}
}
