# Production Lighthouse audit — 2026-08-29

Production URL: <https://mandulaj.hu/>

## Outcome

The production homepage is fast and stable in the median lab run. Desktop is
excellent. Mobile paint metrics are good, but the page still downloads the
desktop graph runtime on phones; that unnecessary third-party JavaScript is the
main performance opportunity. Lighthouse found one accessibility issue: the
document has no `main` landmark.

There is no Chrome UX Report data for this URL, so this report is a lab baseline,
not a claim about real-user Core Web Vitals. Lighthouse cannot measure INP in the
lab; Total Blocking Time (TBT) is reported only as a responsiveness proxy.

## Lighthouse scores

The table uses the median of three clean Lighthouse 13.4.1 navigation runs. The
range is included where performance varied materially.

| Profile | Performance | Accessibility | Best practices | SEO |
| ------- | ----------: | ------------: | -------------: | --: |
| Mobile  |  93 (75–95) |            99 |            100 | 100 |
| Desktop |         100 |            99 |            100 | 100 |

### Performance metrics

| Metric                   | Mobile median (range) | Desktop median (range) | Lab rating                      |
| ------------------------ | --------------------- | ---------------------- | ------------------------------- |
| First Contentful Paint   | 1.19 s (1.13–2.14)    | 0.41 s (0.39–0.41)     | Good                            |
| Largest Contentful Paint | 1.19 s (1.13–6.01)    | 0.41 s (0.39–0.41)     | Good median; one mobile outlier |
| Speed Index              | 1.19 s (1.13–2.65)    | 0.44 s (0.39–0.48)     | Good                            |
| Total Blocking Time      | 268 ms (111–313)      | 31 ms (7–53)           | Mobile needs improvement        |
| Cumulative Layout Shift  | 0.034 (0–0.036)       | 0.003 (0.002–0.003)    | Good                            |
| Time to Interactive      | 6.18 s (6.01–6.22)    | 1.29 s (1.29–1.39)     | Diagnostic only                 |

The third mobile run scored 75 because Lighthouse's simulated LCP rose to
6.01 s. Its directly observed LCP was 1.27 s, and the separate throttled DevTools
trace measured 1.38 s. This is not evidence of a field regression, but the large
simulation swing is a reason to remove the avoidable third-party dependency from
the mobile critical path.

## Direct DevTools traces

These traces complement Lighthouse's simulation with observed navigations.

| Profile | Conditions                                        |  TTFB |    LCP |   CLS |
| ------- | ------------------------------------------------- | ----: | -----: | ----: |
| Mobile  | 390 × 844, DPR 3, touch, Slow 4G, 4× CPU slowdown | 61 ms | 1.38 s | 0.010 |
| Desktop | 1440 × 900, DPR 1, no network throttle, 1× CPU    | 52 ms | 0.14 s | 0.020 |

The mobile LCP was text. Its 1.32 s render delay accounted for 95.6% of LCP;
the server response was not the bottleneck. The small mobile layout shifts came
from web-font swaps and remained well inside the good CLS threshold.

## Verified findings

### P1 — do not load the desktop graph runtime on mobile

The representative mobile run transferred 824,948 bytes in 30 requests. Scripts
were 585,874 bytes, and the two JSDelivr graph libraries alone were 538,003 bytes
(about 65% of the entire transfer):

| Resource |  Transfer | Mobile main-thread time |
| -------- | --------: | ----------------------: |
| PixiJS   | 445,778 B |                  116 ms |
| D3       |  92,225 B |                    5 ms |

PixiJS also produced a 468 ms long task in that run. The graph is configured as
`desktop-only` in `quartz.config.yaml`, and the mobile patch removes its container
before graph initialization. The external graph package nevertheless downloads
D3 and PixiJS before it checks for a container. This explains why the graph is
visually absent on mobile while its transfer and parse cost remain.

Recommended follow-up: make the graph package conditionally load its libraries
only when a graph container exists, or disable the graph entirely. Do not add a
`preconnect` as the primary fix: it would accelerate an unnecessary mobile
download rather than remove it.

**Resolved 2026-08-29.** A local `lazy-graph` wrapper now puts the graph below
Backlinks on every viewport. On phones it renders a **Load graph** button and
does not request D3 or PixiJS until activation; desktop continues to load the
graph automatically. This preserves access while removing the baseline's 538 KB
from an ordinary mobile page load.

### P1 — add one `main` landmark

Accessibility is 99/100 on both profiles. The only failed rule is
`landmark-one-main`: screen-reader users have no `main` navigation landmark.
The accessibility tree otherwise exposes the named site navigation, search,
headings, article, links, and footer.

The relevant wrapper is the `<div class="center">` in
`quartz/components/frames/DefaultFrame.tsx`. Change the appropriate content
wrapper to `<main class="center">` (with exactly one `main` per page), then
regression-test the default, minimal, and full-width frames.

### P2 — remove conflicting cache directives on hashed assets

Production currently returns both revalidation and immutable caching directives
for the same hashed assets. For example:

```text
cache-control: public, max-age=0, must-revalidate, public, max-age=31536000, immutable
```

The same browser session consequently revalidated local hashed CSS, JavaScript,
and fonts with `304` responses. The source is overlapping rules in
`quartz-custom/pages/_headers`: specific immutable rules match the assets, while
the final `/*` rule also appends `max-age=0, must-revalidate`.

Recommended follow-up: restructure the Cloudflare asset-header rules so hashed
assets receive one unambiguous immutable policy and HTML continues to
revalidate. Verify the deployed header with `curl -I` and a repeat-navigation
network trace. Lighthouse estimated no first-load paint savings here; this is a
repeat-visit and correctness improvement.

### P3 — defer broader render-blocking work until after the graph fix

Lighthouse identified the 14 KB compressed site stylesheet plus five very small
local scripts/styles as render-blocking and modeled about 300 ms mobile savings.
The stricter DevTools trace produced an inconsistent 3.69 s estimate even though
the observed LCP was already 1.38 s, so that larger estimate is not used as a
forecast.

The current LCP and CLS pass comfortably. Re-measure after removing the mobile
graph runtime and fixing cache headers before inlining or splitting critical CSS;
otherwise the added complexity is unlikely to be the highest-value change.

## Network and delivery notes

- The representative page load was 805.6 KiB across 30 requests: 19 scripts,
  six fonts, two stylesheets, two other resources, and one document.
- The six self-hosted fonts transferred 196.6 KiB. They caused only 0.010 CLS in
  the throttled trace, so font reduction is optional rather than urgent.
- The HTML response was a Cloudflare cache hit with a 51–61 ms observed TTFB.
- Lighthouse reported 100 for Best Practices and SEO in every run.
- No production CrUX data was available for the page at audit time.

## Method

- Date: 2026-08-29, approximately 15:58–16:04 UTC.
- Lighthouse CLI: 13.4.1, Headless Chrome 151, three clean navigation runs per
  profile with storage reset between runs.
- Mobile Lighthouse: 412 × 823, DPR 1.75, simulated 150 ms RTT,
  1,638.4 Kbit/s throughput, and 4× CPU slowdown.
- Desktop Lighthouse: 1350 × 940, DPR 1, simulated 40 ms RTT, 10,240 Kbit/s
  throughput, and 1× CPU.
- Independent DevTools traces used the conditions listed above and included a
  verbose accessibility-tree snapshot and request inspection.
- Raw Lighthouse JSON was kept outside Git because it is generated, bulky, and
  environment-specific. This document contains the durable baseline.

Reproduce the scored runs with:

```sh
npx --yes lighthouse@13.4.1 https://mandulaj.hu \
  --quiet --chrome-flags="--headless=new" --output=json

npx --yes lighthouse@13.4.1 https://mandulaj.hu \
  --quiet --preset=desktop --chrome-flags="--headless=new" --output=json
```

## References

- [Web Vitals thresholds and field-measurement guidance](https://web.dev/articles/vitals)
- [Chrome DevTools performance profiling](https://developer.chrome.com/docs/devtools/performance)
- [How Lighthouse performance scoring works](https://developer.chrome.com/docs/lighthouse/performance/performance-scoring)
