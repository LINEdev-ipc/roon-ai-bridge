# MusicBrainz ↔ Roon binding validation

This directory is the resumable validation corpus for the automatic track
binding research. It is deliberately separate from production code.

## Persistent artifacts

- `corpus/cases.jsonl`: immutable numbered cases. Existing cases are never
  regenerated when the target grows from 500 to 1,500 or more.
- `cache/musicbrainz/*.json`: raw MusicBrainz responses keyed by request URL.
- `runs/<run-id>/results.jsonl`: one compact Roon observation per corpus case.
- `runs/<run-id>/summary.json`: aggregate rates and failure examples.
- `conflict-runs/<run-id>/`: targeted rechecks of previously unresolved cases.
- `enhanced-runs/<run-id>/`: evidence-based full runs, including resumable
  progress and the final baseline.
- `targeted-runs/<run-id>/`: incremental reruns restricted to unresolved
  cases from an earlier result set.
- `corpus/binding-context.jsonl`: MusicBrainz recording, release-track,
  artist-credit, position, repeated-title ordinal, medium and video context
  derived from the cached source responses.
- `corpus/manual-fallback-expectations.json`: frozen, case-specific catalog
  gaps that were demonstrated by targeted Roon probes and must not be forced
  into an automatic binding. Related cases can share an evidence group, but
  every case ID remains explicit.
- `state.json`: current corpus size, last run and next case number.
- `representative_specs.py`: curated source matrix used to extend cases 501
  onward across catalog type, cohort, language and era.
- `audit_pool.py`: cached MusicBrainz capacity and unresolved-spec audit.
- `analyze_enhanced_run.py`: repeatable classification of unresolved bindings.

MusicBrainz is the metadata source of truth. Its cached responses are reused.
Roon searches can be repeated because the available catalog and its ranking
can change. No validation command starts playback or mutates a playlist.

## Run on the RoonIA LXC

The script expects `ROONIA_VALIDATION_TOKEN` in the environment. Read the token
inside the LXC and never copy it into the corpus or back to the workstation.

```bash
export ROONIA_VALIDATION_TOKEN="$(sudo sed -n 's/^API_TOKEN=//p' /opt/roon-ai-bridge/.env | head -n1)"
python3 run_validation.py --target 500 --output-root ./artifacts
```

The evidence-based validator first tries a direct query ladder and only opens a
verified Roon album tracklist when the direct result is insufficient:

```bash
python3 run_enhanced_validation.py \
  --artifacts ./artifacts \
  --output-root ./artifacts/enhanced-runs
```

It checkpoints every ten cases. To continue an interrupted run:

```bash
python3 run_enhanced_validation.py \
  --artifacts ./artifacts \
  --output-root ./artifacts/enhanced-runs \
  --resume-run <run-id>
```

To repeat only the unresolved, eligible rows from an earlier result file:

```bash
python3 run_enhanced_validation.py \
  --artifacts ./artifacts \
  --output-root ./artifacts/targeted-runs \
  --source-results <results.jsonl>
```

To resume an interrupted targeted run without repeating saved cases:

```bash
bash resume_targeted.sh <run-id> <source-results.jsonl>
```

To grow the corpus, keep the existing artifact directory and increase the
target. `--target 1500` retains cases 1–500, and `--target 3000` retains cases
1–1,500. Existing numbered rows are never regenerated.

To build the incremental MusicBrainz corpus without running the legacy Roon
evaluator:

```bash
python3 run_validation.py \
  --target 3000 \
  --build-only \
  --output-root ./artifacts
```

The target-specific source quotas are enforced. At 3,000, selection also caps
the complete corpus at ten rows per release group and twenty per primary
artist without removing existing rows. A missing category raises an error
instead of silently filling it with easier default tracks. Run
`audit_pool.py --target 3000` first to validate both raw capacity and the
capped projection.

## Interpretation

The enhanced policy uses the following evidence order:

1. Exact MusicBrainz title and artist against a direct Roon search.
2. The same identity with release context when the variant requires it.
3. A generic remaster fallback for an original request. Remixes, edits, live
   recordings and alternates remain disallowed substitutes.
4. An ordered, identity-verified Roon album tracklist whose album, artist and
   track are compatible with the MusicBrainz release context.

Named variants tolerate conservative metadata aliases, such as singular versus
plural remixer names, but do not collapse distinct mix names. An explicit
`edit` is classified as `edit`, even if MusicBrainz categorizes its release
group broadly as `Remix`.

The final outcome is intentionally explicit:

- `resolved`: a Roon candidate passed the evidence policy and supplies the
  reproducible binding.
- `manual_required`: the exact recording could not be proven automatically,
  and a previously investigated, case-specific catalog gap sends it to the
  existing manual Roon search instead of substituting another version.
- `ineligible`: the MusicBrainz recording is a video and therefore cannot
  receive an audio-only Roon binding.
- `unresolved`: an unexpected failure. A complete baseline is not accepted
  while this count is non-zero.

A resolved binding still does not prove an exact MusicBrainz release edition
because Roon search does not expose barcode, catalog number, country or
MusicBrainz identifiers. The recording identity remains MusicBrainz's; Roon
contributes only the reproducible binding.

## Current baseline

The accepted 3,000-case baseline is
`enhanced-runs/20260727T192441Z`:

- 2,896 automatic bindings.
- 83 investigated manual fallbacks.
- 21 video recordings excluded from audio binding.
- 0 unresolved cases and 0 request errors.
- 3,000/3,000 safe decisions.

The 79-case repair run is `targeted-runs/20260727T191939Z`: 21 automatic
bindings, 58 manual fallbacks and no unresolved cases. See `STATUS.md` and
`artifacts/probes/20260727-3000-conflict-research.md` for the evidence.
