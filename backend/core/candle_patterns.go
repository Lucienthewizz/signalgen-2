package core

import "math"

// Port of TA-Lib's default candle settings and pattern predicates. See
// licenses/TA-Lib.txt. Claudio turns the signed TA-Lib result into a 0/1 flag.
// No trend filter is added: TA-Lib's candle functions do not apply one either.
func (c *indicatorComputer) pattern(name string) []float64 {
	n := len(c.candles)
	out := make([]float64, n)
	body := func(i int) float64 { return math.Abs(c.close[i] - c.open[i]) }
	top := func(i int) float64 { return math.Max(c.close[i], c.open[i]) }
	bottom := func(i int) float64 { return math.Min(c.close[i], c.open[i]) }
	white := func(i int) bool { return c.close[i] >= c.open[i] }
	avg := func(i, p int, realBody bool) float64 {
		sum := 0.0
		for j := i - p; j < i; j++ {
			if realBody {
				sum += body(j)
			} else {
				sum += c.high[j] - c.low[j]
			}
		}
		return sum / float64(p)
	}
	for i := range out {
		match := false
		switch name {
		case "PATTERN_CDLDOJI":
			match = i >= 10 && body(i) <= .1*avg(i, 10, false)
		case "PATTERN_CDLHAMMER":
			match = i >= 11 && body(i) < avg(i, 10, true) && bottom(i)-c.low[i] > body(i) && c.high[i]-top(i) < .1*avg(i, 10, false) && bottom(i) <= c.low[i-1]+.2*avg(i-1, 5, false)
		case "PATTERN_CDLSHOOTINGSTAR":
			match = i >= 11 && body(i) < avg(i, 10, true) && c.high[i]-top(i) > body(i) && bottom(i)-c.low[i] < .1*avg(i, 10, false) && bottom(i) > top(i-1)
		case "PATTERN_BULLISH_ENGULFING":
			match = i >= 2 && white(i) && !white(i-1) && ((c.close[i] >= c.open[i-1] && c.open[i] < c.close[i-1]) || (c.close[i] > c.open[i-1] && c.open[i] <= c.close[i-1]))
		case "PATTERN_BEARISH_ENGULFING":
			match = i >= 2 && !white(i) && white(i-1) && ((c.open[i] >= c.close[i-1] && c.close[i] < c.open[i-1]) || (c.open[i] > c.close[i-1] && c.close[i] <= c.open[i-1]))
		case "PATTERN_CDLMORNINGSTAR":
			match = i >= 12 && body(i-2) > avg(i-2, 10, true) && !white(i-2) && body(i-1) <= avg(i-1, 10, true) && top(i-1) < bottom(i-2) && body(i) > avg(i, 10, true) && white(i) && c.close[i] > c.close[i-2]+body(i-2)*.3
		case "PATTERN_CDLEVENINGSTAR":
			match = i >= 12 && body(i-2) > avg(i-2, 10, true) && white(i-2) && body(i-1) <= avg(i-1, 10, true) && bottom(i-1) > top(i-2) && body(i) > avg(i, 10, true) && !white(i) && c.close[i] < c.close[i-2]-body(i-2)*.3
		case "PATTERN_CDLHARAMI":
			match = i >= 11 && body(i-1) > avg(i-1, 10, true) && body(i) <= avg(i, 10, true) && top(i) <= top(i-1) && bottom(i) >= bottom(i-1)
		case "PATTERN_CDLPIERCING":
			match = i >= 11 && !white(i-1) && body(i-1) > avg(i-1, 10, true) && white(i) && body(i) > avg(i, 10, true) && c.open[i] < c.low[i-1] && c.close[i] < c.open[i-1] && c.close[i] > c.close[i-1]+body(i-1)*.5
		case "PATTERN_CDLDARKCLOUDCOVER":
			match = i >= 11 && white(i-1) && body(i-1) > avg(i-1, 10, true) && !white(i) && c.open[i] > c.high[i-1] && c.close[i] > c.open[i-1] && c.close[i] < c.close[i-1]-body(i-1)*.5
		}
		if match {
			out[i] = 1
		}
	}
	return out
}
