package backtestsapi

import (
	"errors"
	"net/http"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/api/shared"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/backtest"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/dataset"
	platformhttp "github.com/Lucienthewizz/signalgen-2/backend/internal/platform/http"
)

type Handler struct{ *shared.Context }

func (server *Handler) Signals(writer http.ResponseWriter, request *http.Request) {
	principal, appSession, _, ok := server.RequireAppSession(writer, request)
	if !ok {
		return
	}
	if !server.AllowRate(writer, request, "backtests:signals", principal.ID) {
		return
	}
	var input backtest.SignalInput
	if err := platformhttp.DecodeJSONLimit(request, &input, 8<<20); err != nil {
		if errors.Is(err, shared.ErrJSONBodyTooLarge) {
			shared.WriteError(writer, request, http.StatusRequestEntityTooLarge, "PAYLOAD_TOO_LARGE", "Backtest features exceed 8 MiB.")
		} else {
			shared.WriteJSONInputError(writer, request, err, "Invalid backtest features.")
		}
		return
	}
	service := backtest.Service{Features: server.Access, Datasets: server.Datasets, Compute: server.Compute, Rules: server.Rules}
	result, err := service.Signals(request.Context(), principal.ID, appSession.ID, input)
	if err != nil {
		writeError(writer, request, err)
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	shared.WriteJSON(writer, http.StatusOK, result)
}

func writeError(writer http.ResponseWriter, request *http.Request, err error) {
	var failure *backtest.Failure
	if errors.As(err, &failure) {
		switch failure.Stage {
		case "access":
			shared.WriteAccessError(writer, request, failure.Err)
			return
		case "grant":
			shared.WriteComputeGrantError(writer, request, failure.Err)
			return
		case "rule":
			shared.WriteRuleError(writer, request, failure.Err)
			return
		}
	}
	switch {
	case errors.Is(err, dataset.ErrNotFound):
		shared.WriteError(writer, request, http.StatusNotFound, "RESOURCE_NOT_FOUND", "Backtest snapshot is unavailable.")
	case errors.Is(err, backtest.ErrVersion):
		shared.WriteError(writer, request, http.StatusUnprocessableEntity, "VERSION_MISMATCH", "Backtest context changed; prepare a new snapshot and grant.")
	case errors.Is(err, backtest.ErrUnsupported):
		shared.WriteError(writer, request, http.StatusUnprocessableEntity, "UNSUPPORTED_CAPABILITY", "Only the versioned daily long holding-period policy is supported.")
	case errors.Is(err, backtest.ErrInvalid):
		shared.WriteError(writer, request, http.StatusUnprocessableEntity, "INVALID_REQUEST", "Send all eligible features for one snapshot symbol in chronological order.")
	default:
		shared.WriteError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Backtest decisions are temporarily unavailable.")
	}
}
