package universesapi

import (
	"errors"
	"net/http"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/api/shared"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

func (server *Handler) ListStockCatalog(writer http.ResponseWriter, request *http.Request) {
	if _, _, _, ok := server.RequireAppSession(writer, request); !ok {
		return
	}
	items, err := server.Universes.Catalog(request.Context())
	if err != nil {
		shared.WriteError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Katalog saham belum dapat dibaca.")
		return
	}
	shared.WriteJSON(writer, http.StatusOK, map[string]any{"items": items})
}

func (server *Handler) ListStockUniverses(writer http.ResponseWriter, request *http.Request) {
	principal, _, _, ok := server.RequireAppSession(writer, request)
	if !ok {
		return
	}
	items, err := server.Universes.List(request.Context(), principal.ID)
	if err != nil {
		shared.WriteError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Stock universe belum dapat dibaca.")
		return
	}
	shared.WriteJSON(writer, http.StatusOK, map[string]any{"items": items})
}

func (server *Handler) GetStockUniverse(writer http.ResponseWriter, request *http.Request) {
	principal, _, _, ok := server.RequireAppSession(writer, request)
	if !ok {
		return
	}
	item, err := server.Universes.Get(request.Context(), principal.ID, request.PathValue("id"))
	if writeUniverseError(writer, request, err) {
		return
	}
	shared.WriteJSON(writer, http.StatusOK, item)
}

func (server *Handler) CreateStockUniverse(writer http.ResponseWriter, request *http.Request) {
	principal, _, _, ok := server.RequireAppSession(writer, request)
	if !ok || !server.AllowRate(writer, request, "stock-universes:create", principal.ID) {
		return
	}
	var input struct {
		Name    string   `json:"name"`
		Symbols []string `json:"symbols"`
	}
	if err := shared.DecodeJSON(request, &input); err != nil {
		shared.WriteJSONInputError(writer, request, err, "Stock universe tidak valid.")
		return
	}
	item, err := server.Universes.Create(request.Context(), principal.ID, input.Name, input.Symbols)
	if writeUniverseError(writer, request, err) {
		return
	}
	shared.WriteJSON(writer, http.StatusCreated, item)
}

func (server *Handler) UpdateStockUniverse(writer http.ResponseWriter, request *http.Request) {
	principal, _, _, ok := server.RequireAppSession(writer, request)
	if !ok || !server.AllowRate(writer, request, "stock-universes:update", principal.ID) {
		return
	}
	var input struct {
		Name    string   `json:"name"`
		Symbols []string `json:"symbols"`
		Version int      `json:"version"`
	}
	if err := shared.DecodeJSON(request, &input); err != nil {
		shared.WriteJSONInputError(writer, request, err, "Stock universe tidak valid.")
		return
	}
	item, err := server.Universes.Update(request.Context(), principal.ID, request.PathValue("id"), input.Name, input.Symbols, input.Version)
	if writeUniverseError(writer, request, err) {
		return
	}
	shared.WriteJSON(writer, http.StatusOK, item)
}

func (server *Handler) DeleteStockUniverse(writer http.ResponseWriter, request *http.Request) {
	principal, _, _, ok := server.RequireAppSession(writer, request)
	if !ok || !server.AllowRate(writer, request, "stock-universes:delete", principal.ID) {
		return
	}
	var input struct {
		Version int `json:"version"`
	}
	if err := shared.DecodeJSON(request, &input); err != nil {
		shared.WriteJSONInputError(writer, request, err, "Versi stock universe tidak valid.")
		return
	}
	if writeUniverseError(writer, request, server.Universes.Delete(request.Context(), principal.ID, request.PathValue("id"), input.Version)) {
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func writeUniverseError(writer http.ResponseWriter, request *http.Request, err error) bool {
	if err == nil {
		return false
	}
	switch {
	case errors.Is(err, universe.ErrNotFound):
		shared.WriteError(writer, request, http.StatusNotFound, "RESOURCE_NOT_FOUND", "Stock universe tidak ditemukan.")
	case errors.Is(err, universe.ErrInvalid):
		shared.WriteError(writer, request, http.StatusUnprocessableEntity, "INVALID_REQUEST", "Nama atau anggota stock universe tidak valid.")
	case errors.Is(err, universe.ErrVersionConflict):
		shared.WriteError(writer, request, http.StatusConflict, "VERSION_CONFLICT", "Stock universe sudah berubah. Muat ulang sebelum mencoba lagi.")
	default:
		shared.WriteError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Stock universe belum dapat diproses.")
	}
	return true
}
