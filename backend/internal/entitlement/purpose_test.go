package entitlement

import "testing"

func TestFeatureForPurposeAllowlist(t *testing.T) {
	for _, tc := range []struct {
		purpose, feature string
		supported        bool
	}{
		{"screen", FeatureScreener, true},
		{"backtest", FeatureBacktest, true},
		{"", "", false},
		{"trade", "", false},
		{"SCREEN", "", false},
	} {
		feature, supported := FeatureForPurpose(tc.purpose)
		if feature != tc.feature || supported != tc.supported {
			t.Fatalf("purpose=%q feature=%q supported=%v", tc.purpose, feature, supported)
		}
	}
}
