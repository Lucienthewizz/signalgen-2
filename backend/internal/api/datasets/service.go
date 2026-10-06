package datasetsapi

import "github.com/Lucienthewizz/signalgen-2/backend/internal/dataset"

// datasetService wires existing contracts; access policy lives in the domain.
func (server *Handler) datasetService() dataset.AccessService {
	return dataset.AccessService{Repository: server.Datasets, Features: server.Access, Rules: server.Rules}
}
