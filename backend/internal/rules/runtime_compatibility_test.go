package rules

import (
	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"testing"
)

func TestPreviousRuleLanguageRemainsExecutableWithoutDatabaseRewrite(t *testing.T) {
	definition := core.RuleSnapshot{Name: "Existing rule", Logic: "AND", SignalType: "BUY", Conditions: []core.Condition{{Left: "RSI14", Op: "<", Right: 30.0}}}
	item := Rule{ID: "private-rule", OwnerUserID: "owner", Definition: definition, DefinitionHash: "original-hash", Version: 7, SchemaVersion: core.SchemaVersion, EngineVersion: "core-0.3.0"}
	upgraded := compatibleRuntimeRule(item)
	if upgraded.EngineVersion != core.EngineVersion || upgraded.DefinitionHash != item.DefinitionHash || upgraded.Version != 7 || item.EngineVersion != "core-0.3.0" {
		t.Fatalf("invalid runtime projection: %+v", upgraded)
	}
	item.SchemaVersion = "future-schema"
	if compatibleRuntimeRule(item).EngineVersion != item.EngineVersion {
		t.Fatal("unsupported schema was silently promoted")
	}
}
