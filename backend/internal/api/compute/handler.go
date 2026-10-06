package computeapi

import (
	"github.com/Lucienthewizz/signalgen-2/backend/internal/api/shared"
)

// Handler maps compute requests to domain operations. Shared guards enforce
// identity/session/role checks; feature policy stays in domain packages.
type Handler struct{ *shared.Context }
