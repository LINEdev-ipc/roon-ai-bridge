# Real LLM playlist validation

This suite validates the complete playlist path from a human prompt to the
deployed RoonIA MCP contract. It is intentionally separate from the curated
MusicBrainz corpus and the deterministic backend regression fixtures.

Rules:

1. Start from an ordinary human prompt.
2. Read only the deployed MCP initialization instructions and tool schema.
3. Generate the tool arguments from model knowledge without searching
   MusicBrainz, ListenBrainz, Roon or the existing validation corpus.
4. Freeze the generated arguments before the first tool call.
5. Never repair or enrich a frozen input after observing its result.
6. Record model generation, MCP execution, provider, binding and total timing
   separately.
7. Replenishment is allowed only when the deployed MCP result requests it.
8. No validation case starts playback.

The first gate is `R01`, a single-artist legacy-discography request for The
Rolling Stones. R02–R10 are frozen real GPT-5.6 Sol tool calls. Their generation
metrics, the first complete R02 runs and the current continuation gate are
documented in `REPORT-2026-07-29.md`.
