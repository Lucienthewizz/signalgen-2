package main

import (
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"strings"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/collection"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketarchive"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"
)

// configuredMarketProvider is the deployment boundary, not a browser option.
// A typo fails startup rather than quietly switching the research data source.
// Neither mode changes auth, per-user universes or the bounded shared cache.
func configuredMarketProvider(mode, archiveDirectory, yahooBaseURL string, databases ...*pgxpool.Pool) (marketdata.Provider, error) {
	switch strings.TrimSpace(mode) {
	case "postgres_archive":
		if len(databases) != 1 || databases[0] == nil {
			return nil, fmt.Errorf("postgres_archive requires a database")
		}
		live, err := marketdata.NewYahooFinance(yahooBaseURL, nil)
		if err != nil {
			return nil, err
		}
		return marketarchive.NewProvider(databases[0], live)
	case "yahoo":
		return marketdata.NewYahooFinance(yahooBaseURL, nil)
	case "idx_store":
		live, err := marketdata.NewYahooFinance(yahooBaseURL, nil)
		if err != nil {
			return nil, err
		}
		return collection.NewRoutedStoreProvider(archiveDirectory, live)
	case "idx_archive":
		return collection.NewArchiveProvider(archiveDirectory)
	default:
		return nil, fmt.Errorf("SIGNALGEN_MARKET_DATA_MODE must be yahoo, idx_archive, idx_store or postgres_archive")
	}
}
