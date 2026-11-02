package auth

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rsa"
	"encoding/json"
	"io"
	"net/http"
	"sync"
	"time"

	platformhttp "github.com/Lucienthewizz/signalgen-2/backend/internal/platform/http"
	"github.com/go-jose/go-jose/v4"
	"golang.org/x/sync/singleflight"
)

const publicKeyTTL = 10 * time.Minute
const keyRefreshCooldown = 30 * time.Second

// Fixed project URL only: jku/x5u from token headers are never followed.
type publicKeys struct {
	url                  string
	client               HTTPClient
	mu                   sync.Mutex
	keys                 map[string]jose.JSONWebKey
	expires, nextRefresh time.Time
	refreshError         error
	refresh              singleflight.Group
}

func (cache *publicKeys) key(ctx context.Context, kid, algorithm string) (any, error) {
	if ctx.Err() != nil {
		return nil, ErrProviderUnavailable
	}
	cache.mu.Lock()
	key, found := cache.keys[kid]
	fresh := time.Now().Before(cache.expires)
	wait := time.Now().Before(cache.nextRefresh)
	refreshError := cache.refreshError
	cache.mu.Unlock()
	if fresh && found {
		return matchingKey(key, algorithm)
	}
	if wait {
		if fresh && refreshError == nil {
			return nil, ErrTokenInvalid
		}
		return nil, ErrProviderUnavailable
	}
	result := cache.refresh.DoChan("jwks", func() (any, error) {
		cache.mu.Lock()
		if time.Now().Before(cache.nextRefresh) {
			cache.mu.Unlock()
			return nil, nil
		}
		cache.mu.Unlock()
		// A departing request must not cancel key retrieval needed by other users.
		fetchCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		keys, err := cache.fetch(fetchCtx)
		cache.mu.Lock()
		defer cache.mu.Unlock()
		cache.nextRefresh = time.Now().Add(keyRefreshCooldown)
		cache.refreshError = err
		if err != nil {
			return nil, err
		}
		cache.keys, cache.expires = keys, time.Now().Add(publicKeyTTL)
		return nil, nil
	})
	select {
	case <-ctx.Done():
		return nil, ErrProviderUnavailable
	case completed := <-result:
		if completed.Err != nil {
			return nil, ErrProviderUnavailable
		}
	}
	cache.mu.Lock()
	key, found = cache.keys[kid]
	fresh = time.Now().Before(cache.expires)
	refreshError = cache.refreshError
	cache.mu.Unlock()
	if !fresh || refreshError != nil {
		return nil, ErrProviderUnavailable
	}
	if !found {
		return nil, ErrTokenInvalid
	}
	return matchingKey(key, algorithm)
}

func matchingKey(key jose.JSONWebKey, algorithm string) (any, error) {
	if key.Algorithm != algorithm {
		return nil, ErrTokenInvalid
	}
	return key.Key, nil
}

func (cache *publicKeys) fetch(ctx context.Context) (map[string]jose.JSONWebKey, error) {
	started := time.Now()
	defer func() { platformhttp.RecordTiming(ctx, platformhttp.AuthKeys, time.Since(started)) }()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, cache.url, nil)
	if err != nil {
		return nil, ErrProviderUnavailable
	}
	request.Header.Set("Accept", "application/json")
	response, err := cache.client.Do(request)
	if err != nil {
		return nil, ErrProviderUnavailable
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, ErrProviderUnavailable
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, 64*1024+1))
	if err != nil || len(data) > 64*1024 {
		return nil, ErrProviderUnavailable
	}
	var set jose.JSONWebKeySet
	if json.Unmarshal(data, &set) != nil || len(set.Keys) > 32 {
		return nil, ErrProviderUnavailable
	}
	keys := make(map[string]jose.JSONWebKey)
	for _, key := range set.Keys {
		if key.KeyID == "" || len(key.KeyID) > 128 || !key.Valid() || !key.IsPublic() || (key.Use != "" && key.Use != "sig") {
			continue
		}
		switch public := key.Key.(type) {
		case *ecdsa.PublicKey:
			if key.Algorithm != "ES256" || public.Curve != elliptic.P256() {
				continue
			}
		case *rsa.PublicKey:
			if key.Algorithm != "RS256" || public.N.BitLen() < 2048 {
				continue
			}
		default:
			continue
		}
		if _, exists := keys[key.KeyID]; exists {
			return nil, ErrProviderUnavailable
		}
		keys[key.KeyID] = key
	}
	return keys, nil
}
