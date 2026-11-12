package backtestsapi

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/api/shared"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/dataset"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/subscription"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

type studyDatasets interface {
	PrepareStudyBatch(context.Context, string, string, dataset.PrepareRequest, []universe.Instrument) ([]dataset.Manifest, []error, error)
	ReleaseStudy(string, string)
}
type StudyInput struct {
	Source     string                 `json:"source"`
	Market     string                 `json:"market"`
	UniverseID string                 `json:"universe_id,omitempty"`
	RuleID     string                 `json:"rule_id"`
	Config     core.SignalStudyConfig `json:"config"`
}
type StudyContext struct {
	Source            string                 `json:"source"`
	UniverseID        string                 `json:"universe_id,omitempty"`
	Purpose           string                 `json:"purpose"`
	EngineVersion     string                 `json:"engine_version"`
	RuleSchemaVersion string                 `json:"rule_schema_version"`
	ID                string                 `json:"id"`
	SchemaVersion     string                 `json:"schema_version"`
	PolicyVersion     string                 `json:"policy_version"`
	Market            string                 `json:"market"`
	Currency          string                 `json:"currency"`
	Config            core.SignalStudyConfig `json:"config"`
	RuleID            string                 `json:"rule_id"`
	DefinitionHash    string                 `json:"definition_hash"`
	CatalogHash       string                 `json:"catalog_hash"`
	Total             int                    `json:"total"`
	BatchSize         int                    `json:"batch_size"`
	Batches           int                    `json:"batches"`
	ExpiresAt         time.Time              `json:"expires_at"`
	owner, session    string
	instruments       []universe.Instrument
	operands          []string
	busy              bool
	activeBatch       int
}
type StudyHandler struct {
	*shared.Context
	Purpose string
	mu      sync.Mutex
	items   map[string]*StudyContext
}

func NewStudyHandler(c *shared.Context) *StudyHandler {
	return &StudyHandler{Context: c, items: map[string]*StudyContext{}}
}
func NewScreeningHandler(c *shared.Context) *StudyHandler {
	return &StudyHandler{Context: c, Purpose: "screen", items: map[string]*StudyContext{}}
}
func (h *StudyHandler) purpose() string {
	if h.Purpose == "screen" {
		return "screen"
	}
	return "backtest"
}
func (h *StudyHandler) authorize(w http.ResponseWriter, r *http.Request) (string, string, bool) {
	p, s, _, ok := h.RequireAppSession(w, r)
	if !ok {
		return "", "", false
	}
	feature := "backtest"
	if h.purpose() == "screen" {
		feature = "screener"
	}
	if err := h.Access.RequireFeature(r.Context(), p.ID, feature); err != nil {
		shared.WriteAccessError(w, r, err)
		return "", "", false
	}
	if !h.AllowRate(w, r, "backtests:study", p.ID) {
		return "", "", false
	}
	if _, ok := h.Datasets.(studyDatasets); !ok {
		shared.WriteError(w, r, 503, "STUDY_UNAVAILABLE", "Historical studies are not configured.")
		return "", "", false
	}
	w.Header().Set("Cache-Control", "private, no-store")
	return p.ID, s.ID, true
}
func (h *StudyHandler) definition(ctx context.Context, owner, id string) (core.RuleSnapshot, string, error) {
	if id == core.BaselineRuleID {
		r := core.GetBaselineRuleDefinition()
		return core.RuleSnapshot{Name: r.Name, Logic: r.Logic, SignalType: r.SignalType, CooldownSec: r.CooldownSec, Conditions: r.Conditions}, core.BaselineRuleHash, nil
	}
	r, e := h.Rules.Get(ctx, owner, id)
	return r.Definition, r.DefinitionHash, e
}
func (h *StudyHandler) Create(w http.ResponseWriter, r *http.Request) {
	owner, sid, ok := h.authorize(w, r)
	if !ok {
		return
	}
	var in StudyInput
	if shared.DecodeJSON(r, &in) != nil || core.ValidateSignalStudyConfig(in.Config) != nil || in.Config.To > time.Now().UTC().Format("2006-01-02") || in.RuleID == "" || (in.Market != "IDX" && in.Market != "US") || (in.Source != "market" && in.Source != "universe") || (in.Source == "market" && in.UniverseID != "") || (in.Source == "universe" && in.UniverseID == "") {
		shared.WriteError(w, r, 422, "INVALID_REQUEST", "Choose a rule, one market or an owned universe, and a historical range of at most one year.")
		return
	}
	if h.purpose() == "screen" && (in.Config.NSteps != 1 || in.Config.TakeProfitPct != nil || in.Config.StopLossPct != nil) {
		shared.WriteError(w, r, 422, "INVALID_REQUEST", "Screening returns signals only; choose evaluation settings in backtest.")
		return
	}
	if h.purpose() == "screen" {
		if err := subscription.CheckScreening(r.Context(), h.Access, owner, in.RuleID, "1d", 1); err != nil {
			shared.WriteAccessError(w, r, err)
			return
		}
	}
	definition, hash, err := h.definition(r.Context(), owner, in.RuleID)
	if err != nil {
		shared.WriteRuleError(w, r, err)
		return
	}
	var instruments []universe.Instrument
	if in.Source == "universe" {
		instruments, err = h.Universes.Instruments(r.Context(), owner, in.UniverseID)
	} else {
		var catalog []universe.Instrument
		catalog, err = h.Universes.Catalog(r.Context())
		for _, s := range catalog {
			m, _, e := universe.InstrumentMarket([]universe.Instrument{s})
			if e == nil && m == in.Market {
				instruments = append(instruments, s)
			}
		}
	}
	if err != nil {
		if errors.Is(err, universe.ErrNotFound) {
			shared.WriteError(w, r, 404, "RESOURCE_NOT_FOUND", "Stock universe not found for this account.")
			return
		}
		shared.WriteError(w, r, 503, "CATALOG_UNAVAILABLE", "The selected stock source is unavailable.")
		return
	}
	if len(instruments) < 1 || len(instruments) > 20000 {
		shared.WriteError(w, r, 422, "INVALID_REQUEST", "No supported stocks are available for this source.")
		return
	}
	sort.Slice(instruments, func(i, j int) bool { return instruments[i].Symbol < instruments[j].Symbol })
	market, currency, _ := universe.InstrumentMarket(instruments[:1])
	for i, s := range instruments {
		m, c, e := universe.InstrumentMarket([]universe.Instrument{s})
		if e != nil || m != market || c != currency || (i > 0 && s.Symbol == instruments[i-1].Symbol) {
			shared.WriteError(w, r, 422, "INVALID_REQUEST", "A study must contain unique stocks in one market and currency.")
			return
		}
	}
	var idBytes [16]byte
	if _, err = rand.Read(idBytes[:]); err != nil {
		shared.WriteError(w, r, 503, "STUDY_UNAVAILABLE", "Unable to initialize study.")
		return
	}
	raw, _ := json.Marshal(instruments)
	digest := sha256.Sum256(raw)
	item := &StudyContext{Source: in.Source, UniverseID: in.UniverseID, Purpose: h.purpose(), ID: hex.EncodeToString(idBytes[:]), SchemaVersion: core.SignalStudySchema, PolicyVersion: core.SignalStudyPolicy, Market: market, Currency: currency, Config: in.Config, RuleID: in.RuleID, DefinitionHash: hash, CatalogHash: "sha256:" + hex.EncodeToString(digest[:]), Total: len(instruments), BatchSize: 10, Batches: (len(instruments) + 9) / 10, ExpiresAt: time.Now().Add(2 * time.Hour), owner: owner, session: sid, instruments: instruments, operands: core.RequiredOperands(definition), activeBatch: -1}
	item.EngineVersion = core.EngineVersion
	item.RuleSchemaVersion = core.SchemaVersion
	h.mu.Lock()
	for id, e := range h.items {
		if time.Now().After(e.ExpiresAt) {
			h.Datasets.(studyDatasets).ReleaseStudy(e.owner, id)
			delete(h.items, id)
		}
	}
	full := len(h.items) >= 32
	for _, e := range h.items {
		if e.owner == owner && e.session == sid {
			full = true
		}
	}
	if !full {
		h.items[item.ID] = item
	}
	h.mu.Unlock()
	if full {
		w.Header().Set("Retry-After", "60")
		shared.WriteError(w, r, 429, "STUDY_CAPACITY", "Cancel the previous study in this session before starting another; server study capacity is bounded.")
		return
	}
	shared.WriteJSON(w, 201, item)
}

type StudyBatch struct {
	Index     int                `json:"index"`
	Stocks    []string           `json:"stocks"`
	Manifests []dataset.Manifest `json:"manifests"`
	Failures  []StudyFailure     `json:"failures"`
}
type StudyFailure struct {
	Symbol    string `json:"symbol"`
	Code      string `json:"code"`
	Retryable bool   `json:"retryable"`
}

func (h *StudyHandler) Batch(w http.ResponseWriter, r *http.Request) {
	owner, sid, ok := h.authorize(w, r)
	if !ok {
		return
	}
	var input struct {
		RetrySymbols []string `json:"retry_symbols,omitempty"`
	}
	if r.Method == http.MethodPost {
		if shared.DecodeJSON(r, &input) != nil || len(input.RetrySymbols) > 10 {
			shared.WriteError(w, r, 422, "INVALID_REQUEST", "Batch stocks and settings come from the frozen study context.")
			return
		}
	}
	id := r.PathValue("id")
	index, e := strconv.Atoi(r.PathValue("batch"))
	h.mu.Lock()
	item := h.items[id]
	if e != nil || item == nil || item.owner != owner || item.session != sid || time.Now().After(item.ExpiresAt) || index < 0 || index >= item.Batches {
		h.mu.Unlock()
		shared.WriteError(w, r, 404, "RESOURCE_NOT_FOUND", "Study batch unavailable for this session.")
		return
	}
	if item.busy || (item.activeBatch != -1 && item.activeBatch != index) {
		h.mu.Unlock()
		shared.WriteError(w, r, 409, "STUDY_BUSY", "Finish or release the active batch before preparing another.")
		return
	}
	if r.Method == http.MethodDelete {
		h.Datasets.(studyDatasets).ReleaseStudy(owner, id)
		item.activeBatch = -1
		h.mu.Unlock()
		w.WriteHeader(204)
		return
	}
	batch := item.instruments[index*10 : min((index+1)*10, item.Total)]
	if len(input.RetrySymbols) > 0 {
		requested := map[string]bool{}
		for _, symbol := range input.RetrySymbols {
			requested[symbol] = true
		}
		subset := make([]universe.Instrument, 0, len(requested))
		for _, instrument := range batch {
			if requested[instrument.Symbol] {
				subset = append(subset, instrument)
			}
		}
		if len(requested) != len(input.RetrySymbols) || len(subset) != len(requested) {
			h.mu.Unlock()
			shared.WriteError(w, r, 422, "INVALID_REQUEST", "Retry symbols must be unique members of this frozen batch.")
			return
		}
		batch = subset
	}
	item.busy = true
	item.activeBatch = index
	copyItem := *item
	h.mu.Unlock()
	defer func() { h.mu.Lock(); item.busy = false; h.mu.Unlock() }()
	if h.purpose() == "screen" {
		if err := subscription.CheckScreening(r.Context(), h.Access, owner, copyItem.RuleID, "1d", 1); err != nil {
			shared.WriteAccessError(w, r, err)
			return
		}
	}
	_, hash, err := h.definition(r.Context(), owner, copyItem.RuleID)
	if err != nil || hash != copyItem.DefinitionHash {
		shared.WriteError(w, r, 409, "VERSION_MISMATCH", "The rule changed. Cancel and start a new study.")
		return
	}
	out := StudyBatch{Index: index, Stocks: []string{}, Manifests: []dataset.Manifest{}, Failures: []StudyFailure{}}
	// A bounded group, not one goroutine per catalog member. Leave response time
	// below the shared HTTP deadline, returning explicit failures for retry.
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	request := dataset.PrepareRequest{Purpose: h.purpose(), Mode: "rule", RuleID: copyItem.RuleID, From: copyItem.Config.From, To: copyItem.Config.To, NSteps: copyItem.Config.NSteps, Timeframe: "1d", RequiredOperands: copyItem.operands, StudyRuleHash: copyItem.DefinitionHash}
	manifests, failures, prepareErr := h.Datasets.(studyDatasets).PrepareStudyBatch(ctx, owner, id, request, batch)
	if prepareErr != nil {
		_, currentHash, definitionErr := h.definition(r.Context(), owner, copyItem.RuleID)
		h.mu.Lock()
		current := h.items[id] == item && time.Now().Before(item.ExpiresAt)
		h.mu.Unlock()
		if !current || definitionErr != nil || currentHash != copyItem.DefinitionHash {
			h.Datasets.(studyDatasets).ReleaseStudy(owner, id)
			shared.WriteError(w, r, 409, "VERSION_MISMATCH", "Study expired, was canceled, or its rule changed.")
			return
		}
		if errors.Is(prepareErr, dataset.ErrCapacity) {
			w.Header().Set("Retry-After", "1")
			shared.WriteError(w, r, 429, "SNAPSHOT_CAPACITY", "Snapshot capacity is full. Retry this batch after releasing active snapshots.")
		} else {
			shared.WriteError(w, r, 503, "STUDY_UNAVAILABLE", "Batch preparation stopped. Retry this batch.")
		}
		return
	}
	for i, s := range batch {
		out.Stocks = append(out.Stocks, s.Symbol)
		if failures[i] != nil {
			code := "PROVIDER_UNAVAILABLE"
			retryable := true
			if errors.Is(failures[i], marketdata.ErrInsufficientCandles) {
				code = "INSUFFICIENT_CANDLES"
				retryable = false
			}
			out.Failures = append(out.Failures, StudyFailure{Symbol: s.Symbol, Code: code, Retryable: retryable})
		} else {
			out.Manifests = append(out.Manifests, manifests[i])
		}
	}
	_, hash, err = h.definition(r.Context(), owner, copyItem.RuleID)
	h.mu.Lock()
	current := h.items[id] == item && time.Now().Before(item.ExpiresAt)
	h.mu.Unlock()
	if !current || err != nil || hash != copyItem.DefinitionHash {
		h.Datasets.(studyDatasets).ReleaseStudy(owner, id)
		shared.WriteError(w, r, 409, "VERSION_MISMATCH", "Study expired, was canceled, or its rule changed.")
		return
	}
	shared.WriteJSON(w, 200, out)
}
func (h *StudyHandler) Cancel(w http.ResponseWriter, r *http.Request) {
	owner, sid, ok := h.authorize(w, r)
	if !ok {
		return
	}
	id := r.PathValue("id")
	h.mu.Lock()
	item := h.items[id]
	if item == nil || item.owner != owner || item.session != sid {
		h.mu.Unlock()
		shared.WriteError(w, r, 404, "RESOURCE_NOT_FOUND", "Study not found.")
		return
	}
	delete(h.items, id)
	h.mu.Unlock()
	h.Datasets.(studyDatasets).ReleaseStudy(owner, id)
	w.WriteHeader(204)
}
