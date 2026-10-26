package healthcheck

import (
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"testing"
	"time"
)

func TestReadinessTimeoutOrderingAndDockerBudget(t *testing.T) {
	if ReadinessTimeout <= 2*time.Second || ReadinessTimeout >= ProbeTimeout || ProbeTimeout >= 10*time.Second {
		t.Fatal("expected handler < probe < 10s API deadline")
	}
	// Docker is outside Go: guard against accidentally restoring its old 3s
	// kill timeout while the handler/probe still allow a longer cold connection.
	_, source, _, _ := runtime.Caller(0)
	dockerfile, err := os.ReadFile(filepath.Join(filepath.Dir(source), "../../../Go.Dockerfile"))
	if err != nil {
		t.Fatal(err)
	}
	match := regexp.MustCompile(`(?m)^HEALTHCHECK .*--timeout=([^ ]+) .*CMD \["signalgen-healthcheck"\]$`).FindSubmatch(dockerfile)
	if len(match) != 2 {
		t.Fatal("cannot find the API Docker healthcheck timeout")
	}
	budget, err := time.ParseDuration(string(match[1]))
	if err != nil || budget <= ProbeTimeout {
		t.Fatal("Docker must allow the probe to finish")
	}
}
