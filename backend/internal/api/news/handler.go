// Package news exposes a bounded, cached view of ANTARA's public Bursa RSS.
package news

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const feedURL = "https://www.antaranews.com/rss/ekonomi-bursa.xml"
const maxFeedBytes = 1 << 20

type article struct {
	Title       string `json:"title"`
	URL         string `json:"url"`
	PublishedAt string `json:"published_at,omitempty"`
}

type response struct {
	Articles  []article `json:"articles"`
	FetchedAt time.Time `json:"fetched_at"`
	Stale     bool      `json:"stale"`
}

type Handler struct {
	client      *http.Client
	now         func() time.Time
	mu          sync.Mutex
	cached      *response
	nextAttempt time.Time
	inflight    chan struct{}
}

// NewHandler permits no client-selected URL, credentials, or database writes.
func NewHandler() *Handler {
	return &Handler{client: &http.Client{
		Timeout: 8 * time.Second,
		CheckRedirect: func(request *http.Request, via []*http.Request) error {
			if len(via) >= 3 || request.URL.Scheme != "https" || request.URL.Host != "www.antaranews.com" || request.URL.User != nil {
				return fmt.Errorf("unsupported feed redirect")
			}
			return nil
		},
	}, now: time.Now}
}

func (handler *Handler) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	writer.Header().Set("X-Content-Type-Options", "nosniff")
	if request.Method != http.MethodGet {
		writer.Header().Set("Allow", http.MethodGet)
		writer.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	result, err := handler.load(request.Context())
	if err != nil {
		writer.Header().Set("Cache-Control", "no-store")
		writer.Header().Set("Retry-After", "60")
		writer.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(writer).Encode(map[string]string{"message": "Sumber berita belum tersedia. Coba lagi dalam satu menit."})
		return
	}
	// Keep stale responses out of shared caches so recovery is visible promptly.
	if result.Stale {
		writer.Header().Set("Cache-Control", "no-store")
	} else {
		writer.Header().Set("Cache-Control", "public, max-age=60")
	}
	_ = json.NewEncoder(writer).Encode(result)
}

func (handler *Handler) load(ctx context.Context) (response, error) {
	for {
		handler.mu.Lock()
		now := handler.now()
		if handler.cached != nil && now.Sub(handler.cached.FetchedAt) < 5*time.Minute {
			result := *handler.cached
			handler.mu.Unlock()
			return result, nil
		}
		if now.Before(handler.nextAttempt) {
			result, err := handler.fallback(now)
			handler.mu.Unlock()
			return result, err
		}
		if waiting := handler.inflight; waiting != nil {
			handler.mu.Unlock()
			select {
			case <-waiting:
				continue
			case <-ctx.Done():
				return response{}, ctx.Err()
			}
		}
		handler.inflight = make(chan struct{})
		handler.mu.Unlock()

		// A browser navigating away must not cancel the shared upstream refresh.
		refreshCtx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		items, err := handler.fetch(refreshCtx)
		cancel()
		handler.mu.Lock()
		now = handler.now()
		if err == nil {
			handler.cached = &response{Articles: items, FetchedAt: now}
			handler.nextAttempt = time.Time{}
		} else {
			handler.nextAttempt = now.Add(time.Minute)
		}
		close(handler.inflight)
		handler.inflight = nil
		result, fallbackErr := handler.fallback(now)
		if err == nil {
			result.Stale = false
		}
		handler.mu.Unlock()
		return result, fallbackErr
	}
}

// fallback is called only under mu; never display old news beyond one day.
func (handler *Handler) fallback(now time.Time) (response, error) {
	if handler.cached != nil && now.Sub(handler.cached.FetchedAt) <= 24*time.Hour {
		result := *handler.cached
		result.Stale = true
		return result, nil
	}
	return response{}, fmt.Errorf("news unavailable")
}

func (handler *Handler) fetch(ctx context.Context) ([]article, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, feedURL, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "application/rss+xml, application/xml, text/xml")
	request.Header.Set("User-Agent", "Signalgen/1.0 (public RSS reader)")
	upstream, err := handler.client.Do(request)
	if err != nil {
		return nil, err
	}
	defer upstream.Body.Close()
	if upstream.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("feed HTTP %d", upstream.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(upstream.Body, maxFeedBytes+1))
	if err != nil || len(body) > maxFeedBytes {
		return nil, fmt.Errorf("feed size or read failure")
	}
	var feed struct {
		XMLName xml.Name `xml:"rss"`
		Channel struct {
			Items []struct {
				Title     string `xml:"title"`
				Link      string `xml:"link"`
				Published string `xml:"pubDate"`
			} `xml:"item"`
		} `xml:"channel"`
	}
	if err := xml.Unmarshal(body, &feed); err != nil {
		return nil, err
	}
	items := make([]article, 0, 24)
	seen := make(map[string]bool)
	for _, item := range feed.Channel.Items {
		link, err := url.Parse(strings.TrimSpace(item.Link))
		title := strings.TrimSpace(item.Title)
		if err != nil || link.Scheme != "https" || link.Host != "www.antaranews.com" || link.User != nil || !strings.HasPrefix(link.Path, "/berita/") || title == "" || seen[link.String()] {
			continue
		}
		seen[link.String()] = true
		runes := []rune(title)
		if len(runes) > 500 {
			title = string(runes[:500])
		}
		row := article{Title: title, URL: link.String()}
		for _, layout := range []string{time.RFC1123Z, time.RFC1123, time.RFC822Z, time.RFC822} {
			if published, err := time.Parse(layout, item.Published); err == nil {
				row.PublishedAt = published.UTC().Format(time.RFC3339)
				break
			}
		}
		items = append(items, row)
		if len(items) == 24 {
			break
		}
	}
	if len(items) == 0 {
		return nil, fmt.Errorf("feed contained no valid articles")
	}
	return items, nil
}
