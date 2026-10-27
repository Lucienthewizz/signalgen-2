package core

import (
	"math"
	"strings"
)

// All series are causal and use the archived Claudio engine's ta defaults.
// Missing warmup/undefined ratios stay absent, never a fabricated zero.
type indicatorComputer struct {
	candles                        []Candle
	close, high, low, open, volume []float64
	cache                          map[string][]float64
}

func newIndicatorComputer(candles []Candle) *indicatorComputer {
	c := &indicatorComputer{candles: candles, cache: map[string][]float64{}}
	for _, bar := range candles {
		c.close = append(c.close, bar.Close)
		c.high = append(c.high, bar.High)
		c.low = append(c.low, bar.Low)
		c.open = append(c.open, bar.Open)
		c.volume = append(c.volume, float64(bar.Volume))
	}
	return c
}

func missingSeries(n int) []float64 {
	x := make([]float64, n)
	for i := range x {
		x[i] = math.NaN()
	}
	return x
}

func rollingMean(x []float64, n int) []float64 {
	out := missingSeries(len(x))
	for i := n - 1; i < len(x); i++ {
		sum := 0.0
		for j := i - n + 1; j <= i; j++ {
			sum += x[j]
		}
		out[i] = sum / float64(n)
	}
	return out
}

func ewmFinite(x []float64, n int) []float64 {
	out := missingSeries(len(x))
	value, count := 0.0, 0
	alpha := 2.0 / float64(n+1)
	for i, v := range x {
		if math.IsNaN(v) {
			continue
		}
		if count == 0 {
			value = v
		} else {
			value = alpha*v + (1-alpha)*value
		}
		count++
		if count >= n {
			out[i] = value
		}
	}
	return out
}

func midpoint(high, low []float64, n int, partial bool) []float64 {
	out := missingSeries(len(high))
	for i := range high {
		if !partial && i+1 < n {
			continue
		}
		hi, lo := high[i], low[i]
		for j := max(0, i-n+1); j < i; j++ {
			hi = math.Max(hi, high[j])
			lo = math.Min(lo, low[j])
		}
		out[i] = (hi + lo) / 2
	}
	return out
}

func (c *indicatorComputer) raw(base string) []float64 {
	if cached, ok := c.cache[base]; ok {
		return cached
	}
	n := len(c.close)
	out := missingSeries(n)
	if family, p, ok := dynamicPeriod(base); ok {
		switch family {
		case "MA":
			out = rollingMean(c.close, p)
		case "EMA":
			out, _ = emaSeries(c.close, p)
		case "RSI":
			out, _ = rsiSeries(c.close, p)
		case "ADX":
			out = c.adx(p)
		case "SMA_VOLUME_":
			out = rollingMean(c.volume, p)
		case "REL_VOLUME_":
			mean := rollingMean(c.volume, p)
			for i := range out {
				if mean[i] != 0 {
					out[i] = c.volume[i] / mean[i]
				}
			}
		}
	} else {
		switch base {
		case "PRICE", "CLOSE":
			out = c.close
		case "OPEN":
			out = c.open
		case "HIGH":
			out = c.high
		case "LOW":
			out = c.low
		case "VOLUME":
			out = c.volume
		case "PREV_CLOSE", "PREV_OPEN":
			values := c.close
			if base == "PREV_OPEN" {
				values = c.open
			}
			for i := 1; i < n; i++ {
				out[i] = values[i-1]
			}
		case "MACD", "MACD_SIGNAL", "MACD_HIST":
			fast, slow := ewmFinite(c.close, 12), ewmFinite(c.close, 26)
			line := missingSeries(n)
			for i := range line {
				line[i] = fast[i] - slow[i]
			}
			signal := ewmFinite(line, 9)
			for i := range out {
				if base == "MACD" {
					out[i] = line[i]
				} else if base == "MACD_SIGNAL" {
					out[i] = signal[i]
				} else {
					out[i] = line[i] - signal[i]
				}
			}
		case "BB_UPPER", "BB_MIDDLE", "BB_LOWER", "BB_WIDTH":
			mean := rollingMean(c.close, 20)
			for i := 19; i < n; i++ {
				variance := 0.0
				for j := i - 19; j <= i; j++ {
					variance += (c.close[j] - mean[i]) * (c.close[j] - mean[i])
				}
				std := math.Sqrt(variance / 20)
				switch base {
				case "BB_UPPER":
					out[i] = mean[i] + 2*std
				case "BB_LOWER":
					out[i] = mean[i] - 2*std
				case "BB_WIDTH":
					out[i] = 4 * std
				default:
					out[i] = mean[i]
				}
			}
		case "STOCH_K", "STOCH_D":
			for i := 13; i < n; i++ {
				hi, lo := c.high[i], c.low[i]
				for j := i - 13; j < i; j++ {
					hi = math.Max(hi, c.high[j])
					lo = math.Min(lo, c.low[j])
				}
				if hi != lo {
					out[i] = 100 * (c.close[i] - lo) / (hi - lo)
				}
			}
			if base == "STOCH_D" {
				out = rollingMean(out, 3)
			}
		case "ICHIMOKU_CONVERSION":
			out = midpoint(c.high, c.low, 9, false)
		case "ICHIMOKU_BASE":
			out = midpoint(c.high, c.low, 26, false)
		case "ICHIMOKU_A":
			tenkan, kijun := c.raw("ICHIMOKU_CONVERSION"), c.raw("ICHIMOKU_BASE")
			for i := range out {
				out[i] = (tenkan[i] + kijun[i]) / 2
			}
		case "ICHIMOKU_B":
			out = midpoint(c.high, c.low, 52, true) // ta: visual=False, min_periods=0
		case "PRICE_EMA20_DIFF_PCT":
			ema := c.raw("EMA20")
			for i := range out {
				out[i] = math.Abs(c.close[i]-ema[i]) / ema[i]
			} // ratio, not multiplied by 100 in Claudio
		default:
			if strings.HasPrefix(base, "PATTERN_") {
				out = c.pattern(base)
			}
		}
	}
	c.cache[base] = out
	return out
}

func (c *indicatorComputer) series(name string) []float64 {
	spec, _ := parseOperand(name)
	raw := c.raw(spec.base)
	out := missingSeries(len(raw))
	warmup := OperandWarmup(spec.base)
	for i := spec.offset; i < len(out); i++ {
		index := i - spec.offset
		// ta.ADX raises on a short prefix, even when a PREV_n target would
		// otherwise refer to a pre-seed zero. Do not use future availability.
		if family, p, ok := dynamicPeriod(spec.base); spec.rawHistory && ok && family == "ADX" && i+1 < 2*p {
			continue
		}
		if !spec.rawHistory && index+1 < warmup {
			continue
		}
		value := raw[index]
		if !spec.rawHistory && strings.HasPrefix(spec.base, "REL_VOLUME_") && math.IsNaN(value) {
			_, p, _ := dynamicPeriod(spec.base)
			if index+1 >= p {
				value = 1
			} // Claudio's zero-volume fallback
		}
		out[i] = value
	}
	return out
}

func (c *indicatorComputer) adx(p int) []float64 {
	n := len(c.close)
	out := make([]float64, n)
	if n < 2*p {
		return out
	}
	tr, up, down := 0.0, 0.0, 0.0
	dx := make([]float64, n-p)
	for i := 1; i < n; i++ {
		r := math.Max(c.high[i], c.close[i-1]) - math.Min(c.low[i], c.close[i-1])
		u, d := c.high[i]-c.high[i-1], c.low[i-1]-c.low[i]
		positive, negative := 0.0, 0.0
		if u > d && u > 0 {
			positive = u
		}
		if d > u && d > 0 {
			negative = d
		}
		if i <= p {
			tr += r
			up += positive
			down += negative
		} else {
			tr = tr - tr/float64(p) + r
			up = up - up/float64(p) + positive
			down = down - down/float64(p) + negative
		}
		if i >= p && tr != 0 && up+down != 0 {
			dx[i-p] = 100 * math.Abs(up-down) / (up + down)
		}
	}
	seed := 0.0
	for _, v := range dx[:p] {
		seed += v
	}
	out[2*p-1] = seed / float64(p)
	for i := 2 * p; i < n; i++ {
		out[i] = (out[i-1]*float64(p-1) + dx[i-p]) / float64(p)
	}
	return out
}
