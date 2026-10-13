package workspaceapi

import (
	"encoding/json"
	"errors"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/api/shared"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/workspace"
	"io"
	"net/http"
)

type Handler struct {
	*shared.Context
	Store workspace.Store
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	p, _, _, ok := h.RequireAppSession(w, r)
	if !ok {
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	if h.Store == nil {
		shared.WriteError(w, r, 503, "SERVICE_UNAVAILABLE", "Sinkronisasi belum tersedia.")
		return
	}
	items, err := h.Store.List(r.Context(), p.ID)
	if err != nil {
		shared.WriteError(w, r, 503, "SERVICE_UNAVAILABLE", "Workspace belum dapat dimuat.")
		return
	}
	shared.WriteJSON(w, 200, map[string]any{"items": items})
}
func (h *Handler) Put(w http.ResponseWriter, r *http.Request) {
	p, _, _, ok := h.RequireAppSession(w, r)
	if !ok {
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	if !h.AllowRate(w, r, "workspace:write", p.ID) {
		return
	}
	if h.Store == nil {
		shared.WriteError(w, r, 503, "SERVICE_UNAVAILABLE", "Sinkronisasi belum tersedia.")
		return
	}
	var input struct {
		Version *int64          `json:"version"`
		Data    json.RawMessage `json:"data"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, workspace.MaxData+1024)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		shared.WriteError(w, r, 422, "INVALID_REQUEST", "Data workspace tidak valid atau terlalu besar.")
		return
	}
	if decoder.Decode(new(any)) != io.EOF || input.Version == nil || !workspace.Valid(r.PathValue("kind"), input.Data) {
		shared.WriteError(w, r, 422, "INVALID_REQUEST", "Jenis atau isi workspace tidak valid.")
		return
	}
	item, err := h.Store.Put(r.Context(), p.ID, r.PathValue("kind"), *input.Version, input.Data)
	if errors.Is(err, workspace.ErrConflict) {
		shared.WriteError(w, r, 409, "VERSION_CONFLICT", "Data berubah di perangkat lain. Pilih versi sebelum menyimpan.")
		return
	}
	if errors.Is(err, workspace.ErrInvalid) {
		shared.WriteError(w, r, 422, "INVALID_REQUEST", "Data workspace tidak valid.")
		return
	}
	if err != nil {
		shared.WriteError(w, r, 503, "SERVICE_UNAVAILABLE", "Perubahan belum tersinkron. Salinan lokal tetap tersedia.")
		return
	}
	shared.WriteJSON(w, 200, item)
}
