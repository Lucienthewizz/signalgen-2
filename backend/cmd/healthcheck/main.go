package main

import (
	"fmt"
	"net/http"
	"os"
	"time"
)

func main() {
	url := os.Getenv("SIGNALGEN_HEALTHCHECK_URL")
	if url == "" {
		url = "http://127.0.0.1:8080/ready"
	}
	client := &http.Client{Timeout: 2 * time.Second}
	response, err := client.Get(url)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		fmt.Fprintf(os.Stderr, "readiness returned %s\n", response.Status)
		os.Exit(1)
	}
}
