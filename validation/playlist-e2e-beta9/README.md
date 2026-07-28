# Beta 9 playlist end-to-end validation

This validation exercises the production playlist build path with ten ordinary
human requests. Each request asks for 100 tracks without telling the model how
to structure candidates or how MusicBrainz and Roon work.

`build-fixtures.js` materializes the model-facing candidate pools from the
existing incremental 3,000-recording MusicBrainz corpus. The generated tool
arguments deliberately omit MusicBrainz IDs so the beta 9 resolver must
rediscover canonical identity, run ListenBrainz advisory lookups, discover a
playable Roon result, create the binding and persist the playlist.

The fixture pool is intentionally larger than the requested playlist:

- standard: 125 candidates;
- constrained: 150 candidates;
- exact versions: 160 candidates.

Generated fixtures and run artifacts are retained so later 200-track or larger
tests can extend this baseline instead of repeating completed work.

## Local Roon isolation

The runner uses the separate Roon extension identity
`com.local.roon-ai-bridge.validation-beta9` and stores its database, provider
cache and Roon authorization state under `artifacts/runtime`. It never writes
the playlists into the deployed RoonIA database.

After building the application:

```powershell
pnpm run build
node validation/playlist-e2e-beta9/run-local-e2e.js --probe
pnpm run validate:playlist:e2e
```

The first command may require authorizing **RoonIA Beta 9 Validation** in Roon.
The second command resumes from `artifacts/state.json` and skips completed
playlists. Use `--only=P01` for one playlist or `--force` to rerun a completed
fixture. Use `--roon-timeout-ms=900000` during the initial probe when more time
is needed to authorize the isolated extension.

`artifacts/runtime` is intentionally ignored by Git because it contains the
local Roon pairing state. The auditable state and per-playlist JSON results
remain outside that directory.
