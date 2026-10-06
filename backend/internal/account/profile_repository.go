package account

import (
	"context"
	"errors"
	"fmt"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/jackc/pgx/v5"
)

const profileColumns = `user_id::text,display_name,bio,profile_version,profile_updated_at`

func readProfile(row pgx.Row) (Profile, error) {
	var profile Profile
	err := row.Scan(&profile.UserID, &profile.DisplayName, &profile.Bio, &profile.Version, &profile.UpdatedAt)
	return profile, err
}

// Profile always uses the verified principal's ID. Direct pgx connections do
// not inherit auth.uid(), so RLS does not replace this explicit owner predicate.
func (store *PostgresRepository) Profile(ctx context.Context, owner string) (Profile, error) {
	profile, err := readProfile(store.db.QueryRow(ctx, `select `+profileColumns+`
from signalgen.account_profiles where user_id=$1::uuid and status='active'`, owner))
	if errors.Is(err, pgx.ErrNoRows) {
		_, activeErr := store.RequireActive(ctx, owner)
		if activeErr != nil {
			return Profile{}, activeErr
		}
		return Profile{}, access.ErrAccountNotFound
	}
	if err != nil {
		return Profile{}, fmt.Errorf("read editable profile: %w", err)
	}
	return profile, nil
}

// UpdateProfile changes only presentation columns. Owner + expected version
// make this a single atomic compare-and-swap, even across multiple API replicas.
func (store *PostgresRepository) UpdateProfile(ctx context.Context, owner string, input UpdateProfileInput) (Profile, error) {
	input, err := NormalizeProfileUpdate(input)
	if err != nil {
		return Profile{}, err
	}
	profile, err := readProfile(store.db.QueryRow(ctx, `update signalgen.account_profiles
set display_name=coalesce($2::text,display_name), bio=coalesce($3::text,bio),
    profile_version=profile_version+1, profile_updated_at=now(), updated_at=now()
where user_id=$1::uuid and profile_version=$4 and status='active'
returning `+profileColumns, owner, input.DisplayName, input.Bio, input.Version))
	if errors.Is(err, pgx.ErrNoRows) {
		if _, activeErr := store.RequireActive(ctx, owner); activeErr != nil {
			return Profile{}, activeErr
		}
		return Profile{}, ErrProfileConflict
	}
	if err != nil {
		return Profile{}, fmt.Errorf("update editable profile: %w", err)
	}
	return profile, nil
}
