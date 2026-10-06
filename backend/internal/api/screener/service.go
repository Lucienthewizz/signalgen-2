package screenerapi

import (
	"github.com/Lucienthewizz/signalgen-2/backend/internal/screener"
)

// screeningAuthorization wires domain contracts already configured by NewServer.
// Permission policy belongs to screener; this package owns transport mapping.
func (server *Handler) screeningAuthorization() screener.AuthorizationService {
	return screener.AuthorizationService{
		Sessions: server.Sessions, Accounts: server.Access, Entitlements: server.Access,
		Compute: server.Compute, Datasets: server.Datasets, Rules: server.Rules,
	}
}
