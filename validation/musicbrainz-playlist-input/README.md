# LLM → MusicBrainz playlist validation

This incremental corpus measures the part that the 3,000-case binding corpus
did not cover: turning an LLM playlist proposal into one canonical
MusicBrainz recording identity.

Each round stores:

- the playlist prompt;
- the LLM-style structured proposal produced without tools;
- every MusicBrainz query and its raw cached response;
- compact per-strategy outcomes and timings;
- an aggregate report with exact, ambiguous, missing and provider-error cases.

The LLM fields are hypotheses, never trusted facts. MusicBrainz is the source
of truth.

## Candidate schema

- `title`: proposed recording title.
- `primary_artist`: main artist used for identity search.
- `track_artist_credit`: complete display credit proposed by the LLM.
- `featured_artists`: explicit guests, kept separate from the main artist.
- `album`: proposed release or release-group title.
- `album_artist`: proposed album-level artist.
- `year`: proposed first-release year.
- `recording_intent`: `standard`, `live`, `remix`, `edit`, `dub`, `acoustic`,
  `cover` or `alternate`.
- `version_name`: exact named mix/version when the request targets one.
- `genre_context`: why the track fits the playlist; never used as a recording
  version.
- `llm_confidence`: the model's own confidence in the proposed metadata.

## Incremental layout

- `rounds/<round-id>/input.json`: immutable prompts and LLM proposals.
- `rounds/<round-id>/results.jsonl`: raw progressive-search attempts, including
  targeted retries.
- `rounds/<round-id>/evaluated-results.jsonl`: corrected baseline evaluation
  (an earlier conflict is not hidden by a later stricter miss).
- `rounds/<round-id>/album-first-results.jsonl`: optional recovery experiment
  that navigates through a verified release group.
- `rounds/<round-id>/combined-results.jsonl`: one final, auditable result per
  candidate after combining compatible strategies.
- `rounds/<round-id>/executions.jsonl`: execution timings and processed counts.
- `rounds/<round-id>/summary.json`: aggregate baseline and combined metrics.
- `rounds/<round-id>/report.md`: human-readable conclusions and every case.
- `rounds/<round-id>/listenbrainz-results.jsonl`: ACR/ACRR mappings and direct
  MusicBrainz verification for every returned MBID.
- `rounds/<round-id>/listenbrainz-manual-review.json`: explicit adjudication of
  every non-trivial mapper result.
- `rounds/<round-id>/listenbrainz-report.md`: comparison of speed, agreement,
  recoveries and false positives.
- `rounds/<round-id>/mb-strategy-results.jsonl`: candidates returned by the
  alternative MusicBrainz queries for every proposal.
- `rounds/<round-id>/mb-strategy-executions.jsonl`: resumable execution cost
  and request counts for the MusicBrainz strategy experiment.
- `rounds/<round-id>/combined-strategy-evaluated.jsonl`: unified candidate
  ranking from MusicBrainz, ListenBrainz and previous verified results.
- `rounds/<round-id>/combined-strategy-summary.json`: retrieval, ranking,
  threshold and cost metrics.
- `rounds/<round-id>/combined-strategy-reference-v2.json`: incrementally
  expanded set of manually verified recording MBIDs.
- `rounds/<round-id>/combined-strategy-report.md`: conclusions and recommended
  production search cascade.
- `cache/musicbrainz/*.json`: raw response cache shared by every future round.
- `cache/listenbrainz/*.json`: raw ListenBrainz Labs responses shared by future
  rounds.

Run the progressive validation from the repository root after `pnpm run build`:

```powershell
node validation/musicbrainz-playlist-input/run-validation.js `
  validation/musicbrainz-playlist-input/rounds/round-001/input.json
```

Re-run only transient provider failures:

```powershell
node validation/musicbrainz-playlist-input/run-validation.js `
  validation/musicbrainz-playlist-input/rounds/round-001/input.json `
  --retry-provider-errors
```

Run the release-group experiment on unresolved cases and rebuild the report:

```powershell
node validation/musicbrainz-playlist-input/run-album-first.js `
  validation/musicbrainz-playlist-input/rounds/round-001/input.json

node validation/musicbrainz-playlist-input/analyze-results.js `
  validation/musicbrainz-playlist-input/rounds/round-001/input.json
```

Future rounds get a new immutable `rounds/round-NNN/input.json` and reuse the
same cache directory. Existing candidates and provider responses are never
discarded, so larger studies remain incremental.

Run the optional ListenBrainz ACR/ACRR experiment and evaluate its results:

```powershell
node validation/musicbrainz-playlist-input/run-listenbrainz-experiment.js `
  validation/musicbrainz-playlist-input/rounds/round-001/input.json

node validation/musicbrainz-playlist-input/analyze-listenbrainz-experiment.js `
  validation/musicbrainz-playlist-input/rounds/round-001/input.json
```

The experiment forces IPv4 because this workstation's IPv6 route to
ListenBrainz Labs accepts DNS resolution but times out during HTTPS requests.
The runner is resumable and never treats a ListenBrainz mapping as truth: each
returned recording MBID is looked up in MusicBrainz before evaluation.

Run the alternative MusicBrainz searches and the combined ranking:

```powershell
node validation/musicbrainz-playlist-input/run-mb-strategy-experiment.js `
  validation/musicbrainz-playlist-input/rounds/round-001/input.json

node validation/musicbrainz-playlist-input/analyze-combined-search.js `
  validation/musicbrainz-playlist-input/rounds/round-001/input.json
```

The strategy runner is resumable and shares the existing MusicBrainz cache.
The analyzer never promotes a previously unverified result into the reference
set without an explicit decision in
`combined-strategy-manual-review.json`.

## Real-cascade simulation

Round 002 contains three new 20-track playlist prompts and executes only the
recommended cascade: one MusicBrainz word search plus ListenBrainz ACR/ACRR,
followed by targeted MusicBrainz fallbacks for unresolved cases.

```powershell
node validation/musicbrainz-playlist-input/run-real-strategy-simulation.js `
  validation/musicbrainz-playlist-input/rounds/round-002/input.json
```

The runner is resumable. `--prompt=SIM-001` limits a run to one playlist,
`--fallback-only` processes unresolved candidates, and `--reclassify-all`
rebuilds decisions from stored provider responses without network requests.
The round stores progressive results, execution timings, an aggregate summary,
a human-readable report and explicit manual review of every non-exact result.
