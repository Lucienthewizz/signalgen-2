package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestImportDryRunNeverReadsCredentials(t *testing.T) {
	path := filepath.Join(t.TempDir(), "catalog.csv")
	if err := os.WriteFile(path, []byte("kode_idx,nama_perusahaan,tanggal_pencatatan\nASII,Astra,1990-04-04\n"), 0600); err != nil {
		t.Fatal(err)
	}
	var out, errOut bytes.Buffer
	if code := run([]string{"-catalog", path}, func(string) string { t.Fatal("dry-run read credentials"); return "" }, &out, &errOut); code != 0 || !strings.Contains(out.String(), "Validated 1") {
		t.Fatalf("code=%d output=%s error=%s", code, out.String(), errOut.String())
	}
	if code := run([]string{"-catalog", path, "-apply"}, func(key string) string {
		if key != "SUPABASE_ADMIN_DB_URL" {
			t.Fatal("runtime credential fallback")
		}
		return ""
	}, &out, &errOut); code != 2 {
		t.Fatalf("missing admin configuration code=%d", code)
	}
}
