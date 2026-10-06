package shared

import (
	"errors"
	"net/http"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/compute"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/rules"
)

func WriteRuleError(writer http.ResponseWriter, request *http.Request, err error) {
	switch {
	case errors.Is(err, rules.ErrNotFound):
		WriteError(writer, request, http.StatusNotFound, "RESOURCE_NOT_FOUND", "Rule tidak ditemukan.")
	case errors.Is(err, rules.ErrInvalid):
		WriteError(writer, request, http.StatusUnprocessableEntity, "INVALID_RULE", "Definisi rule tidak didukung.")
	case errors.Is(err, rules.ErrVersionConflict):
		WriteError(writer, request, http.StatusConflict, "VERSION_CONFLICT", "Rule sudah berubah; muat ulang versi terbaru.")
	case errors.Is(err, rules.ErrLimit):
		WriteError(writer, request, http.StatusConflict, "RULE_LIMIT_REACHED", "Batas 100 rule per akun sudah tercapai.")
	default:
		WriteError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Rule belum dapat diproses.")
	}
}

func WriteComputeGrantError(writer http.ResponseWriter, request *http.Request, err error) {
	switch {
	case errors.Is(err, compute.ErrExpired):
		WriteError(writer, request, http.StatusForbidden, "GRANT_EXPIRED", "Compute grant sudah kedaluwarsa.")
	case errors.Is(err, compute.ErrInvalid):
		WriteError(writer, request, http.StatusForbidden, "GRANT_INVALID", "Compute grant tidak valid.")
	default:
		WriteError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Compute grant belum dapat diverifikasi.")
	}
}
