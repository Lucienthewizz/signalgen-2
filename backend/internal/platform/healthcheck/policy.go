// Package healthcheck keeps the readiness handler and its local probe in sync.
// Readiness still checks schema, RLS and runtime privileges; liveness is separate.
package healthcheck

import "time"

const (
	// A cold cloud pool connection can take several seconds before the metadata
	// queries run. Keep this below the API's 10-second request deadline.
	ReadinessTimeout = 8 * time.Second
	// Let the handler finish and send its real status before the probe cancels
	// it. Docker must allow longer again (10 seconds in backend/Go.Dockerfile).
	ProbeTimeout = ReadinessTimeout + time.Second
)
