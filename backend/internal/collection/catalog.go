// Package collection owns offline data acquisition, not live screener requests.
package collection

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"encoding/xml"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

type Instrument struct {
	Code           string `json:"code"`
	Name           string `json:"name"`
	ListingDate    string `json:"listing_date"`
	ProviderSymbol string `json:"provider_symbol"`
}

type Catalog struct {
	SourceURL    string       `json:"source_url"`
	RetrievedAt  string       `json:"retrieved_at"`
	SourceSHA256 string       `json:"source_sha256"`
	Items        []Instrument `json:"items"`
}

var stockCode = regexp.MustCompile(`^[A-Z]{4}$`)

// ReadCatalog preserves source provenance and rejects duplicate/invalid codes.
// Only the first worksheet of the plain IDX export is supported; formulas and
// unexpected formats fail closed rather than silently inventing source values.
func ReadCatalog(path, sourceURL string, now time.Time) (Catalog, error) {
	info, err := os.Stat(path)
	if err != nil {
		return Catalog{}, err
	}
	if !info.Mode().IsRegular() || info.Size() > 16<<20 {
		return Catalog{}, fmt.Errorf("catalog must be a regular file smaller than 16 MiB")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return Catalog{}, err
	}
	var rows [][]string
	switch strings.ToLower(filepath.Ext(path)) {
	case ".csv":
		reader := csv.NewReader(bytes.NewReader(bytes.TrimPrefix(raw, []byte{0xef, 0xbb, 0xbf})))
		reader.FieldsPerRecord = -1
		rows, err = reader.ReadAll()
	case ".xlsx":
		rows, err = readXLSX(raw)
	default:
		return Catalog{}, fmt.Errorf("catalog must be the IDX .xlsx export or UTF-8 comma-separated CSV")
	}
	if err != nil {
		return Catalog{}, err
	}
	if len(rows) < 2 || len(rows) > 12001 {
		return Catalog{}, fmt.Errorf("catalog must contain 1..12000 data rows")
	}
	columns := map[string]int{}
	for i, header := range rows[0] {
		columns[strings.ToLower(strings.TrimSpace(header))] = i
	}
	find := func(names ...string) int {
		for _, name := range names {
			if index, ok := columns[name]; ok {
				return index
			}
		}
		return -1
	}
	codeCol, nameCol, dateCol := find("kode", "kode_idx", "code"), find("nama perusahaan", "nama_perusahaan", "name"), find("tanggal pencatatan", "tanggal_pencatatan", "listing_date")
	if codeCol < 0 || nameCol < 0 || dateCol < 0 {
		return Catalog{}, fmt.Errorf("missing code/name/listing date catalog headers")
	}
	items := make([]Instrument, 0, len(rows)-1)
	seen := map[string]bool{}
	for i, row := range rows[1:] {
		value := func(column int) string {
			if column >= len(row) {
				return ""
			}
			return strings.TrimSpace(row[column])
		}
		code, name, date := value(codeCol), value(nameCol), value(dateCol)
		if code == "" && name == "" && date == "" {
			continue
		}
		if !stockCode.MatchString(code) || seen[code] || name == "" || len(name) > 300 {
			return Catalog{}, fmt.Errorf("invalid or duplicate catalog entry at row %d", i+2)
		}
		var stamp time.Time
		date = strings.NewReplacer("Mei", "May", "Agt", "Aug", "Agu", "Aug", "Okt", "Oct", "Des", "Dec").Replace(date)
		for _, layout := range []string{"2006-01-02", "02 Jan 2006", "2 Jan 2006"} {
			stamp, err = time.Parse(layout, date)
			if err == nil {
				break
			}
		}
		if err != nil || stamp.After(now) {
			return Catalog{}, fmt.Errorf("invalid listing date at row %d", i+2)
		}
		seen[code] = true
		items = append(items, Instrument{Code: code, Name: name, ListingDate: stamp.Format("2006-01-02"), ProviderSymbol: code + ".JK"})
	}
	if len(items) == 0 {
		return Catalog{}, fmt.Errorf("empty catalog")
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Code < items[j].Code })
	hash := sha256.Sum256(raw)
	return Catalog{SourceURL: sourceURL, RetrievedAt: now.UTC().Format(time.RFC3339), SourceSHA256: hex.EncodeToString(hash[:]), Items: items}, nil
}

type xmlCell struct {
	Reference string  `xml:"r,attr"`
	Type      string  `xml:"t,attr"`
	Value     string  `xml:"v"`
	Formula   *string `xml:"f"`
	Inline    struct {
		Text string `xml:"t"`
	} `xml:"is"`
}

// readXLSX reads bounded XML entries directly; it never extracts archive paths.
func readXLSX(raw []byte) ([][]string, error) {
	archive, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		return nil, err
	}
	read := func(name string) ([]byte, error) {
		for _, file := range archive.File {
			if file.Name == name {
				if file.UncompressedSize64 > 8<<20 {
					return nil, fmt.Errorf("catalog XML exceeds 8 MiB")
				}
				reader, err := file.Open()
				if err != nil {
					return nil, err
				}
				defer reader.Close()
				return io.ReadAll(io.LimitReader(reader, (8<<20)+1))
			}
		}
		return nil, os.ErrNotExist
	}
	var shared []string
	if data, err := read("xl/sharedStrings.xml"); err == nil {
		var table struct {
			Items []struct {
				Text string `xml:"t"`
				Runs []struct {
					Text string `xml:"t"`
				} `xml:"r"`
			} `xml:"si"`
		}
		if err := xml.Unmarshal(data, &table); err != nil {
			return nil, err
		}
		for _, item := range table.Items {
			text := item.Text
			for _, run := range item.Runs {
				text += run.Text
			}
			shared = append(shared, text)
		}
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	data, err := read("xl/worksheets/sheet1.xml")
	if err != nil {
		return nil, err
	}
	var sheet struct {
		Rows []struct {
			Cells []xmlCell `xml:"c"`
		} `xml:"sheetData>row"`
	}
	if err := xml.Unmarshal(data, &sheet); err != nil {
		return nil, err
	}
	if len(sheet.Rows) > 12001 {
		return nil, fmt.Errorf("too many catalog rows")
	}
	rows := make([][]string, 0, len(sheet.Rows))
	for _, row := range sheet.Rows {
		values := make([]string, 32)
		for _, cell := range row.Cells {
			column := 0
			for _, c := range cell.Reference {
				if c < 'A' || c > 'Z' {
					break
				}
				column = column*26 + int(c-'A'+1)
			}
			if column < 1 || column > len(values) || cell.Formula != nil {
				return nil, fmt.Errorf("unsupported cell/formula in catalog")
			}
			value := cell.Value
			if cell.Type == "s" {
				index, err := strconv.Atoi(value)
				if err != nil || index < 0 || index >= len(shared) {
					return nil, fmt.Errorf("invalid shared string")
				}
				value = shared[index]
			}
			if cell.Type == "inlineStr" {
				value = cell.Inline.Text
			}
			values[column-1] = value
		}
		rows = append(rows, values)
	}
	return rows, nil
}
