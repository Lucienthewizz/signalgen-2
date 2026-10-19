package core

// Condition merepresentasikan satu kondisi pembanding dalam aturan screening.
// Left: operand kiri (misalnya "PRICE", "EMA9", "EMA20", "RSI14").
// Op: operator pembanding (">", "<", ">=", "<=").
// Right: operand kanan atau nilai konstan numerik (misalnya "EMA20", 30, 100.5).
type Condition struct {
	Left  string      `json:"left"`
	Op    string      `json:"op"`
	Right interface{} `json:"right"`
}

// RuleSnapshot merepresentasikan konfigurasi aturan screening yang dibuat oleh pengguna.
// Name: nama deskriptif aturan (1-100 karakter).
// Logic: logika evaluasi kondisi ("AND" = semua kondisi harus cocok; "OR" = salah satu cocok).
// SignalType: jenis sinyal yang dibangkitkan ("BUY").
// CooldownSec: jeda waktu (detik) minimum antar sinyal per saham (0 s.d. 86400).
// Conditions: daftar kondisi pembanding (1 hingga 20 kondisi).
type RuleSnapshot struct {
	Name        string      `json:"name"`
	Logic       string      `json:"logic"`
	SignalType  string      `json:"signal_type"`
	CooldownSec int64       `json:"cooldown_sec"`
	Conditions  []Condition `json:"conditions"`
}

// BaselineRuleDefinition merepresentasikan definisi aturan bawaan sistem yang dibekukan untuk baseline M0.
type BaselineRuleDefinition struct {
	ID          int         `json:"id"`
	Name        string      `json:"name"`
	Type        string      `json:"type"`
	Logic       string      `json:"logic"`
	SignalType  string      `json:"signal_type"`
	CooldownSec int64       `json:"cooldown_sec"`
	Conditions  []Condition `json:"conditions"`
}

// RunRequest adalah payload permintaan untuk eksekusi sinyal lengkap portable (termasuk candle mentah).
type RunRequest struct {
	Purpose string       `json:"purpose"`
	Symbol  string       `json:"symbol"`
	Candles []Candle     `json:"candles"`
	Rule    RuleSnapshot `json:"rule"`
}

// DecisionRequest adalah permintaan evaluasi keputusan privat di sisi server.
// Aturan screening tetap tersimpan aman di server, sementara client/WASM hanya
// mengirimkan kandidat fitur ringkas (FeatureCandidate).
type DecisionRequest struct {
	Rule       RuleSnapshot       `json:"-"`
	Candidates []FeatureCandidate `json:"candidates"`
}

// CandidateEvaluation mencatat rincian evaluasi keputusan untuk setiap candle kandidat.
// Matched: bernilai true jika kondisi terpenuhi DAN tidak terhalang cooldown.
// ReasonCodes: alasan evaluasi ("RULE_MATCHED", "COOLDOWN_ACTIVE", atau "CONDITIONS_NOT_MET").
type CandidateEvaluation struct {
	Symbol      string   `json:"symbol"`
	Timestamp   string   `json:"timestamp"`
	Matched     bool     `json:"matched"`
	ReasonCodes []string `json:"reason_codes"`
}

// DecisionResult memuat hasil evaluasi keputusan dari server privat.
// Signals: daftar sinyal yang lolos aturan dan cooldown.
// CandidateCount: total kandidat yang dievaluasi.
// Evaluations: rincian status evaluasi per kandidat untuk feedback transparan ke pengguna.
type DecisionResult struct {
	DecisionVersion string                `json:"decision_version"`
	Signals         []Signal              `json:"signals"`
	CandidateCount  int                   `json:"candidate_count"`
	Evaluations     []CandidateEvaluation `json:"evaluations,omitempty"`
}

// Signal merepresentasikan sinyal perdagangan yang berhasil dibangkitkan.
type Signal struct {
	Symbol     string          `json:"symbol"`
	Timestamp  string          `json:"timestamp"`
	SignalType string          `json:"signal_type"`
	Price      float64         `json:"price"`
	Indicators IndicatorValues `json:"indicators"`
}

// RunResult adalah output eksekusi sinyal lengkap portable.
type RunResult struct {
	EngineVersion string   `json:"engine_version"`
	SchemaVersion string   `json:"schema_version"`
	Execution     string   `json:"execution"`
	Signals       []Signal `json:"signals"`
	CandleCount   int      `json:"candle_count"`
	Warnings      []string `json:"warnings"`
}
