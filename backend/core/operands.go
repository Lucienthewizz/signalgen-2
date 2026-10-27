package core

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

const IndicatorCatalogVersion = "claudio-indicators-1"
const MaxIndicatorOperands = 40 // two operands in each of the 20 rule conditions

//go:embed indicator_catalog.json
var catalogJSON []byte

var indicatorCatalog = func() struct {
	Operands []string `json:"operands"`
} {
	var catalog struct {
		Operands []string `json:"operands"`
	}
	if err := json.Unmarshal(catalogJSON, &catalog); err != nil {
		panic(err)
	}
	return catalog
}()

var dynamicOperand = regexp.MustCompile(`^(MA|EMA|RSI|ADX|SMA_VOLUME_|REL_VOLUME_)([1-9][0-9]{0,2})$`)
var previousOperand = regexp.MustCompile(`^(.+)_PREV_([1-9][0-9]{0,2})$`)

type operandSpec struct {
	base       string
	offset     int
	rawHistory bool
}

func staticOperand(name string) bool {
	i := sort.SearchStrings(indicatorCatalog.Operands, name)
	return i < len(indicatorCatalog.Operands) && indicatorCatalog.Operands[i] == name
}

func dynamicPeriod(name string) (string, int, bool) {
	m := dynamicOperand.FindStringSubmatch(name)
	if m == nil {
		return "", 0, false
	}
	n, _ := strconv.Atoi(m[2])
	return m[1], n, n >= 1 && n <= 250
}

func parseOperand(name string) (operandSpec, bool) {
	if m := previousOperand.FindStringSubmatch(name); m != nil {
		n, _ := strconv.Atoi(m[2])
		_, _, dynamic := dynamicPeriod(m[1])
		if n <= 250 && !strings.HasSuffix(m[1], "_PREV") && previousOperand.FindStringSubmatch(m[1]) == nil && (staticOperand(m[1]) || dynamic) {
			return operandSpec{m[1], n, true}, true
		}
		return operandSpec{}, false
	}
	base, offset := name, 0
	if strings.HasSuffix(name, "_PREV") {
		base, offset = strings.TrimSuffix(name, "_PREV"), 1
	}
	_, _, dynamic := dynamicPeriod(base)
	if staticOperand(name) || dynamic {
		if base == "PREV_CLOSE" {
			base, offset = "CLOSE", 1
		}
		if base == "PREV_OPEN" {
			base, offset = "OPEN", 1
		}
		return operandSpec{base, offset, false}, true
	}
	return operandSpec{}, false
}

func IsIndicatorOperand(name string) bool { _, ok := parseOperand(name); return ok }

// RequiredOperands exposes names only, never the private rule's comparisons.
func RequiredOperands(rule RuleSnapshot) []string {
	set := map[string]bool{}
	for _, c := range rule.Conditions {
		if IsIndicatorOperand(c.Left) {
			set[c.Left] = true
		}
		if right, ok := c.Right.(string); ok && IsIndicatorOperand(right) {
			set[right] = true
		}
	}
	if len(set) == 0 {
		return nil
	}
	names := make([]string, 0, len(set))
	for name := range set {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

func OperandWarmup(name string) int {
	spec, ok := parseOperand(name)
	if !ok {
		return 0
	}
	base := spec.base
	warmup := 1
	if family, n, dynamic := dynamicPeriod(base); dynamic {
		warmup = n
		if family == "RSI" {
			warmup++
		}
		if family == "ADX" {
			warmup = 2 * n
		}
	} else {
		switch {
		case strings.HasPrefix(base, "MACD"):
			warmup = 35
		case strings.HasPrefix(base, "BB_") || base == "PRICE_EMA20_DIFF_PCT":
			warmup = 20
		case strings.HasPrefix(base, "STOCH_"):
			warmup = 17
		case strings.HasPrefix(base, "ICHIMOKU_"):
			warmup = 52
		case strings.HasPrefix(base, "PATTERN_"):
			warmup = 13
		case base == "PREV_CLOSE" || base == "PREV_OPEN":
			warmup = 2
		}
	}
	return warmup + spec.offset
}

func IndicatorWarmup(operands []string) int {
	warmup := 20
	for _, name := range operands {
		warmup = max(warmup, OperandWarmup(name))
	}
	return warmup
}

func validateOperands(operands []string) error {
	if len(operands) > MaxIndicatorOperands {
		return fmt.Errorf("at most %d indicator operands are allowed", MaxIndicatorOperands)
	}
	seen := map[string]bool{}
	for _, name := range operands {
		if !IsIndicatorOperand(name) || seen[name] {
			return fmt.Errorf("invalid or duplicate indicator operand %q", name)
		}
		seen[name] = true
	}
	return nil
}

func validIndicatorNumber(name string, value float64) bool {
	spec, ok := parseOperand(name)
	if !ok {
		return false
	}
	base := spec.base
	family, _, _ := dynamicPeriod(base)
	if family == "RSI" || family == "ADX" || strings.HasPrefix(base, "STOCH_") {
		return value >= 0 && value <= 100
	}
	if strings.HasPrefix(base, "PATTERN_") {
		return value == 0 || value == 1
	}
	if base == "VOLUME" || strings.HasPrefix(base, "SMA_VOLUME_") || strings.HasPrefix(base, "REL_VOLUME_") || base == "BB_WIDTH" || base == "PRICE_EMA20_DIFF_PCT" {
		return value >= 0
	}
	if base == "MACD" || base == "MACD_SIGNAL" || base == "MACD_HIST" || base == "BB_LOWER" {
		return true
	}
	return value > 0
}
