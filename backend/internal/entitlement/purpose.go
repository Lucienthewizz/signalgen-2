package entitlement

// FeatureForPurpose is the domain allow-list shared by dataset preparation and
// grant issuance. HTTP adapters must not invent another purpose-to-feature map.
func FeatureForPurpose(purpose string) (string, bool) {
	switch purpose {
	case "screen":
		return FeatureScreener, true
	case "backtest":
		return FeatureBacktest, true
	default:
		return "", false
	}
}
