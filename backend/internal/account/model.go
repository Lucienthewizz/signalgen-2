package account

import "github.com/Lucienthewizz/signalgen-2/backend/internal/access"

// Aliases provide the web account module a stable vocabulary while the
// SQLite-era access package remains available only to legacy tests/tools.
type Profile = access.Account
type Role = access.AccountRole
