package screener

import (
	"sync"
	"sync/atomic"
	"testing"
)

func TestConnectionLimitsAndRelease(t *testing.T) {
	l, err := NewConnectionLimiter(2, 1)
	if err != nil {
		t.Fatal(err)
	}
	a, ok := l.Acquire("a")
	if !ok {
		t.Fatal("first acquire")
	}
	if _, ok := l.Acquire("a"); ok {
		t.Fatal("per-user bound bypassed")
	}
	b, ok := l.Acquire("b")
	if !ok {
		t.Fatal("second user blocked")
	}
	if _, ok := l.Acquire("c"); ok {
		t.Fatal("global bound bypassed")
	}
	a()
	a()
	b()
	if l.active != 0 || len(l.users) != 0 {
		t.Fatal("release leaked capacity")
	}
	if _, ok := l.Acquire(""); ok {
		t.Fatal("empty owner accepted")
	}
	if _, err := NewConnectionLimiter(1, 2); err == nil {
		t.Fatal("invalid limits accepted")
	}
}

func TestConcurrentConnectionLimit(t *testing.T) {
	l, _ := NewConnectionLimiter(4, 4)
	start := make(chan struct{})
	releaseAll := make(chan struct{})
	var acquired, attempts atomic.Int32
	var wait sync.WaitGroup
	for i := 0; i < 32; i++ {
		wait.Add(1)
		go func() {
			defer wait.Done()
			<-start
			release, ok := l.Acquire("a")
			if ok {
				acquired.Add(1)
			}
			if attempts.Add(1) == 32 {
				close(releaseAll)
			}
			<-releaseAll
			if ok {
				release()
			}
		}()
	}
	close(start)
	wait.Wait()
	if acquired.Load() != 4 || l.active != 0 || len(l.users) != 0 {
		t.Fatal("concurrent capacity invariant failed")
	}
}
