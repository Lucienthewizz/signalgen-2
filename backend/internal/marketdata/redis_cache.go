package marketdata

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"sync/atomic"
	"time"

	"github.com/redis/go-redis/v9"
)

// RedisCache is an optional second cache behind the bounded process-local cache.
// Its short failure pause prevents every ticker from waiting on an outage.
type RedisCache struct {
	client                 *redis.Client
	prefix                 string
	retryAfter             atomic.Int64
	hits, misses, failures atomic.Uint64
}

func NewRedisCache(rawURL, sourceScope string) (*RedisCache, error) {
	options, err := redis.ParseURL(rawURL)
	if err != nil {
		// Parse errors can contain the supplied URL, including credentials.
		return nil, errors.New("invalid SIGNALGEN_REDIS_URL")
	}
	options.MaxRetries = -1
	options.DialerRetries = 1
	options.DialTimeout = 200 * time.Millisecond
	options.ReadTimeout = 200 * time.Millisecond
	options.WriteTimeout = 200 * time.Millisecond
	options.PoolTimeout = 200 * time.Millisecond
	options.ContextTimeoutEnabled = true
	options.PoolSize = 8
	options.MaxActiveConns = 8
	options.MinIdleConns = 0
	options.DisableIdentity = true
	options.Protocol = 2
	scope := sha256.Sum256([]byte(sourceScope))
	return &RedisCache{client: redis.NewClient(options), prefix: "signalgen:market:v1:" + hex.EncodeToString(scope[:]) + ":"}, nil
}

func (cache *RedisCache) key(key string) string {
	digest := sha256.Sum256([]byte(key))
	return cache.prefix + hex.EncodeToString(digest[:])
}

func (cache *RedisCache) failed(err error) {
	if err != nil {
		cache.failures.Add(1)
		cache.retryAfter.Store(time.Now().Add(5 * time.Second).UnixNano())
	}
}

func (cache *RedisCache) Get(ctx context.Context, key string) ([]byte, error) {
	if time.Now().UnixNano() < cache.retryAfter.Load() {
		return nil, ErrUnavailable
	}
	ctx, cancel := context.WithTimeout(ctx, 250*time.Millisecond)
	defer cancel()
	// GETRANGE also bounds allocation if another process writes an oversized key.
	value, err := cache.client.GetRange(ctx, cache.key(key), 0, maxSharedPayload).Bytes()
	cache.failed(err)
	if err == nil {
		if len(value) == 0 {
			cache.misses.Add(1)
		} else {
			cache.hits.Add(1)
		}
	}
	return value, err
}

func (cache *RedisCache) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	if len(value) > maxSharedPayload || ttl <= 0 {
		return errors.New("invalid shared cache entry")
	}
	if time.Now().UnixNano() < cache.retryAfter.Load() {
		return ErrUnavailable
	}
	ctx, cancel := context.WithTimeout(ctx, 250*time.Millisecond)
	defer cancel()
	err := cache.client.Set(ctx, cache.key(key), value, ttl).Err()
	cache.failed(err)
	return err
}

func (cache *RedisCache) Stats() (hits, misses, failures uint64) {
	return cache.hits.Load(), cache.misses.Load(), cache.failures.Load()
}

func (cache *RedisCache) Close() error { return cache.client.Close() }
