# News extension

## Direction contract

THESIS: A compact research page for official IDX videos and article discovery, not a synthetic news wall.

OWN-WORLD: Signalgen's existing Manrope, semantic light/dark surfaces, green selection, shared controls and gutters. No identity replacement.

STORY: The first verified IDX public-expose video's YouTube preview loads on opening the page. Selecting another video immediately switches its preview, without autoplay. Users can play it or open its original page, then browse headlines from ANTARA's official Bursa RSS through the local Go News API.

FIRST VIEWPORT: One inset, rounded video viewer with a padded selection list, followed by an attributed article ledger. Both use user-requested macOS-style title bars with decorative traffic-light dots and Video/Newspaper icons. No source/how-it-works explanatory prose; publisher attribution and publication time remain on articles. Mobile stacks the video and selection.

FORM: User-requested news page in the incumbent workspace. Code-led ordinary extension, no comp or shipping raster. No API keys or env changes. Videos curated from the official feed on 7 October 2026, not represented as an automatically refreshed feed.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Sources and limitations

- Official channel: https://www.youtube.com/channel/UCXyfYHdOPLUgxMndSwf9tHg, linked by IDX's terms page. Video IDs verified from its public Atom feed.
- Official ANTARA RSS directory: https://www.antaranews.com/rss explicitly provides public RSS feeds; Bursa source: https://www.antaranews.com/rss/ekonomi-bursa.xml. Only headlines, publication time and original article links are displayed; no full article bodies or fabricated news.
- Go exposes a fixed-source `/api/news` endpoint, avoiding browser CORS and arbitrary URL proxying. Five-minute cache, one-minute failure cooldown, eight-second upstream timeout, one concurrent refresh, one MiB response bound, and 24 articles maximum. Cached real headlines remain visible during failures for up to 24 hours, explicitly marked stale.
- Verified 8 October 2026: local endpoint HTTP 200 with 20 real publisher headlines. Five isolated Go race tests and seven frontend news tests pass. Provider uptime is not guaranteed; no production SLA is implied.
