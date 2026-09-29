// Command importlegacy archives an old SQLite database without assigning
// ownerless desktop data to a web user's account.
package main

import (
	"bufio"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	_ "modernc.org/sqlite"

	platformdb "github.com/Lucienthewizz/signalgen-2/backend/internal/platform/database"
)

type archiveTable struct {
	name      string
	createSQL string
	rows      [][]any
}

func main() {
	var sqlitePath, label, envFile, expectedProjectRef string
	var apply bool
	flag.StringVar(&sqlitePath, "sqlite", "", "path to a consistent SQLite snapshot")
	flag.StringVar(&label, "label", "", "human-readable source label")
	flag.StringVar(&envFile, "env-file", ".env", "backend env file; only SUPABASE_DB_URL is read")
	flag.StringVar(&expectedProjectRef, "expected-project-ref", "", "refuse a database URL for another Supabase project")
	flag.BoolVar(&apply, "apply", false, "write the archive to Postgres (default: inspect only)")
	flag.Parse()
	if sqlitePath == "" || label == "" {
		fmt.Fprintln(os.Stderr, "--sqlite and --label are required")
		os.Exit(2)
	}
	if err := run(sqlitePath, label, envFile, expectedProjectRef, apply); err != nil {
		fmt.Fprintln(os.Stderr, "importlegacy:", err)
		os.Exit(1)
	}
}

func run(path, label, envFile, expectedProjectRef string, apply bool) error {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	path, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	sourceHash, sourceBytes, err := hashFile(path)
	if err != nil {
		return err
	}
	tables, totalRows, err := readSQLite(ctx, path)
	if err != nil {
		return err
	}
	fmt.Printf("Source %s: %d user tables, %d rows, %d bytes, SHA-256 %s\n",
		label, len(tables), totalRows, sourceBytes, sourceHash)
	for _, table := range tables {
		fmt.Printf("  %s: %d rows\n", table.name, len(table.rows))
	}
	if !apply {
		fmt.Println("Dry run only; add --apply to archive this source.")
		return nil
	}

	databaseURL := os.Getenv("SUPABASE_DB_URL")
	if databaseURL == "" {
		databaseURL, err = databaseURLFromFile(envFile)
		if err != nil {
			return err
		}
	}
	if expectedProjectRef != "" {
		parsed, err := url.Parse(databaseURL)
		if err != nil || parsed.User == nil ||
			(!strings.Contains(parsed.Hostname(), expectedProjectRef) &&
				!strings.HasSuffix(parsed.User.Username(), "."+expectedProjectRef)) {
			return fmt.Errorf("database URL does not match expected Supabase project ref")
		}
	}
	pool, err := platformdb.OpenPostgres(ctx, databaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin archive transaction: %w", err)
	}
	defer tx.Rollback(context.Background())

	var existing string
	err = tx.QueryRow(ctx, `select source_sha256 from legacy.sqlite_sources where source_sha256 = $1`, sourceHash).Scan(&existing)
	if err == nil {
		fmt.Println("This exact SQLite snapshot is already archived; no rows changed.")
		return nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("check archive source: %w", err)
	}
	_, err = tx.Exec(ctx, `insert into legacy.sqlite_sources
		(source_sha256, source_label, source_bytes, table_count, row_count)
		values ($1, $2, $3, $4, $5)`, sourceHash, label, sourceBytes, len(tables), totalRows)
	if err != nil {
		return fmt.Errorf("insert archive source: %w", err)
	}
	for _, table := range tables {
		_, err = tx.Exec(ctx, `insert into legacy.sqlite_tables
			(source_sha256, table_name, create_sql, row_count)
			values ($1, $2, $3, $4)`, sourceHash, table.name, table.createSQL, len(table.rows))
		if err != nil {
			return fmt.Errorf("archive table %s: %w", table.name, err)
		}
		if len(table.rows) == 0 {
			continue
		}
		copyRows := make([][]any, 0, len(table.rows))
		for i, row := range table.rows {
			copyRows = append(copyRows, []any{sourceHash, table.name, i + 1, row[0], row[1]})
		}
		copied, err := tx.CopyFrom(ctx, pgx.Identifier{"legacy", "sqlite_rows"},
			[]string{"source_sha256", "table_name", "ordinal", "sqlite_rowid", "payload"},
			pgx.CopyFromRows(copyRows))
		if err != nil {
			return fmt.Errorf("archive rows from %s: %w", table.name, err)
		}
		if copied != int64(len(table.rows)) {
			return fmt.Errorf("archive count mismatch for %s: got %d, expected %d", table.name, copied, len(table.rows))
		}
	}
	var archivedRows int64
	if err := tx.QueryRow(ctx, `select count(*) from legacy.sqlite_rows where source_sha256 = $1`, sourceHash).Scan(&archivedRows); err != nil {
		return err
	}
	if archivedRows != totalRows {
		return fmt.Errorf("archive verification failed: got %d rows, expected %d", archivedRows, totalRows)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit archive: %w", err)
	}
	fmt.Printf("Archived and verified %d rows. Active signalgen tables were not changed.\n", archivedRows)
	return nil
}

func hashFile(path string) (string, int64, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", 0, err
	}
	defer file.Close()
	hash := sha256.New()
	n, err := io.Copy(hash, file)
	if err != nil {
		return "", 0, err
	}
	return hex.EncodeToString(hash.Sum(nil)), n, nil
}

func readSQLite(ctx context.Context, path string) ([]archiveTable, int64, error) {
	db, err := sql.Open("sqlite", "file:"+path+"?mode=ro")
	if err != nil {
		return nil, 0, err
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	var integrity string
	if err := db.QueryRowContext(ctx, "pragma integrity_check").Scan(&integrity); err != nil {
		return nil, 0, fmt.Errorf("SQLite integrity check: %w", err)
	}
	if integrity != "ok" {
		return nil, 0, fmt.Errorf("SQLite integrity check failed")
	}
	metadata, err := db.QueryContext(ctx, `select name, sql from sqlite_master
		where type = 'table' and name not like 'sqlite_%' order by name`)
	if err != nil {
		return nil, 0, err
	}
	var tables []archiveTable
	for metadata.Next() {
		var table archiveTable
		if err := metadata.Scan(&table.name, &table.createSQL); err != nil {
			metadata.Close()
			return nil, 0, err
		}
		tables = append(tables, table)
	}
	if err := metadata.Err(); err != nil {
		metadata.Close()
		return nil, 0, err
	}
	metadata.Close()

	var total int64
	for i := range tables {
		quotedName := `"` + strings.ReplaceAll(tables[i].name, `"`, `""`) + `"`
		query := "select rowid, * from " + quotedName + " order by rowid"
		if strings.Contains(strings.ToUpper(tables[i].createSQL), "WITHOUT ROWID") {
			query = "select * from " + quotedName
		}
		rows, err := db.QueryContext(ctx, query)
		if err != nil {
			return nil, 0, fmt.Errorf("read table %s: %w", tables[i].name, err)
		}
		columns, err := rows.Columns()
		if err != nil {
			rows.Close()
			return nil, 0, err
		}
		hasRowID := len(columns) > 0 && columns[0] == "rowid"
		for rows.Next() {
			values := make([]any, len(columns))
			dest := make([]any, len(columns))
			for j := range values {
				dest[j] = &values[j]
			}
			if err := rows.Scan(dest...); err != nil {
				rows.Close()
				return nil, 0, err
			}
			var rowID any
			start := 0
			if hasRowID {
				rowID = values[0]
				start = 1
			}
			payload := make(map[string]any, len(columns)-start)
			for j := start; j < len(columns); j++ {
				payload[columns[j]] = archiveValue(values[j])
			}
			encoded, err := json.Marshal(payload)
			if err != nil {
				rows.Close()
				return nil, 0, err
			}
			tables[i].rows = append(tables[i].rows, []any{rowID, string(encoded)})
			total++
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, 0, err
		}
		rows.Close()
	}
	return tables, total, nil
}

func archiveValue(value any) any {
	if bytes, ok := value.([]byte); ok {
		return map[string]string{"__sqlite_blob_base64": base64.StdEncoding.EncodeToString(bytes)}
	}
	return value
}

func databaseURLFromFile(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("open env file: %w", err)
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		line = strings.TrimPrefix(line, "export ")
		key, value, found := strings.Cut(line, "=")
		if !found || strings.TrimSpace(key) != "SUPABASE_DB_URL" {
			continue
		}
		value = strings.TrimSpace(value)
		if len(value) >= 2 && ((value[0] == '"' && value[len(value)-1] == '"') ||
			(value[0] == '\'' && value[len(value)-1] == '\'')) {
			value = value[1 : len(value)-1]
		}
		if value == "" {
			break
		}
		return value, nil
	}
	if err := scanner.Err(); err != nil {
		return "", err
	}
	return "", fmt.Errorf("SUPABASE_DB_URL is missing from the environment and env file")
}
