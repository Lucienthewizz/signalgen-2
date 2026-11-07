package journalapi

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/api/shared"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/journal"
	platformhttp "github.com/Lucienthewizz/signalgen-2/backend/internal/platform/http"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/records"
)

type Handler struct {
	*shared.Context
	Store records.Store
}

func (h *Handler) Serve(w http.ResponseWriter, r *http.Request) {
	p, appSession, _, ok := h.RequireAppSession(w, r)
	if !ok {
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	if !h.AllowRate(w, r, "screening-journal:"+r.Method, p.ID) {
		return
	}
	if len(r.URL.Query()) != 0 {
		shared.WriteError(w, r, 422, "INVALID_REQUEST", "Journal filters are not accepted by this endpoint.")
		return
	}
	if h.Store == nil {
		shared.WriteError(w, r, 503, "JOURNAL_UNAVAILABLE", "Journal storage is temporarily unavailable.")
		return
	}
	if r.Method == http.MethodGet {
		items, err := h.Store.List(r.Context(), p.ID, "journal")
		if err != nil {
			failure(w, r, err)
			return
		}
		filtered := make([]records.Item, 0, len(items))
		for _, item := range items {
			var entry journal.Entry
			if json.Unmarshal(item.Data, &entry) == nil && entry.Schema == journal.Schema && entry.Source == "screening" && entry.Matched {
				filtered = append(filtered, item)
			}
		}
		shared.WriteJSON(w, 200, map[string]any{"schema_version": journal.Schema, "items": filtered})
		return
	}
	if err := h.Access.RequireFeature(r.Context(), p.ID, "screener"); err != nil {
		shared.WriteAccessError(w, r, err)
		return
	}
	var input struct {
		Receipt string `json:"receipt"`
	}
	if err := platformhttp.DecodeJSONLimit(r, &input, journal.MaxReceiptBytes+128); err != nil {
		shared.WriteJSONInputError(w, r, err, "A screening receipt is required.")
		return
	}
	verified, err := h.JournalReceipts.Verify(input.Receipt, p.ID, appSession.ID)
	if err != nil {
		shared.WriteError(w, r, 422, "SCREENING_RECEIPT_INVALID", "Run screening again and select a matched result from this session.")
		return
	}
	data, err := json.Marshal(verified.Data)
	if err != nil {
		failure(w, r, err)
		return
	}
	item, err := h.Store.Put(r.Context(), p.ID, "journal", verified.ID, 0, data)
	if err != nil {
		failure(w, r, err)
		return
	}
	shared.WriteJSON(w, 200, item)
}

func failure(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, records.ErrQuota):
		shared.WriteError(w, r, 409, "RECORD_LIMIT", "Journal storage has reached its record limit.")
	case errors.Is(err, records.ErrConflict):
		shared.WriteError(w, r, 409, "VERSION_CONFLICT", "This screening receipt conflicts with a stored record. Run screening again.")
	default:
		shared.WriteError(w, r, 503, "JOURNAL_UNAVAILABLE", "Journal storage is temporarily unavailable. Retry the same selected results.")
	}
}
