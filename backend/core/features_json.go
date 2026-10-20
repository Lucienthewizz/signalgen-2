package core

import (
	"bytes"
	"encoding/json"
	"fmt"
)

// UnmarshalJSON menjaga batas client/server: angka nol adalah nilai RSI yang sah,
// tetapi field hilang atau null berarti data tidak lengkap, bukan RSI bernilai 0.
// Pointer hanya dipakai saat decoding; perhitungan tetap memakai float64 biasa.
func (features *FeatureVector) UnmarshalJSON(raw []byte) error {
	var input struct {
		Price *float64 `json:"price"`
		EMA9  *float64 `json:"ema9"`
		EMA20 *float64 `json:"ema20"`
		RSI14 *float64 `json:"rsi14"`
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		return err
	}
	if input.Price == nil || input.EMA9 == nil || input.EMA20 == nil || input.RSI14 == nil {
		return fmt.Errorf("price, ema9, ema20 and rsi14 must all be non-null numbers")
	}
	*features = FeatureVector{Price: *input.Price, EMA9: *input.EMA9, EMA20: *input.EMA20, RSI14: *input.RSI14}
	return nil
}
