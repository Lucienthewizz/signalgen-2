package recordsapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/api/shared"
	platformhttp "github.com/Lucienthewizz/signalgen-2/backend/internal/platform/http"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/records"
)

type Handler struct {
	*shared.Context
	Store records.Store
}

func (h *Handler) Serve(w http.ResponseWriter, r *http.Request) {
	p, _, _, ok := h.RequireAppSession(w, r)
	if !ok {
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	kind := "journal"
	if strings.HasPrefix(r.URL.Path, "/api/v1/backtests/") {
		kind = "backtest"
	}
	if kind == "backtest" {
		if err := h.Access.RequireFeature(r.Context(), p.ID, "backtest"); err != nil {
			shared.WriteAccessError(w, r, err)
			return
		}
	}
	if !h.AllowRate(w, r, "records:"+strings.ToLower(r.Method), p.ID) {
		return
	}
	if h.Store == nil {
		failure(w, r, errors.New("unavailable"))
		return
	}
	id := r.PathValue("id")
	if id != "" && !records.UUID.MatchString(id) {
		failure(w, r, records.ErrInvalid)
		return
	}
	if len(r.URL.Query()) > 0 {
		failure(w, r, records.ErrInvalid)
		return
	}
	switch r.Method {
	case http.MethodGet:
		if id != "" {
			item, err := h.Store.Get(r.Context(), p.ID, kind, id)
			if err != nil {
				failure(w, r, err)
				return
			}
			shared.WriteJSON(w, 200, item)
			return
		}
		items, err := h.Store.List(r.Context(), p.ID, kind)
		if err != nil {
			failure(w, r, err)
			return
		}
		shared.WriteJSON(w, 200, map[string]any{"items": items})
	case http.MethodPut:
		if id == "" {
			failure(w, r, records.ErrInvalid)
			return
		}
		var input struct {
			Version *int64          `json:"version"`
			Data    json.RawMessage `json:"data"`
		}
		limit := int64(12 << 10)
		if kind == "backtest" {
			limit = records.MaxArchiveBytes + 1024
		}
		if err := platformhttp.DecodeJSONLimit(r, &input, limit); err != nil {
			if errors.Is(err, platformhttp.ErrJSONBodyTooLarge) {
				shared.WriteError(w, r, 413, "PAYLOAD_TOO_LARGE", "Record exceeds the upload limit (backtests: 8 MiB).")
			} else {
				failure(w, r, records.ErrInvalid)
			}
			return
		}
		if input.Version == nil || *input.Version < 0 || (kind == "backtest" && *input.Version != 0) {
			failure(w, r, records.ErrInvalid)
			return
		}
		var data json.RawMessage
		var err error
		if kind == "journal" {
			data, err = records.NormalizeTrade(input.Data)
		} else {
			data, err = records.NormalizeArchive(input.Data, id)
		}
		if err != nil {
			failure(w, r, err)
			return
		}
		item, err := h.Store.Put(r.Context(), p.ID, kind, id, *input.Version, data)
		if err != nil {
			failure(w, r, err)
			return
		}
		shared.WriteJSON(w, 200, item)
	case http.MethodDelete:
		var input struct {
			Version *int64 `json:"version"`
		}
		if platformhttp.DecodeJSON(r, &input) != nil || input.Version == nil || (id == "" && *input.Version != 0) || (id != "" && *input.Version < 1) {
			failure(w, r, records.ErrInvalid)
			return
		}
		if id == "" && kind != "backtest" {
			failure(w, r, records.ErrInvalid)
			return
		}
		if err := h.Store.Delete(r.Context(), p.ID, kind, id, *input.Version); err != nil {
			failure(w, r, err)
			return
		}
		w.WriteHeader(204)
	}
}
func failure(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, records.ErrInvalid):
		shared.WriteError(w, r, 422, "INVALID_REQUEST", "Record fields, dates, prices or version are invalid.")
	case errors.Is(err, records.ErrConflict):
		shared.WriteError(w, r, 409, "VERSION_CONFLICT", "This record changed on another device. Reload before trying again.")
	case errors.Is(err, records.ErrNotFound):
		shared.WriteError(w, r, 404, "RESOURCE_NOT_FOUND", "Record not found for this account.")
	case errors.Is(err, records.ErrQuota):
		shared.WriteError(w, r, 409, "RECORD_LIMIT", "This account has reached the 1,000 trade limit. Delete an old trade before adding another.")
	default:
		shared.WriteError(w, r, 503, "RECORDS_UNAVAILABLE", "Server records are unavailable. The records migration may not be deployed; nothing has been reported as saved.")
	}
}
