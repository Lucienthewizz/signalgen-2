package session

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type slotRow func(...any) error

func (row slotRow) Scan(dest ...any) error { return row(dest...) }

type slotTx struct {
	others   int
	query    string
	writes   []string
	current  string
	switched pgtype.Timestamptz
	err      error
}

func (tx *slotTx) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	tx.query = query
	return slotRow(func(dest ...any) error {
		if tx.err != nil {
			return tx.err
		}
		if strings.Contains(query, "count(*)") {
			*dest[0].(*int) = tx.others
		} else {
			*dest[0].(*string), *dest[1].(*pgtype.Timestamptz) = tx.current, tx.switched
		}
		return nil
	})
}
func (tx *slotTx) Exec(_ context.Context, query string, args ...any) (pgconn.CommandTag, error) {
	tx.writes = append(tx.writes, query)
	return pgconn.NewCommandTag("UPDATE 1"), tx.err
}

func TestMultiSessionSlotIsBoundedAndDoesNotRevokeOtherBrowsers(t *testing.T) {
	store := &PostgresRepository{max: 5, cooldown: 24 * time.Hour}
	for _, others := range []int{0, 1, 4, 5, 6} {
		tx := &slotTx{others: others}
		err := store.reserveSessionSlot(context.Background(), tx, "user-a", "browser-a", time.Now())
		if others >= 5 {
			if !errors.Is(err, ErrSessionLimit) || len(tx.writes) != 0 {
				t.Fatalf("full slot modified sessions: %v", err)
			}
		} else if err != nil || len(tx.writes) != 1 || !strings.Contains(tx.writes[0], "installation_id=$2") {
			t.Fatalf("other-browser sessions would be revoked: %+v %v", tx.writes, err)
		}
		if !strings.Contains(tx.query, "user_id=$1::uuid") || !strings.Contains(tx.query, "installation_id<>$2") || !strings.Contains(tx.query, "expires_at>$3") {
			t.Fatal("session capacity is not owner/installation/expiry scoped")
		}
	}
	if store.DeviceSwitchCooldown() != 0 {
		t.Fatal("multi-session metadata reports an exclusive-device cooldown")
	}
	if until, err := store.CooldownUntil(context.Background(), "user-a"); err != nil || !until.IsZero() {
		t.Fatal("multi-session mode still reads exclusive-device state")
	}
}

func TestExclusiveSessionCooldownRemainsTheDefaultPolicy(t *testing.T) {
	store := &PostgresRepository{max: 1, cooldown: 24 * time.Hour}
	now := time.Now()
	tx := &slotTx{current: "browser-old", switched: pgtype.Timestamptz{Valid: true, Time: now.Add(-time.Hour)}}
	if err := store.reserveSessionSlot(context.Background(), tx, "user-a", "browser-new", now); !errors.Is(err, ErrDeviceCooldown) {
		t.Fatalf("cooldown error=%v", err)
	}
	if len(tx.writes) != 1 || !strings.Contains(tx.writes[0], "insert into") {
		t.Fatal("cooldown rejection revoked a session")
	}
	tx = &slotTx{current: "browser-same"}
	if err := store.reserveSessionSlot(context.Background(), tx, "user-a", "browser-same", now); err != nil || len(tx.writes) != 2 {
		t.Fatalf("same-device rotation error=%v", err)
	}
}

func TestPostgresSessionConfigurationAcceptsOnlyOneToFive(t *testing.T) {
	for _, max := range []int{-1, 0, 1, 5, 6} {
		_, err := NewPostgresRepository(&pgxpool.Pool{}, max, time.Hour)
		if (max >= 1 && max <= 5) != (err == nil) {
			t.Fatalf("max=%d error=%v", max, err)
		}
	}
}
