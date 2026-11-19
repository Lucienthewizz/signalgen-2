package http

import "testing"

func TestDeploymentAddressAndProbe(t *testing.T) {
	for _, tc := range []struct{ explicit, port, address, probe string }{
		{"", "", ":8080", "http://127.0.0.1:8080/ready"},
		{"", "4321", ":4321", "http://127.0.0.1:4321/ready"},
		{"127.0.0.1:9090", "4321", "127.0.0.1:9090", "http://127.0.0.1:9090/ready"},
		{"[::]:9090", "", "[::]:9090", "http://[::1]:9090/ready"},
	} {
		address, err := ListenAddress(tc.explicit, tc.port)
		if err != nil || address != tc.address {
			t.Fatalf("address %q %v", address, err)
		}
		probe, err := ReadinessURL("", tc.explicit, tc.port)
		if err != nil || probe != tc.probe {
			t.Fatalf("probe %q %v", probe, err)
		}
	}
	for _, port := range []string{"0", "65536", "bad"} {
		if _, err := ListenAddress("", port); err == nil {
			t.Fatal("invalid port accepted", port)
		}
	}
	if _, err := ListenAddress("missing-port", ""); err == nil {
		t.Fatal("invalid listener accepted")
	}
	for _, address := range []string{":0", ":65536", ":bad"} {
		if _, err := ListenAddress(address, ""); err == nil {
			t.Fatal("invalid explicit listener accepted", address)
		}
	}
	if value, _ := ReadinessURL("http://localhost:123/ready", "", ""); value != "http://localhost:123/ready" {
		t.Fatal(value)
	}
}
