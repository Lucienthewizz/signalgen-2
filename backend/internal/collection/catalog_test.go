package collection

import (
	"archive/zip"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCatalogCSVProvenanceDatesAndDuplicates(t *testing.T) {
	path := filepath.Join(t.TempDir(), "catalog.csv")
	data := "Kode,Nama Perusahaan,Tanggal Pencatatan\nTLKM,Telkom,14 Nov 1995\nBBCA,BCA,31 Mei 2000\n"
	if err := os.WriteFile(path, []byte(data), 0600); err != nil {
		t.Fatal(err)
	}
	catalog, err := ReadCatalog(path, "https://www.idx.co.id/", time.Date(2026, 10, 14, 0, 0, 0, 0, time.UTC))
	if err != nil || len(catalog.Items) != 2 || catalog.Items[0].Code != "BBCA" || catalog.Items[0].ListingDate != "2000-05-31" || catalog.Items[0].ProviderSymbol != "BBCA.JK" || len(catalog.SourceSHA256) != 64 {
		t.Fatalf("catalog=%+v err=%v", catalog, err)
	}
	for _, row := range []string{"BBCA,Duplicate,31 Mei 2000", "../bad,Invalid,31 Mei 2000", "ABCD,Future,01 Jan 2099", "ABCD,Invalid,not-date"} {
		_ = os.WriteFile(path, []byte(data+row+"\n"), 0600)
		if _, err := ReadCatalog(path, "https://www.idx.co.id/", time.Now()); err == nil {
			t.Fatalf("accepted %s", row)
		}
	}
}

func TestCatalogXLSXPlainExportAndFormulaRejection(t *testing.T) {
	for _, formula := range []bool{false, true} {
		path := filepath.Join(t.TempDir(), "export.xlsx")
		file, err := os.Create(path)
		if err != nil {
			t.Fatal(err)
		}
		archive := zip.NewWriter(file)
		writer, _ := archive.Create("xl/worksheets/sheet1.xml")
		xml := `<worksheet><sheetData><row><c r="A1" t="str"><v>Kode</v></c><c r="B1" t="str"><v>Nama Perusahaan</v></c><c r="C1" t="str"><v>Tanggal Pencatatan</v></c></row><row><c r="A2" t="str"><v>BBCA</v></c><c r="B2" t="inlineStr"><is><t>BCA</t></is></c><c r="C2" t="str"><v>31 Mei 2000</v></c></row></sheetData></worksheet>`
		if formula {
			xml = strings.Replace(xml, "<v>BBCA</v>", "<f>UNTRUSTED()</f><v>BBCA</v>", 1)
		}
		_, _ = writer.Write([]byte(xml))
		_ = archive.Close()
		_ = file.Close()
		catalog, err := ReadCatalog(path, "https://www.idx.co.id/", time.Now())
		if formula && err == nil {
			t.Fatal("formula accepted")
		}
		if !formula && (err != nil || len(catalog.Items) != 1 || catalog.Items[0].Name != "BCA") {
			t.Fatalf("catalog=%+v err=%v", catalog, err)
		}
	}
}
