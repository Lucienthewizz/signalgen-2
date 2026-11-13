package main

import (
	"testing"
	"time"
)

func TestClosedDayBoundaryHasConservativeBuffer(t *testing.T) {
	jakarta, _ := time.LoadLocation("Asia/Jakarta")
	for _, test := range []struct {
		hour int
		want string
	}{{9, "2026-10-14"}, {17, "2026-10-14"}, {18, "2026-10-15"}, {23, "2026-10-15"}} {
		got := closedDayBoundary(time.Date(2026, 10, 14, test.hour, 0, 0, 0, jakarta), jakarta).Format("2006-01-02")
		if got != test.want {
			t.Fatalf("hour=%d got=%s want=%s", test.hour, got, test.want)
		}
	}
}

func TestScheduledFlagsRejectFrozenOrContradictoryModes(t *testing.T) {
	valid := func(explicit map[string]bool, incremental, validate, prune, refresh, retry bool, years, overlap, limit int, timeout time.Duration) error {
		return validateScheduledFlags(true, explicit, incremental, validate, prune, refresh, retry, years, overlap, limit, timeout)
	}
	if e := valid(nil, true, false, false, false, false, 5, 7, 0, time.Hour); e != nil {
		t.Fatal(e)
	}
	for _, name := range []string{"as-of", "from"} {
		if valid(map[string]bool{name: true}, true, false, false, false, false, 5, 7, 0, time.Hour) == nil {
			t.Fatal("frozen date accepted")
		}
	}
	for _, flags := range [][5]bool{{false, false, false, false, false}, {true, true, false, false, false}, {true, false, true, false, false}, {true, false, false, true, false}, {true, false, false, false, true}} {
		if valid(nil, flags[0], flags[1], flags[2], flags[3], flags[4], 5, 7, 0, time.Hour) == nil {
			t.Fatal("contradictory mode accepted")
		}
	}
	for _, n := range []int{1, 3} {
		if valid(nil, true, false, false, false, false, n, 7, 0, time.Hour) == nil {
			t.Fatal("non-five-year scheduler accepted")
		}
	}
	if valid(nil, true, false, false, false, false, 5, 1, 0, time.Hour) == nil || valid(nil, true, false, false, false, false, 5, 7, 1, time.Hour) == nil || valid(nil, true, false, false, false, false, 5, 7, 0, time.Second) == nil {
		t.Fatal("scheduled bounds accepted")
	}
	if validateScheduledFlags(false, map[string]bool{"schedule-every": true}, false, false, false, false, false, 5, 7, 0, time.Hour) == nil {
		t.Fatal("timing ignored in one-shot")
	}
	if e := validateScheduledFlags(false, nil, false, true, false, false, false, 5, 7, 0, time.Hour); e != nil {
		t.Fatal("one-shot validate changed")
	}
}
