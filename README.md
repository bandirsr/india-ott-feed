# Telugu OTT Catalogue

An automated, scraper-free pipeline that answers "which Telugu film is on which
platform, in which language, from what date" — built only from official public
APIs, with no licence fees and no attribution owed on the facts.

```bash
npm test                        # 44 checks, no network needed
node run.js                     # the 10-film sample
node run.js --year 2026         # every film on that year's Wikipedia list
node run.js "Pushpa 2: The Rule"
```

Output lands in `data/*.json`.

## Why this won't break

It is **not a scraper.** It uses the Wikipedia Action API and the Wikidata
SPARQL endpoint, both of which exist so software can reuse the content. So:

- no robots.txt to fall foul of
- no bot detection to evade
- no terms forbidding commercial use of the facts
- **facts aren't copyrightable** — a release date and a platform name are facts,
  so no attribution is owed on them

The obligations are small and the client meets all of them: a descriptive
User-Agent with a contact address (the usual reason people think "Wikipedia
blocked me"), the `maxlag` parameter so we shed load rather than add it, one
request at a time with a 250 ms floor, and proper back-off on 429/503.

**Change the contact address in `src/wikipedia.js` before running at volume.**

## What was tested, and what failed

| Source | Result |
|---|---|
| **Wikipedia Action API** | **Works.** Exact sentences with platform, date and language. The spine of the pipeline. |
| **Wikidata SPARQL** | Works, and is CC0 (no attribution at all) — but a live query of 26 Telugu films returned **zero** streaming platform IDs. Used for credits only, never availability. |
| iTunes Search API | **Dead end.** Zero results for "telugu" and for "Kalki 2898 AD" in the India store. |
| Netflix / ZEE5 / Prime catalogues | Forbidden by their terms, actively blocked, breaks constantly. Not used. |

## Pipeline

1. **Resolve** the film name to a real page title via the search API. Guessing
   titles fails constantly — `HanuMan (film)` does not exist, `Hanu-Man` does.
2. **Extract** the plain-text article and parse availability sentences.
3. **Corroborate** using the page's own citations (`prop=externallinks`) — the
   second source arrives free with the claim. Hanu-Man returns 200+ links
   including OTTplay, Hindustan Times and Deccan Chronicle pieces about the
   streaming release specifically.
4. **Credits** from Wikidata: director, producers, cast, production company, music.
5. **Reconcile** into one row per `(platform, language)`.
6. **Write** JSON. Serve your app from this, never live from the sources.

## Two design decisions that matter

**One row per (platform, language), never per film.** Telugu releases routinely
split: Kalki 2898 AD went to Prime Video in Telugu/Tamil/Malayalam/Kannada and
to Netflix in Hindi. RRR went to ZEE5 in the South languages and Netflix in
Hindi. A one-platform-per-film model is simply wrong for a large share of the
catalogue.

**Platform and date are not equally trustworthy.** A live cross-check on
Hanu-Man found Wikipedia saying 16 March 2024 while news sources said 2 March,
8 March and 22 March. The platform was never in doubt. So:

- `platformConfidence`: `confirmed` (2+ independent sources) or `single-source`
- `dateStatus`: `reported` · `announced` (future) · `disputed` · `unknown`
- `conflictingDates[]` records disagreement instead of letting the last write win

An app that shows a confident wrong date is worse than one saying "streaming on
ZEE5, date unconfirmed".

## Bugs found by running it on real data

Both were invisible until the pipeline ran against live articles:

- **Languages leaked across platforms.** For Kalki 2898 AD, Netflix was credited
  with all five languages when the sentence gives it only Hindi — because
  languages were collected at sentence level. Now attributed per clause, split
  on `while` / `whereas` / `;`. This is the most important field in the dataset,
  so it has its own test file (`test/test-clauses.js`).
- **Junk rows on nearly every film.** A platform mentioned with neither a
  language nor a date (usually YouTube, from a trailer sentence) produced an
  empty availability row. Now filtered, plus promotional sentences — trailer,
  teaser, song, poster — are excluded outright.

## Current results

Ten-film sample: **8 films with availability, 38 rows, 38/38 platform-confirmed.**

Two misses, both honest: `Tillu Square` and `Baahubali 2` phrase their streaming
sections in ways the parser doesn't catch yet. That's a recall gap, not a wrong
answer — and recall is the right thing to trade away, since a missing row is
recoverable and a wrong row destroys trust.

## Posters — the unsolved piece

Everything above is free and attribution-free. Posters are not. A poster is a
copyrighted work owned by the production company, and a studio wanting publicity
is not the same as a studio granting a licence.

Ranked by how well they actually work:

1. **YouTube official trailer thumbnails** — YouTube Data API v3, free, 10,000
   quota units/day (a search costs 100, a video read costs 1). The production
   house uploaded the trailer itself, so the artwork is publisher-published
   promotional material, served through an official API, displayed as a link
   back to the video. Best fit by a distance. Needs an API key.
2. **Amazon Creators API as a registered Associate** — official artwork with
   permission, plus affiliate commission. You may not re-host the images, and
   note PA-API 5.0 is being retired on 15 May 2026 in favour of the Creators
   API. Their terms also forbid using the content to train or improve ML models.
3. **Written permission from the production houses** — for Telugu this is
   genuinely tractable: a few hundred films a year across a manageable number of
   studios, all of whom benefit from the promotion. This is the route that makes
   the artwork actually yours. It needs to be real written permission, not an
   assumption of goodwill.
4. **TMDB with a commercial licence** — $149/month under $1M revenue, images
   included.
5. **Your own generated title cards** — zero rights risk, weakest visually.

Ruled out: **OMDb** (CC BY-NC 4.0, non-commercial only, posters behind Patreon),
**Wikipedia film posters** (non-free fair-use uploads, not reusable), and
**hotlinking platform CDNs** (breaks constantly and is still someone's asset).

## Files

```
run.js                 the pipeline
src/wikipedia.js       Action API client — throttling, maxlag, back-off
src/wikidata.js        SPARQL for credits (CC0)
src/extract.js         prose to structured claims
src/validate.js        scoring and reconciliation
test/test-extract.js   30 checks against verbatim real sentences
test/test-clauses.js   14 checks on per-clause language attribution
data/                  output
```
