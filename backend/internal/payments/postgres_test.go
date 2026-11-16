package payments_test

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/payments"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/subscription"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Needs a migrated disposable database (for example after cmd/schematest):
// PAYMENTS_TEST_DATABASE_URL=postgres://...@127.0.0.1:.../signalgen_test
func TestPostgresPaymentActivationExtensionAndIdempotency(t *testing.T) {
	dsn := os.Getenv("PAYMENTS_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("disposable database not provided")
	}
	guard, err := pgxpool.ParseConfig(dsn)
	if err != nil || (guard.ConnConfig.Host != "127.0.0.1" && guard.ConnConfig.Host != "localhost") || guard.ConnConfig.Database != "signalgen_test" {
		t.Fatal("requires disposable signalgen_test on loopback")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	var owner, other string
	for _, id := range []*string{&owner, &other} {
		if err := admin.QueryRow(ctx, "insert into auth.users default values returning id::text").Scan(id); err != nil {
			t.Fatal(err)
		}
		if _, err := admin.Exec(ctx, "insert into signalgen.account_profiles(user_id,email) values($1::uuid,'pay@example.test') on conflict do nothing", *id); err != nil {
			t.Fatal(err)
		}
	}
	// Run as the restricted runtime role, as the API does.
	config, _ := pgxpool.ParseConfig(dsn)
	config.AfterConnect = func(ctx context.Context, c *pgx.Conn) error {
		_, err := c.Exec(ctx, "set role signalgen_api")
		return err
	}
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	store := &payments.PostgresStore{DB: pool}
	if err := store.Ready(ctx); err != nil {
		t.Fatal(err)
	}
	subs := subscription.NewPostgresRepository(pool)

	run := strings.ToLower(strings.ReplaceAll(owner[:8], "-", ""))
	order := func(id, plan string, amount int) payments.Order {
		t.Helper()
		id += "-" + run
		o := payments.Order{ID: id, UserID: owner, PlanCode: plan, Amount: amount, Currency: "IDR", Status: payments.OrderPending}
		if err := store.CreateOrder(ctx, o); err != nil {
			t.Fatal(err)
		}
		return o
	}
	settled := func(id, amount string) payments.Status {
		return payments.Status{OrderID: id, StatusCode: "200", TransactionStatus: "settlement", GrossAmount: amount, Currency: "IDR", PaymentType: "qris", TransactionID: "tx-" + id}
	}
	events := func() int {
		var n int
		if err := admin.QueryRow(ctx, "select count(*) from signalgen.subscription_events where user_id=$1::uuid", owner).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}

	// Pending and amount-mismatched notifications never grant access.
	first := order("sg-test-first-0001", "pro", 99000)
	if o, err := store.ApplyStatus(ctx, first.ID, payments.Status{OrderID: first.ID, TransactionStatus: "pending", GrossAmount: "99000.00"}); err != nil || o.Status != payments.OrderPending {
		t.Fatalf("pending: %+v %v", o, err)
	}
	if _, err := store.ApplyStatus(ctx, first.ID, settled(first.ID, "1000.00")); !errors.Is(err, payments.ErrAmountMismatch) {
		t.Fatalf("mismatch accepted: %v", err)
	}
	if _, err := subs.Current(ctx, owner); !errors.Is(err, subscription.ErrNotFound) {
		t.Fatalf("subscription created before payment: %v", err)
	}

	// Settlement activates one month of Pro; a repeated notification is a no-op.
	start := time.Now()
	paid, err := store.ApplyStatus(ctx, first.ID, settled(first.ID, "99000.00"))
	if err != nil || paid.Status != payments.OrderPaid || paid.PaidAt.IsZero() {
		t.Fatalf("settlement: %+v %v", paid, err)
	}
	current, err := subs.Current(ctx, owner)
	if err != nil || current.PlanCode != "pro" || current.Status != "active" || current.Source != "payment_provider" {
		t.Fatalf("activation: %+v %v", current, err)
	}
	if d := current.CurrentPeriodEnd.Sub(start); d < 27*24*time.Hour || d > 32*24*time.Hour {
		t.Fatalf("first period is not one month: %s", d)
	}
	firstEnd := current.CurrentPeriodEnd
	if _, err := store.ApplyStatus(ctx, first.ID, settled(first.ID, "99000.00")); err != nil || events() != 1 {
		t.Fatalf("repeat notification changed state: events=%d err=%v", events(), err)
	}
	if again, _ := subs.Current(ctx, owner); !again.CurrentPeriodEnd.Equal(firstEnd) {
		t.Fatal("repeat notification extended the period")
	}
	// A later expire for a paid order cannot take access away.
	if o, err := store.ApplyStatus(ctx, first.ID, payments.Status{OrderID: first.ID, TransactionStatus: "expire"}); err != nil || o.Status != payments.OrderPaid {
		t.Fatalf("paid order changed: %+v %v", o, err)
	}

	// Paying again for the active plan extends from the current end.
	second := order("sg-test-second-0002", "pro", 99000)
	if _, err := store.ApplyStatus(ctx, second.ID, settled(second.ID, "99000.00")); err != nil {
		t.Fatal(err)
	}
	extended, _ := subs.Current(ctx, owner)
	if d := extended.CurrentPeriodEnd.Sub(firstEnd); d < 27*24*time.Hour || d > 32*24*time.Hour {
		t.Fatalf("renewal did not keep remaining days: %s", d)
	}
	if !extended.CurrentPeriodStart.Equal(current.CurrentPeriodStart) {
		t.Fatal("renewal moved the period start")
	}

	// A different plan starts a new month now.
	third := order("sg-test-third-0003", "analyst", 49000)
	if _, err := store.ApplyStatus(ctx, third.ID, settled(third.ID, "49000.00")); err != nil {
		t.Fatal(err)
	}
	changed, _ := subs.Current(ctx, owner)
	if changed.PlanCode != "analyst" || changed.CurrentPeriodEnd.Sub(time.Now()) > 32*24*time.Hour {
		t.Fatalf("plan change: %+v", changed)
	}
	if events() != 3 {
		t.Fatalf("events = %d, want 3", events())
	}

	// Failed and expired orders stay without access changes.
	failed := order("sg-test-failed-0004", "pro", 99000)
	if o, err := store.ApplyStatus(ctx, failed.ID, payments.Status{OrderID: failed.ID, TransactionStatus: "deny"}); err != nil || o.Status != payments.OrderFailed {
		t.Fatalf("deny: %+v %v", o, err)
	}
	if after, _ := subs.Current(ctx, owner); after.PlanCode != "analyst" {
		t.Fatal("failed payment changed the plan")
	}

	// Orders are owner-scoped for reads.
	if _, err := store.Order(ctx, other, first.ID); !errors.Is(err, payments.ErrOrderNotFound) {
		t.Fatalf("other user read the order: %v", err)
	}
	if _, err := store.ApplyStatus(ctx, "sg-test-missing-9999", settled("sg-test-missing-9999", "99000.00")); !errors.Is(err, payments.ErrOrderNotFound) {
		t.Fatalf("unknown order: %v", err)
	}
}
