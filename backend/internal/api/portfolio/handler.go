package portfolioapi

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/api/shared"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/portfolio"
)

type Handler struct {
	*shared.Context
	Store portfolio.Store
}

func (handler *Handler) Serve(w http.ResponseWriter, r *http.Request) {
	principal, _, _, ok := handler.RequireAppSession(w, r)
	if !ok {
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	if !handler.AllowRate(w, r, "portfolio:"+strings.ToLower(r.Method), principal.ID) {
		return
	}
	if handler.Store == nil {
		failure(w, r, errors.New("unavailable"))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	r = r.WithContext(ctx)
	id := r.PathValue("id")
	if id != "" {
		parsed, err := uuid.Parse(id)
		if err != nil || parsed == uuid.Nil || parsed.String() != id {
			failure(w, r, portfolio.ErrInvalid)
			return
		}
	}
	market, book := r.URL.Query().Get("market"), r.URL.Query().Get("book")
	for key, values := range r.URL.Query() {
		if (key != "market" && key != "book") || len(values) != 1 || r.Method != "GET" || id != "" {
			failure(w, r, portfolio.ErrInvalid)
			return
		}
	}
	if !portfolio.ValidMarketFilter(market) || len(book) > 80 {
		failure(w, r, portfolio.ErrInvalid)
		return
	}
	if r.Method == http.MethodGet {
		if id != "" {
			item, err := handler.Store.Get(ctx, principal.ID, id)
			if err != nil {
				failure(w, r, err)
				return
			}
			shared.WriteJSON(w, 200, item)
			return
		}
		items, err := handler.Store.List(ctx, principal.ID)
		if err != nil {
			failure(w, r, err)
			return
		}
		filtered := make([]portfolio.Transaction, 0, len(items))
		for _, item := range items {
			if portfolio.Matches(item.Data, market, book) {
				filtered = append(filtered, item)
			}
		}
		if strings.HasSuffix(r.URL.Path, "/transactions") {
			shared.WriteJSON(w, 200, map[string]any{"schema_version": portfolio.SchemaVersion, "items": filtered})
			return
		}
		summary, err := portfolio.Recalculate(filtered)
		if err != nil {
			failure(w, r, err)
			return
		}
		shared.WriteJSON(w, 200, summary)
		return
	}
	if r.Method == http.MethodPut {
		var input struct {
			Version *int64          `json:"version"`
			Data    *portfolio.Data `json:"data"`
		}
		if err := shared.DecodeJSON(r, &input); err != nil {
			shared.WriteJSONInputError(w, r, err, "Portfolio transaction body is invalid.")
			return
		}
		if input.Version == nil || *input.Version < 0 || input.Data == nil {
			failure(w, r, portfolio.ErrInvalid)
			return
		}
		data, err := portfolio.Normalize(*input.Data)
		if err != nil {
			failure(w, r, err)
			return
		}
		item, err := handler.Store.Put(ctx, principal.ID, id, *input.Version, data)
		if err != nil {
			failure(w, r, err)
			return
		}
		shared.WriteJSON(w, 200, item)
		return
	}
	var input struct {
		Version *int64 `json:"version"`
	}
	if err := shared.DecodeJSON(r, &input); err != nil {
		shared.WriteJSONInputError(w, r, err, "Portfolio transaction version is required.")
		return
	}
	if input.Version == nil || *input.Version < 1 {
		failure(w, r, portfolio.ErrInvalid)
		return
	}
	if err := handler.Store.Delete(ctx, principal.ID, id, *input.Version); err != nil {
		failure(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func failure(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		shared.WriteError(w, r, 504, "REQUEST_TIMEOUT", "Portfolio request timed out. Reload to confirm whether a save completed before retrying with the same ID.")
	case errors.Is(err, portfolio.ErrInvalid):
		shared.WriteError(w, r, 422, "INVALID_REQUEST", "Transaction fields must use valid decimal strings, market/currency, execution time and version.")
	case errors.Is(err, portfolio.ErrInsufficient):
		shared.WriteError(w, r, 409, "INSUFFICIENT_HOLDINGS", "This change would sell more shares than recorded holdings, including later sales. Review transaction dates and quantities.")
	case errors.Is(err, portfolio.ErrConflict):
		shared.WriteError(w, r, 409, "VERSION_CONFLICT", "This transaction changed. Reload before saving again.")
	case errors.Is(err, portfolio.ErrNotFound):
		shared.WriteError(w, r, 404, "RESOURCE_NOT_FOUND", "Transaction not found for this account.")
	case errors.Is(err, portfolio.ErrLimit):
		shared.WriteError(w, r, 409, "PORTFOLIO_LIMIT", "This account has reached the 1,000 transaction limit.")
	default:
		shared.WriteError(w, r, 503, "PORTFOLIO_UNAVAILABLE", "Portfolio storage is unavailable; no save has been confirmed.")
	}
}
