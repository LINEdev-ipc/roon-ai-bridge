const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const appSource = fs.readFileSync(
  path.join(__dirname, "..", "portal", "app.js"),
  "utf8"
);
const styles = fs.readFileSync(
  path.join(__dirname, "..", "portal", "styles.css"),
  "utf8"
);

test("playlist song detail presents canonical metadata as navigable cards", () => {
  const start = appSource.indexOf("canonicalTrackMetadata=function");
  const end = appSource.indexOf("function playlistTrackMatches", start);
  const detail = appSource.slice(start, end);

  assert.ok(start > 0 && end > start);
  assert.match(detail, /metadataCard\("Identidad"/);
  assert.match(detail, /metadataCard\("Publicación"/);
  assert.match(detail, /metadataCard\("Créditos y estilo"/);
  assert.match(detail, /artistLinks\(artist\)/);
  assert.match(detail, /entityLink\("album",album,artist\)/);
  assert.match(appSource, /https:\/\/musicbrainz\.org\//);
  assert.match(appSource, /llm_hints/);
  assert.match(appSource, /playlist_candidate/);
  assert.match(detail, /audio\.duration_seconds\|\|recording\.duration_seconds/);
  assert.match(styles, /\.metadata-card-grid/);
  assert.match(styles, /\.metadata-external-link/);
});

test("playlist rows fall back to the canonical release group and duration", () => {
  const start = appSource.indexOf("playlistTrackRow=function");
  const end = appSource.indexOf("renderPlaylistTrackDetail=function", start);
  const row = appSource.slice(start, end);

  assert.match(row, /audio_metadata\?\.catalog\?\.release_group\?\.title/);
  assert.match(row, /playlistTrackDuration\(track\)/);
});
