package universe

import (
	"fmt"
	"testing"
)

func TestUniverseAllowsOneThroughTenUniqueSymbols(t *testing.T) {
	for _, count := range []int{0, 1, 3, 10, 11} {
		symbols := make([]string, count)
		for i := range symbols {
			symbols[i] = fmt.Sprintf("TEST%d.JK", i)
		}
		if got, want := validSymbols(symbols), count >= 1 && count <= 10; got != want {
			t.Fatalf("count=%d accepted=%v want=%v", count, got, want)
		}
	}
	if validSymbols([]string{"BBCA.JK", "BBCA.JK"}) || validSymbols([]string{" "}) {
		t.Fatal("duplicate or blank symbols accepted")
	}
}
