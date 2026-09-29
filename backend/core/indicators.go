package core

import (
	"fmt"
	"math"
)

func emaSeries(values []float64, period int) ([]float64, error) {
	if period <= 0 {
		return nil, fmt.Errorf("EMA period must be positive")
	}
	if len(values) == 0 {
		return nil, fmt.Errorf("EMA requires at least one value")
	}

	result := make([]float64, len(values))
	for i := range result {
		result[i] = math.NaN()
	}

	alpha := 2.0 / float64(period+1)
	value := values[0]
	if period == 1 {
		result[0] = value
	}
	for i := 1; i < len(values); i++ {
		value = alpha*values[i] + (1-alpha)*value
		if i+1 >= period {
			result[i] = value
		}
	}
	return result, nil
}

// rsiSeries mirrors ta.momentum.rsi(window=period, fillna=false): Wilder's
// exponentially weighted gain/loss with alpha=1/period and adjust=false.
func rsiSeries(values []float64, period int) ([]float64, error) {
	if period <= 0 {
		return nil, fmt.Errorf("RSI period must be positive")
	}
	if len(values) == 0 {
		return nil, fmt.Errorf("RSI requires at least one value")
	}

	result := make([]float64, len(values))
	for i := range result {
		result[i] = math.NaN()
	}

	alpha := 1.0 / float64(period)
	avgGain := 0.0
	avgLoss := 0.0
	for i := range values {
		gain := 0.0
		loss := 0.0
		if i > 0 {
			delta := values[i] - values[i-1]
			if delta > 0 {
				gain = delta
			} else if delta < 0 {
				loss = -delta
			}
			avgGain = alpha*gain + (1-alpha)*avgGain
			avgLoss = alpha*loss + (1-alpha)*avgLoss
		}

		if i+1 < period {
			continue
		}
		if avgLoss == 0 {
			result[i] = 100
			continue
		}
		rs := avgGain / avgLoss
		result[i] = 100 - (100 / (1 + rs))
	}
	return result, nil
}
