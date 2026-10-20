package screener

import (
	"fmt"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

// DatasetScope menentukan batas cakupan dataset yang diizinkan untuk sesi screening.
// Diambil dari manifes dataset milik pengguna di sisi server.
// Fitur yang dikirim oleh client dibatasi hanya pada daftar simbol dan rentang tanggal historis ini.
type DatasetScope struct {
	TimestampFrom string
	TimestampTo   string
	Symbols       []string
	From          string
	To            string
}

// EvaluateBatch menjalankan evaluasi core screening secara terpisah untuk setiap simbol/saham.
// Hal ini sangat penting agar status jeda waktu (cooldown) tidak bocor dari satu saham ke saham lain.
// Setiap saham memiliki pelacakan sinyal dan waktu jedanya masing-masing.
func EvaluateBatch(rule core.RuleSnapshot, candidates []core.FeatureCandidate, scope DatasetScope) (core.DecisionResult, error) {
	// 1. Validasi cakupan batch: jumlah simbol, keberadaan kandidat, dan batas maksimum kandidat
	if len(scope.Symbols) < 1 || len(scope.Symbols) > universe.MaxSymbols || len(candidates) == 0 || len(candidates) > MaxCandidates {
		return core.DecisionResult{}, fmt.Errorf("invalid screening batch scope")
	}

	// 2. Parsing dan validasi rentang tanggal dataset (From dan To)
	from, fromErr := time.Parse("2006-01-02", scope.From)
	to, toErr := time.Parse("2006-01-02", scope.To)
	if fromErr != nil || toErr != nil || to.Before(from) {
		return core.DecisionResult{}, fmt.Errorf("invalid dataset interval")
	}
	end := to.AddDate(0, 0, 1) // Batas akhir inklusif hingga akhir hari tanggal To
	if scope.TimestampFrom != "" || scope.TimestampTo != "" {
		from, fromErr = time.Parse(time.RFC3339, scope.TimestampFrom)
		to, toErr = time.Parse(time.RFC3339, scope.TimestampTo)
		if fromErr != nil || toErr != nil || to.Before(from) {
			return core.DecisionResult{}, fmt.Errorf("invalid dataset timestamps")
		}
		end = to.Add(time.Nanosecond)
	}

	// 3. Inisialisasi wadah pengelompokan kandidat per simbol emiten
	groups := make(map[string][]core.FeatureCandidate, len(scope.Symbols))
	for _, symbol := range scope.Symbols {
		if symbol == "" {
			return core.DecisionResult{}, fmt.Errorf("invalid dataset symbol")
		}
		if _, exists := groups[symbol]; exists {
			return core.DecisionResult{}, fmt.Errorf("duplicate dataset symbol")
		}
		groups[symbol] = nil
	}

	// 4. Kelompokkan setiap kandidat ke dalam simbol yang sesuai dan pastikan berada dalam rentang tanggal yang sah
	for _, candidate := range candidates {
		group, allowed := groups[candidate.Symbol]
		stamp, err := time.Parse(time.RFC3339, candidate.Timestamp)
		if !allowed || err != nil || stamp.Before(from) || !stamp.Before(end) {
			return core.DecisionResult{}, fmt.Errorf("candidate is outside the authorized dataset scope")
		}
		groups[candidate.Symbol] = append(group, candidate)
	}

	// 5. Eksekusi evaluasi keputusan secara terisolasi per simbol saham
	result := core.DecisionResult{
		DecisionVersion: core.DecisionVersion,
		CandidateCount:  len(candidates),
		Signals:         []core.Signal{},
		Evaluations:     []core.CandidateEvaluation{},
	}
	for _, symbol := range scope.Symbols {
		if len(groups[symbol]) == 0 {
			continue
		}
		// Jalankan evaluasi keputusan core engine untuk kelompok saham ini
		decision, err := core.EvaluateDecision(core.DecisionRequest{Rule: rule, Candidates: groups[symbol]})
		if err != nil {
			return core.DecisionResult{}, err
		}
		// Agregasikan sinyal dan rincian evaluasi kandidat ke hasil akhir
		result.Signals = append(result.Signals, decision.Signals...)
		result.Evaluations = append(result.Evaluations, decision.Evaluations...)
	}
	return result, nil
}
