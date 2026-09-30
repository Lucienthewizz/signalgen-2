package api

import (
	"errors"
	"net/http"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

func (server *Server) listStockCatalog(writer http.ResponseWriter, request *http.Request) {
	if _, _, _, ok := server.requireAppSession(writer, request); !ok {
		return
	}
	items, err := server.universes.Catalog(request.Context())
	if err != nil {
		writeError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Katalog saham belum dapat dibaca.")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"items": items})
}

func (server *Server) listStockUniverses(writer http.ResponseWriter, request *http.Request) {
	principal, _, _, ok := server.requireAppSession(writer, request)
	if !ok {
		return
	}
	items, err := server.universes.List(request.Context(), principal.ID)
	if err != nil {
		writeError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Stock universe belum dapat dibaca.")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"items": items})
}

func (server *Server) getStockUniverse(writer http.ResponseWriter, request *http.Request) {
	principal, _, _, ok := server.requireAppSession(writer, request)
	if !ok {
		return
	}
	item, err := server.universes.Get(request.Context(), principal.ID, request.PathValue("id"))
	if writeUniverseError(writer, request, err) {
		return
	}
	writeJSON(writer, http.StatusOK, item)
}

func (server *Server) createStockUniverse(writer http.ResponseWriter, request *http.Request) {
	principal, _, _, ok := server.requireAppSession(writer, request)
	if !ok || !server.allowRate(writer, request, "stock-universes:create", principal.ID) {
		return
	}
	var input struct {
		Name    string   `json:"name"`
		Symbols []string `json:"symbols"`
	}
	if err := decodeJSON(request, &input); err != nil {
		writeJSONInputError(writer, request, err, "Stock universe tidak valid.")
		return
	}
	item, err := server.universes.Create(request.Context(), principal.ID, input.Name, input.Symbols)
	if writeUniverseError(writer, request, err) {
		return
	}
	writeJSON(writer, http.StatusCreated, item)
}

func (server *Server) updateStockUniverse(writer http.ResponseWriter, request *http.Request) {
	principal, _, _, ok := server.requireAppSession(writer, request)
	if !ok || !server.allowRate(writer, request, "stock-universes:update", principal.ID) {
		return
	}
	var input struct {
		Name    string   `json:"name"`
		Symbols []string `json:"symbols"`
		Version int      `json:"version"`
	}
	if err := decodeJSON(request, &input); err != nil {
		writeJSONInputError(writer, request, err, "Stock universe tidak valid.")
		return
	}
	item, err := server.universes.Update(request.Context(), principal.ID, request.PathValue("id"), input.Name, input.Symbols, input.Version)
	if writeUniverseError(writer, request, err) {
		return
	}
	writeJSON(writer, http.StatusOK, item)
}

func (server *Server) deleteStockUniverse(writer http.ResponseWriter, request *http.Request) {
	principal, _, _, ok := server.requireAppSession(writer, request)
	if !ok || !server.allowRate(writer, request, "stock-universes:delete", principal.ID) {
		return
	}
	var input struct {
		Version int `json:"version"`
	}
	if err := decodeJSON(request, &input); err != nil {
		writeJSONInputError(writer, request, err, "Versi stock universe tidak valid.")
		return
	}
	if writeUniverseError(writer, request, server.universes.Delete(request.Context(), principal.ID, request.PathValue("id"), input.Version)) {
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
		writeError(writer, request, http.StatusNotFound, "RESOURCE_NOT_FOUND", "Stock universe tidak ditemukan.")
	case errors.Is(err, universe.ErrInvalid):
		writeError(writer, request, http.StatusUnprocessableEntity, "INVALID_REQUEST", "Nama atau anggota stock universe tidak valid.")
	case errors.Is(err, universe.ErrVersionConflict):
		writeError(writer, request, http.StatusConflict, "VERSION_CONFLICT", "Stock universe sudah berubah. Muat ulang sebelum mencoba lagi.")
	default:
		writeError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Stock universe belum dapat diproses.")
	}
	return true
}
