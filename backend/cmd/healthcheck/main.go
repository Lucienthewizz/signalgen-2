package main

import (
	"fmt"
	"net/http"
	"os"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/platform/healthcheck"
	platformhttp "github.com/Lucienthewizz/signalgen-2/backend/internal/platform/http"
)

func main() {
	url, err := platformhttp.ReadinessURL(os.Getenv("SIGNALGEN_HEALTHCHECK_URL"), os.Getenv("SIGNALGEN_GO_API_ADDR"), os.Getenv("PORT"))
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	client := &http.Client{Timeout: healthcheck.ProbeTimeout}
	if err := check(client, url); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

// check reports the actual readiness result; a live process is not enough.
func check(client *http.Client, url string) error {
	response, err := client.Get(url)
	if err != nil {
		return fmt.Errorf("readiness request failed: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("readiness returned %s", response.Status)
	}
	return nil
}
