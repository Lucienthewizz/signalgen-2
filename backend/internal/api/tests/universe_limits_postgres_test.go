package apitests

import (
	"context"
	"errors"
	"fmt"
	"os"
	"reflect"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Opt-in, disposable loopback DB only; never reads production credentials.
func TestPostgresUniverseThreeTenAndEleven(t *testing.T) {
	raw := os.Getenv("SIGNALGEN_TEST_PG_URL")
	if raw == "" {
		t.Skip("requires isolated signalgen_test database")
	}
	config, err := pgxpool.ParseConfig(raw)
	if err != nil || config.ConnConfig.Host != "127.0.0.1" || config.ConnConfig.Database != "signalgen_test" || len(config.ConnConfig.Fallbacks) != 0 {
		t.Fatal("refusing anything except isolated loopback signalgen_test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	admin, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	var owner, other string
	for _, id := range []*string{&owner, &other} {
		if err := admin.QueryRow(ctx, `insert into auth.users(email) values('ten-stock@test.invalid') returning id::text`).Scan(id); err != nil {
			t.Fatal(err)
		}
		defer admin.Exec(context.Background(), `delete from auth.users where id=$1::uuid`, *id)
		if _, err := admin.Exec(ctx, `insert into signalgen.account_profiles(user_id,email) values($1::uuid,'ten-stock@test.invalid')`, *id); err != nil {
			t.Fatal(err)
		}
	}
	symbols := make([]string, 10)
	for i := range symbols {
		symbols[i] = fmt.Sprintf("TENCAP%d.JK", i)
		if _, err := admin.Exec(ctx, `insert into signalgen.stock_catalog(symbol,provider,provider_symbol,name,exchange,currency)
values($1,'yahoo_finance',$1,'Test fixture','XIDX','IDR')`, symbols[i]); err != nil {
			t.Fatal(err)
		}
	}
	defer admin.Exec(context.Background(), `delete from signalgen.stock_catalog where symbol=any($1::text[])`, symbols)
	var hasRuntimeRole bool
	if err := admin.QueryRow(ctx, `select exists(select 1 from pg_roles where rolname='signalgen_api')`).Scan(&hasRuntimeRole); err != nil {
		t.Fatal(err)
	}
	// Older clean checkouts may not provision the separately managed runtime role.
	if hasRuntimeRole {
		config.AfterConnect = func(ctx context.Context, conn *pgx.Conn) error {
			_, err := conn.Exec(ctx, "set session authorization signalgen_api")
			return err
		}
	}
	runtime, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer runtime.Close()
	store := universe.NewPostgresRepository(runtime)
	three, err := store.Create(ctx, owner, "Three", symbols[:3])
	if err != nil || len(three.Symbols) != 3 {
		t.Fatalf("create three: %+v %v", three, err)
	}
	ten, err := store.Update(ctx, owner, three.ID, "Ten", symbols, three.Version)
	if err != nil || !reflect.DeepEqual(ten.Symbols, symbols) {
		t.Fatalf("expand to ten: %+v %v", ten, err)
	}
	if _, err := store.Update(ctx, owner, ten.ID, "Eleven", append(append([]string{}, symbols...), "BBCA.JK"), ten.Version); !errors.Is(err, universe.ErrInvalid) {
		t.Fatalf("eleven accepted: %v", err)
	}
	if _, err := store.Get(ctx, other, ten.ID); !errors.Is(err, universe.ErrNotFound) {
		t.Fatalf("cross-owner read: %v", err)
	}
	if _, err := store.Update(ctx, other, ten.ID, "Hijack", symbols[:3], ten.Version); !errors.Is(err, universe.ErrNotFound) {
		t.Fatalf("cross-owner update: %v", err)
	}
	saved, err := store.Get(ctx, owner, ten.ID)
	if err != nil || saved.Version != ten.Version || len(saved.Symbols) != 10 {
		t.Fatalf("rejected writes changed universe: %+v %v", saved, err)
	}
	shrunk, err := store.Update(ctx, owner, ten.ID, "Three again", symbols[:3], ten.Version)
	if err != nil || len(shrunk.Symbols) != 3 {
		t.Fatalf("shrink to three: %+v %v", shrunk, err)
	}
	if err := store.Delete(ctx, owner, shrunk.ID, shrunk.Version); err != nil {
		t.Fatal(err)
	}
}
