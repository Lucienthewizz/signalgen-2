package dataset

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
)

const fixtureDatasetID = "fixture-default-scalping-v1"

var (
	ErrInvalidRequest = errors.New("invalid dataset request")
	ErrNotFound       = errors.New("dataset not found")
	ErrIntegrity      = errors.New("dataset fixture integrity check failed")
)

type PrepareRequest struct {
	Purpose   string   `json:"purpose"`
	Market    string   `json:"market"`
	Symbols   []string `json:"symbols"`
	Timeframe string   `json:"timeframe"`
	DateFrom  string   `json:"date_from"`
	DateTo    string   `json:"date_to"`
	RuleID    string   `json:"rule_id,omitempty"`
}

type Range struct {
	From string `json:"from"`
	To   string `json:"to"`
}

type Quality struct {
	Status   string   `json:"status"`
	Warnings []string `json:"warnings"`
}

type Manifest struct {
	DatasetID      string   `json:"dataset_id"`
	Version        string   `json:"version"`
	SchemaVersion  string   `json:"schema_version"`
	Provider       string   `json:"provider"`
	Purpose        string   `json:"purpose"`
	Market         string   `json:"market"`
	Currency       string   `json:"currency"`
	Symbols        []string `json:"symbols"`
	Timeframe      string   `json:"timeframe"`
	Timezone       string   `json:"timezone"`
	RequestedRange Range    `json:"requested_range"`
	AvailableRange Range    `json:"available_range"`
	WarmupCandles  int      `json:"warmup_candles"`
	Adjustment     string   `json:"adjustment"`
	CandleCount    int      `json:"candle_count"`
	DecodedBytes   int      `json:"decoded_bytes"`
	Checksum       string   `json:"checksum"`
	Quality        Quality  `json:"quality"`
}

type FixtureStore struct {
	manifest Manifest
	content  []byte
}

func NewFixtureStore(path string) (*FixtureStore, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read dataset fixture: %w", err)
	}
	var fixture struct {
		FixtureVersion string `json:"fixture_version"`
		Market         string `json:"market"`
		Currency       string `json:"currency"`
		Timeframe      string `json:"timeframe"`
		Timezone       string `json:"timezone"`
		Adjustment     string `json:"adjustment"`
		CandlesSHA256  string `json:"candles_sha256"`
		Request        struct {
			Purpose string            `json:"purpose"`
			Symbol  string            `json:"symbol"`
			Candles []json.RawMessage `json:"candles"`
		} `json:"request"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		return nil, fmt.Errorf("decode dataset fixture: %w", err)
	}
	if len(fixture.Request.Candles) == 0 || fixture.Request.Symbol == "" {
		return nil, fmt.Errorf("%w: fixture has no candles or symbol", ErrIntegrity)
	}

	canonicalCandles := make([]map[string]interface{}, len(fixture.Request.Candles))
	typedCandles := make([]core.Candle, len(fixture.Request.Candles))
	var firstTime, previousTime time.Time
	for index, candle := range fixture.Request.Candles {
		if err := json.Unmarshal(candle, &canonicalCandles[index]); err != nil {
			return nil, fmt.Errorf("%w: decode canonical candle %d", ErrIntegrity, index)
		}
		if err := json.Unmarshal(candle, &typedCandles[index]); err != nil {
			return nil, fmt.Errorf("%w: decode candle %d", ErrIntegrity, index)
		}
		parsedTime, err := time.Parse(time.RFC3339, typedCandles[index].Timestamp)
		if err != nil || (index > 0 && !parsedTime.After(previousTime)) {
			return nil, fmt.Errorf("%w: invalid candle chronology at %d", ErrIntegrity, index)
		}
		if index == 0 {
			firstTime = parsedTime
		}
		previousTime = parsedTime
	}
	canonical, _ := json.Marshal(canonicalCandles)
	candleHash := sha256.Sum256(canonical)
	if hex.EncodeToString(candleHash[:]) != fixture.CandlesSHA256 {
		return nil, fmt.Errorf("%w: candle checksum mismatch", ErrIntegrity)
	}

	content, err := json.Marshal(map[string]interface{}{
		"schema_version": "ohlcv-1",
		"purpose":        fixture.Request.Purpose,
		"market":         fixture.Market,
		"currency":       fixture.Currency,
		"symbol":         fixture.Request.Symbol,
		"timeframe":      fixture.Timeframe,
		"timezone":       fixture.Timezone,
		"adjustment":     fixture.Adjustment,
		"candles":        typedCandles,
	})
	if err != nil {
		return nil, fmt.Errorf("encode dataset content: %w", err)
	}
	contentHash := sha256.Sum256(content)
	first := firstTime.Format("2006-01-02")
	last := previousTime.Format("2006-01-02")
	return &FixtureStore{
		manifest: Manifest{
			DatasetID: fixtureDatasetID, Version: fixture.FixtureVersion,
			SchemaVersion: "ohlcv-1", Provider: "fixture", Purpose: fixture.Request.Purpose,
			Market: fixture.Market, Currency: fixture.Currency, Symbols: []string{fixture.Request.Symbol},
			Timeframe: fixture.Timeframe, Timezone: fixture.Timezone, Adjustment: fixture.Adjustment,
			AvailableRange: Range{From: first, To: last}, WarmupCandles: 20,
			CandleCount: len(typedCandles), DecodedBytes: len(content),
			Checksum: "sha256:" + hex.EncodeToString(contentHash[:]),
			Quality:  Quality{Status: "complete", Warnings: []string{"synthetic fixture; not live market data"}},
		},
		content: content,
	}, nil
}

func (store *FixtureStore) Prepare(request PrepareRequest) (Manifest, error) {
	if request.Purpose != store.manifest.Purpose || request.Market != store.manifest.Market ||
		request.Timeframe != store.manifest.Timeframe || len(request.Symbols) != 1 ||
		request.Symbols[0] != store.manifest.Symbols[0] {
		return Manifest{}, ErrInvalidRequest
	}
	from, err := parseDate(request.DateFrom)
	if err != nil {
		return Manifest{}, ErrInvalidRequest
	}
	to, err := parseDate(request.DateTo)
	if err != nil || to.Before(from) {
		return Manifest{}, ErrInvalidRequest
	}
	availableFrom, _ := parseDate(store.manifest.AvailableRange.From)
	availableTo, _ := parseDate(store.manifest.AvailableRange.To)
	if from.Before(availableFrom) || to.After(availableTo) {
		return Manifest{}, ErrInvalidRequest
	}
	manifest := store.manifest
	manifest.RequestedRange = Range{From: request.DateFrom, To: request.DateTo}
	return manifest, nil
}

func (store *FixtureStore) Manifest(id string) (Manifest, error) {
	if strings.TrimSpace(id) != store.manifest.DatasetID {
		return Manifest{}, ErrNotFound
	}
	return store.manifest, nil
}

func (store *FixtureStore) Content(id string) ([]byte, Manifest, error) {
	manifest, err := store.Manifest(id)
	if err != nil {
		return nil, Manifest{}, err
	}
	return append([]byte(nil), store.content...), manifest, nil
}

func parseDate(value string) (time.Time, error) {
	return time.Parse("2006-01-02", value)
}
