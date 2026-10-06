package main

import "testing"

func TestValidateTestDatabaseURL(t *testing.T) {
	tests := []struct {
		name    string
		url     string
		wantErr bool
	}{
		{name: "IPv4 loopback", url: "postgres://postgres:test@127.0.0.1:5432/signalgen_test?sslmode=disable"},
		{name: "localhost", url: "postgresql://postgres:test@localhost/signalgen_test"},
		{name: "missing", wantErr: true},
		{name: "remote Supabase", url: "postgres://postgres:test@db.example.supabase.co/signalgen_test", wantErr: true},
		{name: "host override", url: "postgres://postgres:test@127.0.0.1/signalgen_test?host=db.example.supabase.co", wantErr: true},
		{name: "wrong database", url: "postgres://postgres:test@127.0.0.1/postgres", wantErr: true},
		{name: "wrong scheme", url: "https://127.0.0.1/signalgen_test", wantErr: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateTestDatabaseURL(test.url)
			if (err != nil) != test.wantErr {
				t.Fatalf("validateTestDatabaseURL() error = %v, wantErr = %v", err, test.wantErr)
			}
		})
	}
}
