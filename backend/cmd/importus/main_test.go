package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestUSImportDryRunDoesNotReadCredentialsAndReportNeverOverwrites(t *testing.T) {
	dir := t.TempDir()
	nasdaq, nyse, report := filepath.Join(dir, "nasdaqlisted.txt"), filepath.Join(dir, "otherlisted.txt"), filepath.Join(dir, "report.json")
	for path, data := range map[string]string{
		nasdaq: "Symbol|Security Name|ETF|Test Issue\nAAPL|Apple - Common Stock|N|N\nFile Creation Time: 1016202621:31|||\n",
		nyse:   "ACT Symbol|Security Name|Exchange|ETF|Test Issue\nBRK.B|Berkshire Common Stock|N|N|N\nFile Creation Time: 1016202621:31||||\n",
	} {
		if err := os.WriteFile(path, []byte(data), 0600); err != nil {
			t.Fatal(err)
		}
	}
	args := []string{"-nasdaq", nasdaq, "-nyse", nyse}
	var out, errOut bytes.Buffer
	noCredentials := func(string) string { t.Fatal("dry-run read credentials"); return "" }
	if code := run(append(append([]string{}, args...), "-report", report), noCredentials, &out, &errOut); code != 0 || !strings.Contains(out.String(), "Validated 2") || !strings.Contains(out.String(), "limit: 10") {
		t.Fatalf("code=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	before, _ := os.ReadFile(report)
	if code := run(append(append([]string{}, args...), "-report", report), noCredentials, &out, &errOut); code != 1 {
		t.Fatal("existing report overwritten")
	}
	after, _ := os.ReadFile(report)
	if !bytes.Equal(before, after) {
		t.Fatal("report modified")
	}
	if code := run(append(args, "-apply"), func(key string) string {
		if key != "SUPABASE_ADMIN_DB_URL" {
			t.Fatal("runtime fallback")
		}
		return ""
	}, &out, &errOut); code != 2 {
		t.Fatal("missing admin credentials not rejected")
	}
}
