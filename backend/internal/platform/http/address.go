package http

import (
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
)

// ListenAddress keeps explicit local configuration ahead of Railway's PORT.
func ListenAddress(explicit, port string) (string, error) {
	if explicit = strings.TrimSpace(explicit); explicit != "" {
		_, rawPort, err := net.SplitHostPort(explicit)
		number, numberErr := strconv.Atoi(rawPort)
		if err != nil || numberErr != nil || number < 1 || number > 65535 {
			return "", fmt.Errorf("invalid SIGNALGEN_GO_API_ADDR")
		}
		return explicit, nil
	}
	if port = strings.TrimSpace(port); port == "" {
		port = "8080"
	}
	number, err := strconv.Atoi(port)
	if err != nil || number < 1 || number > 65535 {
		return "", fmt.Errorf("PORT must be 1..65535")
	}
	return ":" + port, nil
}

// ReadinessURL targets the same listener without treating a wildcard as a host.
func ReadinessURL(override, explicitAddress, port string) (string, error) {
	if override != "" {
		return override, nil
	}
	address, err := ListenAddress(explicitAddress, port)
	if err != nil {
		return "", err
	}
	host, port, _ := net.SplitHostPort(address)
	if host == "" || host == "0.0.0.0" {
		host = "127.0.0.1"
	}
	if host == "::" {
		host = "::1"
	}
	return (&url.URL{Scheme: "http", Host: net.JoinHostPort(host, port), Path: "/ready"}).String(), nil
}
