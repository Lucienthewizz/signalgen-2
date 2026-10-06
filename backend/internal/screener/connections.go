package screener

import (
	"fmt"
	"sync"
)

// ConnectionLimiter bounds authenticated sockets that are waiting for client
// data. It is process-local, so deployment replicas need separate capacity
// planning. User keys must come from consumed server tickets, never query input.
type ConnectionLimiter struct {
	mu                   sync.Mutex
	max, perUser, active int
	users                map[string]int
}

func NewConnectionLimiter(max, perUser int) (*ConnectionLimiter, error) {
	if max < 1 || perUser < 1 || perUser > max {
		return nil, fmt.Errorf("invalid socket limits")
	}
	return &ConnectionLimiter{max: max, perUser: perUser, users: make(map[string]int)}, nil
}

// Acquire returns an idempotent release function so every transport failure
// frees its slot and no idle-user entries accumulate.
func (limiter *ConnectionLimiter) Acquire(user string) (func(), bool) {
	limiter.mu.Lock()
	defer limiter.mu.Unlock()
	if user == "" || limiter.active >= limiter.max || limiter.users[user] >= limiter.perUser {
		return nil, false
	}
	limiter.active++
	limiter.users[user]++
	var once sync.Once
	return func() {
		once.Do(func() {
			limiter.mu.Lock()
			defer limiter.mu.Unlock()
			limiter.active--
			limiter.users[user]--
			if limiter.users[user] == 0 {
				delete(limiter.users, user)
			}
		})
	}, true
}
