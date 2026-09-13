# How the app keeps learning about new releases

The catalogue cannot live inside the app. A film landing on aha on Tuesday would
not reach anyone until the next App Store review, which is the wrong shape for an
app whose whole premise is *what is new this week*.

So the data is published as static files and the app reads them.

```
  GitHub Actions, 02:30 UTC daily
        |
        |  node snapshot.js take      sweep TMDB, ~60s, 11,400 titles
        |  node publish.js            write public/ as JSON
        v
  GitHub Pages  ──►  manifest.json + v1/te.json, v1/hi.json, ...
        |
        v
  The app fetches on launch, caches, renders
```

No server. No TMDB key on the device. A million installs cost the same as one,
because it is files on a CDN.

## Why there is a ledger

TMDB has no *date added to platform* field. `primary_release_date` is the
theatrical date. So TMDB answers "where can I watch this" perfectly and "what is
new on OTT this week" not at all — which is the question this app exists to
answer.

`data/arrivals.json` fills the gap. It holds one line per (title, platform) pair:
the day it first appeared. That line **is** the previous state — a pair in the
ledger but missing from today's sweep has departed, and a pair in today's sweep
but missing from the ledger has just arrived.

The obvious alternative, keeping every daily snapshot and diffing consecutive
pairs, works and costs 1.3 MB a day forever. In git, where deleting the file
later reclaims nothing, that is ~170 MB a year to store one date per title. The
ledger settles at a few hundred KB and changes by a few KB a day.

**The ledger is the asset.** Snapshots are disposable working files and are
gitignored. If the ledger is lost, every arrival date is lost with it and the
archive restarts from zero.

## The bootstrap, stated honestly

The first run records ~13,900 pairs that obviously did not all launch that
morning. They are stored with a **null** date, and the app shows them without
one rather than claiming a launch date that is really just the day we started
watching.

So "This week" means nothing until the archive is a week old. The app says so on
screen — *"Tracking new arrivals since 13 Sept"* — and falls back to the release
date per row. Wikipedia and the news layer in `src/sources.js` cover that window.

## Setup, once

1. Push this repo to GitHub.
2. **Settings → Secrets and variables → Actions** → new secret `TMDB_API_KEY`.
3. **Settings → Pages → Source: GitHub Actions.**
4. Set `PRODUCTION_FEED` in `OTT_APP/src/feed.ts` to the Pages URL.

Public repositories get unlimited Actions minutes. A run is about two minutes, so
even a private repo costs ~60 of the free 2,000 minutes a month.

## Running it by hand

```bash
npm run daily      # sweep + publish
npm run snapshot   # sweep only
npm run publish    # rebuild public/ from the existing ledger
npm run serve      # serve public/ on :8797 for the app in dev
npm test           # 3,277 checks
```

`node snapshot.js take --telugu` sweeps one language for a quick check. It
deliberately **does not** touch the ledger: a partial sweep would see the other
eight languages as missing and record nine thousand false departures.

## The gap that is still open

**ETV Win is in neither TMDB nor Watchmode.** It is the one significant Telugu
platform no tested source covers, and it needs its own answer.
