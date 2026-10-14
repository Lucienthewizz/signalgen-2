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
