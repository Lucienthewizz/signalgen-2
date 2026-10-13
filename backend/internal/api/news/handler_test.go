package news

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type transportFunc func(*http.Request) (*http.Response, error)

func (fn transportFunc) RoundTrip(request *http.Request) (*http.Response, error) { return fn(request) }

const validFeed = `<rss><channel><item><title>IHSG &amp; bursa</title><link>https://www.antaranews.com/berita/1/ihsg</link><pubDate>Thu, 08 Oct 2026 09:13:54 +0700</pubDate></item><item><title>Duplicate</title><link>https://www.antaranews.com/berita/1/ihsg</link></item><item><title>Unsafe</title><link>https://example.org/berita/2/unsafe</link></item></channel></rss>`

func TestHandlerUsesFixedFeedCachesAndPreservesStaleNews(t *testing.T) {
	var calls atomic.Int32
	var failing atomic.Bool
	upstream := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		calls.Add(1)
		if failing.Load() {
			writer.WriteHeader(http.StatusTooManyRequests)
			return
		}
		fmt.Fprint(writer, validFeed)
	}))
	defer upstream.Close()
	handler := NewHandler()
	now := time.Date(2026, 10, 8, 5, 0, 0, 0, time.UTC)
	handler.now = func() time.Time { return now }
	handler.client.Transport = transportFunc(func(request *http.Request) (*http.Response, error) {
		if request.URL.String() != feedURL {
			t.Errorf("unexpected upstream %s", request.URL)
		}
		if request.Header.Get("Authorization") != "" || request.Header.Get("Cookie") != "" {
			t.Error("upstream credentials leaked")
		}
		clone := request.Clone(request.Context())
		clone.URL, _ = url.Parse(upstream.URL)
		return http.DefaultTransport.RoundTrip(clone)
	})
	request := httptest.NewRequest(http.MethodGet, "/api/news?url=https://evil.example", nil)
	request.Header.Set("Authorization", "secret")
	request.Header.Set("Cookie", "secret")
	writer := httptest.NewRecorder()
	handler.ServeHTTP(writer, request)
	if writer.Code != 200 || !strings.Contains(writer.Body.String(), `"title":"IHSG \u0026 bursa"`) || !strings.Contains(writer.Body.String(), `"published_at":"2026-10-08T02:13:54Z"`) {
		t.Fatalf("unexpected response %d %s", writer.Code, writer.Body)
	}
	if len(handler.cached.Articles) != 1 {
		t.Fatal("unsafe/duplicate articles admitted")
	}
	handler.ServeHTTP(httptest.NewRecorder(), request)
	if calls.Load() != 1 {
		t.Fatal("fresh cache repeated upstream")
	}
	now = now.Add(6 * time.Minute)
	failing.Store(true)
	writer = httptest.NewRecorder()
	handler.ServeHTTP(writer, request)
	if writer.Code != 200 || !strings.Contains(writer.Body.String(), `"stale":true`) || writer.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("failed refresh did not preserve stale news")
	}
	handler.ServeHTTP(httptest.NewRecorder(), request)
	if calls.Load() != 2 {
		t.Fatal("error cooldown repeated upstream")
	}
	now = now.Add(25 * time.Hour)
	writer = httptest.NewRecorder()
	handler.ServeHTTP(writer, request)
	if writer.Code != 503 || writer.Header().Get("Retry-After") != "60" {
		t.Fatal("expired news should report retryable error")
	}
	now = now.Add(time.Minute)
	failing.Store(false)
	writer = httptest.NewRecorder()
	handler.ServeHTTP(writer, request)
	if writer.Code != 200 || strings.Contains(writer.Body.String(), `"stale":true`) {
		t.Fatal("feed did not recover")
	}
}

func TestConcurrentRequestsShareOneRefresh(t *testing.T) {
	handler := NewHandler()
	var calls atomic.Int32
	started, release := make(chan struct{}), make(chan struct{})
	handler.client.Transport = transportFunc(func(request *http.Request) (*http.Response, error) {
		calls.Add(1)
		close(started)
		<-release
		return nil, fmt.Errorf("offline")
	})
	var wait sync.WaitGroup
	for i := 0; i < 20; i++ {
		wait.Add(1)
		go func() { defer wait.Done(); handler.load(context.Background()) }()
	}
	<-started
	close(release)
	wait.Wait()
	if calls.Load() != 1 {
		t.Fatalf("%d upstream requests", calls.Load())
	}
}

func TestInvalidOrOversizedFeedsFailAndEnforceCooldown(t *testing.T) {
	for _, body := range []string{"<html>error</html>", "<rss><channel/></rss>", strings.Repeat("x", maxFeedBytes+1)} {
		handler := NewHandler()
		var calls int
		handler.client.Transport = transportFunc(func(request *http.Request) (*http.Response, error) {
			calls++
			return &http.Response{StatusCode: 200, Body: ioReader(body)}, nil
		})
		if _, err := handler.load(context.Background()); err == nil {
			t.Fatal("invalid feed accepted")
		}
		if _, err := handler.load(context.Background()); err == nil {
			t.Fatal("cooldown should report failure")
		}
		if calls != 1 {
			t.Fatal("cooldown repeated upstream")
		}
	}
}

func TestMethodAndRedirectRestrictions(t *testing.T) {
	handler := NewHandler()
	writer := httptest.NewRecorder()
	handler.ServeHTTP(writer, httptest.NewRequest(http.MethodPost, "/api/news", nil))
	if writer.Code != 405 {
		t.Fatal("write method accepted")
	}
	for _, target := range []string{"http://www.antaranews.com/rss", "https://evil.example/rss", "https://user:pass@www.antaranews.com/rss"} {
		request := httptest.NewRequest(http.MethodGet, target, nil)
		if handler.client.CheckRedirect(request, nil) == nil {
			t.Fatalf("unsafe redirect accepted: %s", target)
		}
	}
}

func TestTimeoutBoundsRefreshAndCancelledWaiterReturns(t *testing.T) {
	handler := NewHandler()
	handler.client.Timeout = 30 * time.Millisecond
	started := make(chan struct{})
	handler.client.Transport = transportFunc(func(request *http.Request) (*http.Response, error) {
		close(started)
		<-request.Context().Done()
		return nil, request.Context().Err()
	})
	done := make(chan struct{})
	start := time.Now()
	go func() { defer close(done); handler.load(context.Background()) }()
	<-started
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := handler.load(ctx); err != context.Canceled {
		t.Fatalf("cancelled waiter returned %v", err)
	}
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("upstream timeout did not bound refresh")
	}
	if time.Since(start) > time.Second {
		t.Fatal("refresh exceeded timeout budget")
	}
}

type stringBody struct{ *strings.Reader }

func (stringBody) Close() error       { return nil }
func ioReader(body string) stringBody { return stringBody{strings.NewReader(body)} }
