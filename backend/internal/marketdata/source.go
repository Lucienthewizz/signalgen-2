package marketdata

// Source describes provenance, not a guarantee of exchange completeness.
// Optional provider metadata lets archives disclose their fixed date window
// without changing the existing OHLCV payload or Yahoo provider identifier.
type Source struct {
	Provider string
	Warnings []string
}

// DescribeSource returns a fresh copy so caller mutations cannot affect other
// users' manifests. Providers without metadata keep the existing MVP warning.
func DescribeSource(provider Provider) Source {
	result := Source{Provider: "yahoo_finance"}
	if described, ok := provider.(interface{ Source() Source }); ok {
		result = described.Source()
	}
	result.Warnings = append([]string{"Yahoo Finance data; unofficial source for academic MVP use"}, result.Warnings...)
	return result
}

// Source passes metadata through the cache; otherwise an archive would lose
// its fixed-window warning when wrapped by the normal shared market-data cache.
func (provider *CachedProvider) Source() Source {
	if described, ok := provider.upstream.(interface{ Source() Source }); ok {
		result := described.Source()
		result.Warnings = append([]string(nil), result.Warnings...)
		return result
	}
	return Source{Provider: "yahoo_finance"}
}
