package marketdata

import (
	"encoding/json"
	"fmt"
	"time"
	_ "time/tzdata" // Exchange timezone/DST rules must also work in the slim Docker image.
)

type yahooMarketMeta struct {
	DataGranularity      string          `json:"dataGranularity"`
	TradingPeriods       json.RawMessage `json:"tradingPeriods"`
	ExchangeTimezoneName string          `json:"exchangeTimezoneName"`
	GMTOffset            *int            `json:"gmtoffset"`
	CurrentTradingPeriod struct {
		Regular struct {
			Start int64 `json:"start"`
			End   int64 `json:"end"`
		} `json:"regular"`
	} `json:"currentTradingPeriod"`
}

// dailyFinality is one immutable policy per provider response. Older market
// dates are retained; today's candle needs a valid session-end confirmation.
// This is not an exchange calendar or a guarantee that Yahoo's final quote has
// already settled. No local hardcoded NYSE/IDX opening hours are assumed.
type dailyFinality struct {
	now      time.Time
	location *time.Location
	start    time.Time
	end      time.Time
	session  bool
	fallback bool
}

// newDailyFinality prefers IANA timezone rules (including US DST), then the
// provider's fixed offset. A missing calendar/session never invents market hours.
func newDailyFinality(meta yahooMarketMeta, now time.Time) dailyFinality {
	policy := dailyFinality{now: now, location: time.UTC}
	location, err := time.LoadLocation(meta.ExchangeTimezoneName)
	if meta.ExchangeTimezoneName != "" && err == nil {
		policy.location = location
	} else if meta.GMTOffset != nil && *meta.GMTOffset >= -12*3600 && *meta.GMTOffset <= 14*3600 {
		policy.location = time.FixedZone("provider-market", *meta.GMTOffset)
	} else {
		// Missing timezone information must not turn today's UTC bar into a
		// confirmed close. Its exclusion is disclosed in dataset warnings.
		policy.fallback = true
	}
	regular := meta.CurrentTradingPeriod.Regular
	if regular.Start > 0 && regular.End > regular.Start && regular.End-regular.Start <= 24*3600 {
		policy.start, policy.end = time.Unix(regular.Start, 0), time.Unix(regular.End, 0)
		policy.session = true
	}
	if !policy.session {
		policy.fallback = true
	}
	return policy
}

// closed answers whether this row is eligible for closed-daily screening. It
// does not assert a provider's freshness, coverage or corporate-action policy.
func (policy dailyFinality) closed(timestamp int64) bool {
	stamp := time.Unix(timestamp, 0)
	if timestamp <= 0 || stamp.After(policy.now) {
		return false
	}
	date := stamp.In(policy.location).Format("2006-01-02")
	today := policy.now.In(policy.location).Format("2006-01-02")
	if date < today {
		return true
	}
	if date > today || !policy.session {
		return false
	}
	// Session metadata may already describe tomorrow or be stale. Only use it
	// to confirm a candle from that same market date, including DST boundaries.
	return date == policy.start.In(policy.location).Format("2006-01-02") &&
		date == policy.end.Add(-time.Nanosecond).In(policy.location).Format("2006-01-02") &&
		!policy.now.Before(policy.end)
}

// dailyQualityWarnings explains omissions without replacing prices with zeros
// or treating an unavailable dataset as a strategy's legitimate "No match".
func dailyQualityWarnings(symbol string, skippedNull, excludedOpen int, fallback bool) []string {
	warnings := []string{}
	if skippedNull > 0 {
		warnings = append(warnings, fmt.Sprintf("%s: excluded %d null OHLCV row(s); history may have gaps", symbol, skippedNull))
	}
	if excludedOpen > 0 {
		warnings = append(warnings, fmt.Sprintf("%s: excluded %d unfinished or unconfirmed daily candle(s)", symbol, excludedOpen))
	}
	if fallback {
		warnings = append(warnings, fmt.Sprintf("%s: incomplete session metadata; current market day excluded unless its close is confirmed (UTC fallback when timezone is unavailable)", symbol))
	}
	return warnings
}
