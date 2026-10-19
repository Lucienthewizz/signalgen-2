package collection

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

const (
	NasdaqDirectoryURL  = "https://www.nasdaqtrader.com/dynamic/symdir/nasdaqlisted.txt"
	NYSEDirectoryURL    = "https://www.nasdaqtrader.com/dynamic/symdir/otherlisted.txt"
	maxUSDirectoryBytes = 8 << 20
)

// USCatalog is metadata only: importing thousands of symbols never fetches prices.
// The source directory includes non-equity products, so every excluded row has a
// reason rather than quietly claiming all instruments or all US trading venues.
type USCatalog struct {
	RetrievedAt time.Time             `json:"retrieved_at"`
	Sources     []USCatalogSource     `json:"sources"`
	ByExchange  map[string]int        `json:"by_exchange"`
	Items       []universe.Instrument `json:"items"`
}

type USCatalogSource struct {
	URL          string         `json:"url"`
	SHA256       string         `json:"sha256"`
	CreationTime string         `json:"creation_time"`
	Rows         int            `json:"rows"`
	Accepted     int            `json:"accepted"`
	Skipped      map[string]int `json:"skipped"`
}

var usDirectorySymbol = regexp.MustCompile(`^[A-Z][A-Z0-9]{0,9}([.][A-Z])?$`)

// Nasdaq describes the security after " - "; NYSE includes it in the name.
// This is a conservative name/symbology filter, not an official security-type
// classification feed. Ordinary/common shares, ADRs and REIT shares are allowed;
// ETFs, preferred shares, debt, warrants, rights and bundled units are not.
var nonEquityDescription = regexp.MustCompile(`(?i)\b(preferred|preference|pfd|warrants?|rights?|units?|notes?|debentures?|bonds?|etns?|debt|strats|zones|corts|adw)\b|[0-9][.0-9]*%`)

// LoadUSCatalog accepts local official exports or downloads only the two fixed
// HTTPS sources. Callers cannot turn this operator tool into an arbitrary fetch.
func LoadUSCatalog(ctx context.Context, nasdaqPath, nysePath string, now time.Time) (USCatalog, error) {
	nasdaq, err := readUSDirectory(ctx, nasdaqPath, NasdaqDirectoryURL)
	if err != nil {
		return USCatalog{}, fmt.Errorf("Nasdaq directory unavailable: %w", err)
	}
	nyse, err := readUSDirectory(ctx, nysePath, NYSEDirectoryURL)
	if err != nil {
		return USCatalog{}, fmt.Errorf("NYSE directory unavailable: %w", err)
	}
	return ParseUSCatalog(nasdaq, nyse, now)
}

func readUSDirectory(ctx context.Context, path, url string) ([]byte, error) {
	var reader io.ReadCloser
	if path != "" {
		file, err := os.Open(path)
		if err != nil {
			return nil, err
		}
		reader = file
	} else {
		client := &http.Client{Timeout: 20 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return nil, err
		}
		response, err := client.Do(request)
		if err != nil {
			return nil, err
		}
		if response.StatusCode != http.StatusOK {
			response.Body.Close()
			return nil, fmt.Errorf("HTTP status %d", response.StatusCode)
		}
		reader = response.Body
	}
	defer reader.Close()
	data, err := io.ReadAll(io.LimitReader(reader, maxUSDirectoryBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > maxUSDirectoryBytes {
		return nil, fmt.Errorf("directory exceeds size limit")
	}
	return data, nil
}

func ParseUSCatalog(nasdaq, nyse []byte, now time.Time) (USCatalog, error) {
	result := USCatalog{RetrievedAt: now.UTC(), ByExchange: map[string]int{}}
	seen := make(map[string]bool)
	for index, raw := range [][]byte{nasdaq, nyse} {
		items, source, err := parseUSDirectory(raw, index == 0)
		if err != nil {
			return USCatalog{}, err
		}
		result.Sources = append(result.Sources, source)
		for _, item := range items {
			if seen[item.Symbol] {
				return USCatalog{}, fmt.Errorf("duplicate normalized US symbol %s", item.Symbol)
			}
			seen[item.Symbol] = true
			result.Items = append(result.Items, item)
			result.ByExchange[item.Exchange]++
		}
	}
	if err := universe.ValidateUSCatalogImport(result.Items); err != nil {
		return USCatalog{}, err
	}
	sort.Slice(result.Items, func(i, j int) bool { return result.Items[i].Symbol < result.Items[j].Symbol })
	return result, nil
}

func parseUSDirectory(raw []byte, nasdaq bool) ([]universe.Instrument, USCatalogSource, error) {
	source := USCatalogSource{URL: NYSEDirectoryURL, Skipped: map[string]int{}}
	if nasdaq {
		source.URL = NasdaqDirectoryURL
	}
	if len(raw) == 0 || len(raw) > maxUSDirectoryBytes || !utf8.Valid(raw) {
		return nil, source, fmt.Errorf("invalid US directory encoding/size")
	}
	digest := sha256.Sum256(raw)
	source.SHA256 = hex.EncodeToString(digest[:])
	reader := csv.NewReader(bytes.NewReader(bytes.TrimPrefix(raw, []byte("\xef\xbb\xbf"))))
	reader.Comma, reader.FieldsPerRecord = '|', -1
	header, err := reader.Read()
	if err != nil {
		return nil, source, fmt.Errorf("missing directory header")
	}
	columns := make(map[string]int)
	for i, name := range header {
		name = strings.TrimSpace(name)
		if _, exists := columns[name]; exists {
			return nil, source, fmt.Errorf("duplicate directory column")
		}
		columns[name] = i
	}
	symbolColumn := "ACT Symbol"
	if nasdaq {
		symbolColumn = "Symbol"
	}
	required := []string{symbolColumn, "Security Name", "ETF", "Test Issue"}
	if !nasdaq {
		required = append(required, "Exchange")
	}
	for _, key := range required {
		if _, ok := columns[key]; !ok {
			return nil, source, fmt.Errorf("missing directory column %s", key)
		}
	}
	var items []universe.Instrument
	footer := false
	for {
		row, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil || len(row) == 0 {
			return nil, source, fmt.Errorf("malformed US directory row")
		}
		if footer {
			return nil, source, fmt.Errorf("directory data follows footer")
		}
		if strings.HasPrefix(row[0], "File Creation Time: ") {
			source.CreationTime = strings.TrimSpace(strings.TrimPrefix(row[0], "File Creation Time: "))
			if _, err := time.Parse("0102200615:04", source.CreationTime); err != nil {
				return nil, source, fmt.Errorf("invalid directory creation time")
			}
			footer = true
			continue
		}
		if len(row) != len(header) {
			return nil, source, fmt.Errorf("wrong directory field count")
		}
		source.Rows++
		if source.Rows > 30000 {
			return nil, source, fmt.Errorf("directory row limit exceeded")
		}
		field := func(key string) string { return strings.TrimSpace(row[columns[key]]) }
		if field("Test Issue") != "N" && field("Test Issue") != "Y" || field("ETF") != "N" && field("ETF") != "Y" {
			return nil, source, fmt.Errorf("unknown directory flag")
		}
		reason := ""
		exchange := "XNAS"
		if field("Test Issue") == "Y" {
			reason = "test_issue"
		} else if !nasdaq && field("Exchange") != "N" {
			reason = "outside_nasdaq_nyse"
		} else if field("ETF") == "Y" {
			reason = "etf"
		}
		if !nasdaq {
			exchange = "XNYS"
		}
		name, symbol := field("Security Name"), field(symbolColumn)
		if name == "" || len([]rune(name)) > 300 {
			return nil, source, fmt.Errorf("invalid directory security name")
		}
		description := name
		if nasdaq {
			if _, after, found := strings.Cut(name, " - "); found {
				description = after
			}
		}
		if reason == "" && nonEquityDescription.MatchString(description) {
			reason = "non_equity_description"
		}
		if reason == "" && !usDirectorySymbol.MatchString(symbol) {
			reason = "unsupported_symbol"
		}
		if reason != "" {
			source.Skipped[reason]++
			continue
		}
		symbol = strings.ReplaceAll(symbol, ".", "-")
		items = append(items, universe.Instrument{Symbol: symbol, ProviderSymbol: symbol, Name: name, Exchange: exchange, Currency: "USD"})
		source.Accepted++
	}
	if !footer || source.Rows == 0 || source.Accepted == 0 {
		return nil, source, fmt.Errorf("empty/incomplete US directory")
	}
	return items, source, nil
}
