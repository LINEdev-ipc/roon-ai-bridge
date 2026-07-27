const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const {
  createDatabase,
  DATABASE_MIGRATION_IDS
} = require("../dist/db/database");

function config(dataDir) {
  return {
    port: 3000,
    portalPort: 3001,
    enablePortal: true,
    nodeEnv: "test",
    logLevel: "error",
    roonExtensionName: "RoonIA Test",
    roonExtensionId: "test.roonia",
    dataDir,
    enableBrowse: true,
    enableMcp: true,
    enableAuth: false,
    apiToken: null,
    portalAdminToken: null,
    publicBaseUrl: "http://localhost:3000",
    portalPublicUrl: "http://localhost:3001",
    oauthIssuer: "http://localhost:3000",
    oauthApprovalPin: null,
    roonStreamingSource: "tidal",
    updateChannel: "beta",
    automaticUpdateChecks: false,
    debugMode: false
  };
}

function withTempDir(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-migrations-"));
  try {
    return run(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("creates a new database from the canonical versioned schema", () => withTempDir((dataDir) => {
  const database = createDatabase(config(dataDir));
  try {
    assert.deepEqual(database.appliedMigrations(), [...DATABASE_MIGRATION_IDS]);
    const tables = database.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((row) => row.name);
    for (const expected of [
      "schema_migrations",
      "virtual_playlists",
      "volume_limits",
      "action_logs",
      "system_events",
      "extension_registry",
      "metadata_provider_cache",
      "catalog_recordings",
      "catalog_artists",
      "catalog_works",
      "catalog_release_groups",
      "catalog_releases",
      "catalog_cover_art",
      "roon_recording_bindings"
    ]) {
      assert.ok(tables.includes(expected), `missing ${expected}`);
    }
  } finally {
    database.close();
  }
}));

test("upgrades the legacy schema without losing existing data", () => withTempDir((dataDir) => {
  const dbPath = path.join(dataDir, "roonia.sqlite");
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`
    CREATE TABLE virtual_playlists (
      playlist_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE api_keys (
      key_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_used_at TEXT,
      revoked_at TEXT
    );
    CREATE TABLE zone_presets (
      preset_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      primary_output_id TEXT NOT NULL,
      output_ids_json TEXT NOT NULL,
      volume_values_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO virtual_playlists (playlist_id, name) VALUES ('legacy-list', 'Legacy List');
    INSERT INTO zone_presets (preset_id, name, primary_output_id, output_ids_json)
      VALUES ('legacy-zone', 'Legacy Zone', 'output-1', '["output-1"]');
  `);
  legacy.close();

  const database = createDatabase(config(dataDir));
  try {
    assert.deepEqual(database.appliedMigrations(), [...DATABASE_MIGRATION_IDS]);
    assert.equal(
      database.db.prepare("SELECT name FROM virtual_playlists WHERE playlist_id = ?").get("legacy-list").name,
      "Legacy List"
    );
    const playlistColumns = database.db.prepare("PRAGMA table_info(virtual_playlists)").all();
    assert.ok(playlistColumns.some((column) => column.name === "cover_image_key"));
    assert.ok(playlistColumns.some((column) => column.name === "last_played_at"));
    const apiKeyColumns = database.db.prepare("PRAGMA table_info(api_keys)").all();
    assert.ok(apiKeyColumns.some((column) => column.name === "tool_permissions_json"));
    const zoneColumns = database.db.prepare("PRAGMA table_info(zone_presets)").all();
    assert.equal(zoneColumns.find((column) => column.name === "primary_output_id").notnull, 0);
    assert.equal(
      database.db.prepare("SELECT primary_output_id FROM zone_presets WHERE preset_id = ?").get("legacy-zone").primary_output_id,
      "output-1"
    );
  } finally {
    database.close();
  }
}));

test("does not reapply recorded migrations on restart", () => withTempDir((dataDir) => {
  const first = createDatabase(config(dataDir));
  first.close();
  const second = createDatabase(config(dataDir));
  try {
    assert.deepEqual(second.appliedMigrations(), [...DATABASE_MIGRATION_IDS]);
    assert.equal(
      second.db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get().count,
      DATABASE_MIGRATION_IDS.length
    );
  } finally {
    second.close();
  }
}));
