// Package entitlement defines access to paid/server-controlled features.
package entitlement

import "github.com/Lucienthewizz/signalgen-2/backend/internal/access"

type Grant = access.FeatureGrant

const (
	FeatureScreener = access.FeatureScreener
	FeatureBacktest = access.FeatureBacktest
)
