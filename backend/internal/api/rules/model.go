package rulesapi

type systemRuleResource struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	OwnerType      string `json:"owner_type"`
	ReadOnly       bool   `json:"read_only"`
	DefinitionHash string `json:"definition_hash"`
	SchemaVersion  string `json:"schema_version"`
	EngineVersion  string `json:"engine_version"`
	Version        int    `json:"version"`
}
