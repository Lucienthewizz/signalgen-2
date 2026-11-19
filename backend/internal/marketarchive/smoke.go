package marketarchive

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"time"

	"github.com/google/uuid"
)

type Smoke struct {
	ID            string    `json:"id"`
	DeploymentRef string    `json:"deployment_ref"`
	Attempts      int       `json:"attempts"`
	Successes     int       `json:"automatic_successes"`
	State         string    `json:"state"`
	Expires       time.Time `json:"expires_at"`
	Disable       bool      `json:"disable_workflow"`
}

func (s *Store) ArmSmoke(ctx context.Context, ref string) (Smoke, error) {
	if !regexp.MustCompile(`^[a-f0-9]{40}$`).MatchString(ref) {
		return Smoke{}, fmt.Errorf("deployment ref must be a full commit SHA")
	}
	var result Smoke
	err := s.DB.QueryRow(ctx, `with stamp as(select clock_timestamp() as now) insert into signalgen.market_smoke_tests(id,deployment_ref,armed_at,expires_at) select $1,$2,now,now+interval '1 hour' from stamp returning id,deployment_ref,attempts,successes,state,expires_at`, uuid.NewString(), ref).Scan(&result.ID, &result.DeploymentRef, &result.Attempts, &result.Successes, &result.State, &result.Expires)
	return result, err
}

func (s *Store) SmokeStatus(ctx context.Context, id string) (Smoke, error) {
	result := Smoke{ID: id}
	_, err := s.DB.Exec(ctx, `update signalgen.market_smoke_tests set state=case when successes>=3 then 'passed' when expires_at<=clock_timestamp() then 'expired' else 'failed' end where id=$1 and state='armed' and (expires_at<=clock_timestamp() or attempts>=6 or successes>=3)`, id)
	if err != nil {
		return result, err
	}
	err = s.DB.QueryRow(ctx, `select deployment_ref,attempts,successes,state,expires_at from signalgen.market_smoke_tests where id=$1`, id).Scan(&result.DeploymentRef, &result.Attempts, &result.Successes, &result.State, &result.Expires)
	result.Disable = result.State != "armed"
	return result, err
}

// BeginSmokeEvent counts scheduled workflow runs, never manual preflight. The
// stable GitHub run ID prevents a retry from consuming the budget twice.
func (s *Store) BeginSmokeEvent(ctx context.Context, id, ref, eventID, event string) (Smoke, bool, error) {
	state, err := s.SmokeStatus(ctx, id)
	if err != nil {
		return state, false, err
	}
	if state.Disable {
		return state, false, ErrSmokeClosed
	}
	if state.DeploymentRef != ref || event != "schedule" && event != "manual" {
		return state, false, fmt.Errorf("smoke event does not match pinned deployment")
	}
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return state, false, err
	}
	defer tx.Rollback(context.Background())
	var active bool
	if err = tx.QueryRow(ctx, `select state='armed' and attempts<6 and successes<3 and expires_at>clock_timestamp() from signalgen.market_smoke_tests where id=$1 for update`, id).Scan(&active); err != nil {
		return state, false, err
	}
	if !active {
		return state, false, ErrSmokeClosed
	}
	command, err := tx.Exec(ctx, `insert into signalgen.market_smoke_events(test_id,event_id,trigger) values($1,$2,$3) on conflict do nothing`, id, eventID, event)
	if err != nil {
		return state, false, err
	}
	if command.RowsAffected() == 0 {
		return state, false, tx.Commit(ctx)
	}
	if event == "schedule" {
		if _, err = tx.Exec(ctx, `update signalgen.market_smoke_tests set attempts=attempts+1 where id=$1`, id); err != nil {
			return state, false, err
		}
	}
	return state, true, tx.Commit(ctx)
}

func (s *Store) FinishSmokeEvent(ctx context.Context, id, eventID string, runs []Run, success bool) (Smoke, error) {
	// A successful event must cover both complete three-symbol markets.
	markets := map[string]bool{}
	for _, run := range runs {
		if run.Scope == "smoke" && run.ExternalID == eventID && run.Status == "published" && run.Total == 3 && run.Successful == 3 && run.Failed == 0 {
			markets[run.Market] = true
		}
	}
	success = success && len(runs) == 2 && markets["IDX"] && markets["US"]
	raw, _ := json.Marshal(runs)
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return Smoke{}, err
	}
	defer tx.Rollback(context.Background())
	var event string
	err = tx.QueryRow(ctx, `select trigger from signalgen.market_smoke_events where test_id=$1 and event_id=$2 and finished_at is null for update`, id, eventID).Scan(&event)
	if err != nil {
		return Smoke{}, err
	}
	if success {
		ids := []string{runs[0].ID, runs[1].ID}
		var completed int
		err = tx.QueryRow(ctx, `select count(distinct r.market) from signalgen.market_sync_runs r where r.id=any($1::uuid[]) and r.scope='smoke' and r.external_id=$2 and r.trigger=$3 and r.status='published' and r.total=3 and r.successful=3 and r.failed=0
and not exists(select 1 from signalgen.market_sync_items i where i.run_id=r.id and (i.status<>'success' or i.symbol<>all(array['BBCA.JK','BBRI.JK','TLKM.JK','AAPL','MSFT','NVDA'])))`, ids, eventID, event).Scan(&completed)
		if err != nil {
			return Smoke{}, err
		}
		success = completed == 2
	}
	if _, err = tx.Exec(ctx, `update signalgen.market_smoke_events set finished_at=clock_timestamp(),success=$3,runs=$4 where test_id=$1 and event_id=$2`, id, eventID, success, raw); err != nil {
		return Smoke{}, err
	}
	if event == "schedule" && success {
		if _, err = tx.Exec(ctx, `update signalgen.market_smoke_tests set successes=least(3,successes+1) where id=$1`, id); err != nil {
			return Smoke{}, err
		}
	}
	_, err = tx.Exec(ctx, `update signalgen.market_smoke_tests set state=case when successes>=3 then 'passed' when expires_at<=clock_timestamp() then 'expired' when attempts>=6 then 'failed' else state end where id=$1`, id)
	if err != nil {
		return Smoke{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Smoke{}, err
	}
	return s.SmokeStatus(ctx, id)
}
