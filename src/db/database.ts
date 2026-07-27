import fs from "fs";
import path from "path";
import { AppConfig } from "../config/env";

const { DatabaseSync } = require("node:sqlite") as {
  DatabaseSync: new (path: string) => any;
};

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS roon_cores (
  core_id TEXT PRIMARY KEY,
  display_name TEXT,
  last_seen_at TEXT,
  metadata_json TEXT
);

CREATE TABLE IF NOT EXISTS zones_cache (
  zone_id TEXT PRIMARY KEY,
  display_name TEXT,
  state TEXT,
  outputs_json TEXT,
  now_playing_json TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS virtual_playlists (
  playlist_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  cover_image_key TEXT,
  last_played_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS virtual_playlist_tracks (
  track_id TEXT PRIMARY KEY,
  playlist_id TEXT NOT NULL,
  query TEXT NOT NULL,
  roon_item_key TEXT,
  title TEXT,
  artist TEXT,
  album TEXT,
  position INTEGER NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (playlist_id) REFERENCES virtual_playlists (playlist_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS temporary_playlist_lifecycle (
  playlist_id TEXT PRIMARY KEY,
  intent TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (playlist_id) REFERENCES virtual_playlists (playlist_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS play_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  zone_id TEXT,
  title TEXT,
  artist TEXT,
  album TEXT,
  started_at TEXT,
  ended_at TEXT,
  metadata_json TEXT
);

CREATE TABLE IF NOT EXISTS home_history (
  history_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (event_type IN ('search', 'play')),
  media_type TEXT,
  result_id TEXT,
  playlist_id TEXT,
  title TEXT NOT NULL,
  subtitle TEXT,
  image_key TEXT,
  query TEXT,
  zone_id TEXT,
  zone_name TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS command_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  command_type TEXT NOT NULL,
  zone_id TEXT,
  payload_json TEXT,
  result_code TEXT,
  result_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_preferences (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS search_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT NOT NULL,
  results_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS api_keys (
  key_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('read', 'control', 'admin')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TEXT,
  revoked_at TEXT,
  tool_permissions_json TEXT
);

CREATE TABLE IF NOT EXISTS tool_settings (
  tool_name TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS portal_users (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS portal_sessions (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  last_used_at TEXT,
  FOREIGN KEY (user_id) REFERENCES portal_users (user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS zone_presets (
  preset_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  config_json TEXT,
  primary_output_id TEXT,
  output_ids_json TEXT,
  volume_values_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS volume_limits (
  limit_id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_value TEXT NOT NULL,
  name TEXT NOT NULL,
  safe_max REAL NOT NULL,
  schedule_json TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS output_volume_settings (
  output_id TEXT PRIMARY KEY,
  display_name TEXT,
  minimum_value REAL,
  maximum_value REAL,
  preferred_value REAL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS action_logs (
  action_id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  source TEXT NOT NULL,
  tool_or_endpoint TEXT NOT NULL,
  classification_json TEXT NOT NULL,
  arguments_sanitized_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  dry_run INTEGER NOT NULL DEFAULT 0,
  requires_confirmation INTEGER NOT NULL DEFAULT 0,
  confirmed INTEGER NOT NULL DEFAULT 0,
  warnings_json TEXT NOT NULL,
  error_code TEXT,
  correlation_id TEXT
);

CREATE TABLE IF NOT EXISTS system_events (
  event_id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  component TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  details_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS extension_registry (
  extension_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  manager_type TEXT NOT NULL,
  service_name TEXT,
  status TEXT NOT NULL,
  version TEXT,
  config_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS metadata_provider_cache (
  provider TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (provider, cache_key)
);

CREATE TABLE IF NOT EXISTS catalog_recordings (
  recording_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  disambiguation TEXT,
  video INTEGER NOT NULL DEFAULT 0,
  duration_seconds REAL,
  duration_source TEXT,
  isrcs_json TEXT NOT NULL DEFAULT '[]',
  metadata_status TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'musicbrainz',
  fetched_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS catalog_artists (
  artist_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_name TEXT,
  disambiguation TEXT,
  artist_type TEXT,
  country TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  fetched_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS catalog_recording_artists (
  recording_id TEXT NOT NULL,
  artist_id TEXT NOT NULL,
  credit_position INTEGER NOT NULL,
  credited_name TEXT NOT NULL,
  join_phrase TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'primary',
  PRIMARY KEY (recording_id, credit_position),
  FOREIGN KEY (recording_id) REFERENCES catalog_recordings (recording_id) ON DELETE CASCADE,
  FOREIGN KEY (artist_id) REFERENCES catalog_artists (artist_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS catalog_works (
  work_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  work_type TEXT,
  language TEXT,
  iswcs_json TEXT NOT NULL DEFAULT '[]',
  disambiguation TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  fetched_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS catalog_recording_works (
  recording_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  attributes_json TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (recording_id, work_id, relation_type),
  FOREIGN KEY (recording_id) REFERENCES catalog_recordings (recording_id) ON DELETE CASCADE,
  FOREIGN KEY (work_id) REFERENCES catalog_works (work_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS catalog_credits (
  credit_id TEXT PRIMARY KEY,
  recording_id TEXT NOT NULL,
  work_id TEXT,
  artist_id TEXT,
  name TEXT NOT NULL,
  credited_name TEXT,
  role TEXT NOT NULL,
  credit_position INTEGER NOT NULL,
  attributes_json TEXT NOT NULL DEFAULT '[]',
  FOREIGN KEY (recording_id) REFERENCES catalog_recordings (recording_id) ON DELETE CASCADE,
  FOREIGN KEY (work_id) REFERENCES catalog_works (work_id) ON DELETE CASCADE,
  FOREIGN KEY (artist_id) REFERENCES catalog_artists (artist_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS catalog_release_groups (
  release_group_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist_credit_json TEXT NOT NULL DEFAULT '[]',
  first_release_date TEXT,
  primary_type TEXT,
  secondary_types_json TEXT NOT NULL DEFAULT '[]',
  disambiguation TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  fetched_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS catalog_recording_release_groups (
  recording_id TEXT NOT NULL,
  release_group_id TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  selection_reason TEXT,
  PRIMARY KEY (recording_id, release_group_id),
  FOREIGN KEY (recording_id) REFERENCES catalog_recordings (recording_id) ON DELETE CASCADE,
  FOREIGN KEY (release_group_id) REFERENCES catalog_release_groups (release_group_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS catalog_releases (
  release_id TEXT PRIMARY KEY,
  release_group_id TEXT,
  title TEXT NOT NULL,
  release_date TEXT,
  country TEXT,
  status TEXT,
  album_artist TEXT,
  barcode TEXT,
  packaging TEXT,
  labels_json TEXT NOT NULL DEFAULT '[]',
  media_format TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  fetched_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (release_group_id) REFERENCES catalog_release_groups (release_group_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS catalog_release_tracks (
  release_id TEXT NOT NULL,
  recording_id TEXT NOT NULL,
  medium_position INTEGER NOT NULL,
  track_position INTEGER NOT NULL,
  track_number TEXT,
  title TEXT NOT NULL,
  duration_seconds REAL,
  PRIMARY KEY (release_id, recording_id, medium_position, track_position),
  FOREIGN KEY (release_id) REFERENCES catalog_releases (release_id) ON DELETE CASCADE,
  FOREIGN KEY (recording_id) REFERENCES catalog_recordings (recording_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS catalog_genres (
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  name TEXT NOT NULL,
  score INTEGER,
  source TEXT NOT NULL DEFAULT 'musicbrainz',
  PRIMARY KEY (entity_type, entity_id, name)
);

CREATE TABLE IF NOT EXISTS catalog_cover_art (
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  image_id TEXT NOT NULL,
  front INTEGER NOT NULL DEFAULT 0,
  back INTEGER NOT NULL DEFAULT 0,
  approved INTEGER NOT NULL DEFAULT 0,
  original_url TEXT,
  thumbnail_250_url TEXT,
  thumbnail_500_url TEXT,
  thumbnail_1200_url TEXT,
  selected INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'cover_art_archive',
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (entity_type, entity_id, image_id)
);

CREATE TABLE IF NOT EXISTS roon_recording_bindings (
  binding_id TEXT PRIMARY KEY,
  recording_id TEXT NOT NULL,
  roon_item_key TEXT,
  roon_result_id TEXT,
  source TEXT,
  title TEXT NOT NULL,
  artist TEXT,
  album TEXT,
  image_key TEXT,
  quality_json TEXT,
  version_hint TEXT,
  canonical_query TEXT NOT NULL,
  reusable INTEGER NOT NULL DEFAULT 0,
  playable INTEGER NOT NULL DEFAULT 0,
  selection_origin TEXT NOT NULL,
  status TEXT NOT NULL,
  confidence TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  observed_at TEXT NOT NULL,
  last_verified_at TEXT NOT NULL,
  FOREIGN KEY (recording_id) REFERENCES catalog_recordings (recording_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_virtual_playlist_tracks_playlist
  ON virtual_playlist_tracks (playlist_id, position);

CREATE INDEX IF NOT EXISTS idx_temporary_playlist_expiry
  ON temporary_playlist_lifecycle (expires_at);

CREATE INDEX IF NOT EXISTS idx_play_history_zone_started
  ON play_history (zone_id, started_at);

CREATE INDEX IF NOT EXISTS idx_home_history_created
  ON home_history (created_at);

CREATE INDEX IF NOT EXISTS idx_home_history_type_created
  ON home_history (event_type, created_at);

CREATE INDEX IF NOT EXISTS idx_search_cache_query
  ON search_cache (query);

CREATE INDEX IF NOT EXISTS idx_api_keys_active
  ON api_keys (revoked_at, created_at);

CREATE INDEX IF NOT EXISTS idx_portal_sessions_user
  ON portal_sessions (user_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_action_logs_timestamp
  ON action_logs (timestamp);

CREATE INDEX IF NOT EXISTS idx_action_logs_tool
  ON action_logs (tool_or_endpoint, timestamp);

CREATE INDEX IF NOT EXISTS idx_system_events_component
  ON system_events (component, level, timestamp);

CREATE INDEX IF NOT EXISTS idx_metadata_provider_cache_expiry
  ON metadata_provider_cache (provider, expires_at);

CREATE INDEX IF NOT EXISTS idx_catalog_recordings_title
  ON catalog_recordings (title);

CREATE INDEX IF NOT EXISTS idx_catalog_release_groups_title
  ON catalog_release_groups (title);

CREATE INDEX IF NOT EXISTS idx_catalog_credits_recording_role
  ON catalog_credits (recording_id, role);

CREATE INDEX IF NOT EXISTS idx_roonia_bindings_recording
  ON roon_recording_bindings (recording_id, status, last_verified_at);
`;

export const DATABASE_MIGRATION_IDS = [
  "001_base_schema",
  "002_legacy_schema_upgrade",
  "003_metadata_provider_cache",
  "004_music_catalog"
] as const;

export const databaseImplemented = true;

type LegacyPlaylistTrack = {
  track_id?: unknown;
  query?: unknown;
  title?: unknown;
  artist?: unknown;
  album?: unknown;
  position?: unknown;
  created_at?: unknown;
};

type LegacyPlaylist = {
  playlist_id?: unknown;
  name?: unknown;
  description?: unknown;
  tracks?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
};

type LegacyPlaylistStore = {
  playlists?: unknown;
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function asIsoString(value: unknown, fallback: string): string {
  const text = asString(value);
  return text || fallback;
}

function asInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.floor(value)
    : fallback;
}

export class SqliteDatabase {
  readonly db: any;

  private readonly dataDir: string;
  private readonly dbPath: string;
  private readonly legacyPlaylistPath: string;
  private closed = false;

  constructor(config: AppConfig) {
    this.dataDir = config.dataDir;
    this.dbPath = path.join(this.dataDir, "roonia.sqlite");
    this.legacyPlaylistPath = path.join(this.dataDir, "virtual-playlists.json");

    fs.mkdirSync(this.dataDir, { recursive: true });
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.applyMigrations();
    this.migrateLegacyPlaylistsIfNeeded();
  }

  close(): void {
    if (!this.closed && this.db && typeof this.db.close === "function") {
      this.closed = true;
      this.db.close();
    }
  }

  appliedMigrations(): string[] {
    return (this.db
      .prepare("SELECT migration_id FROM schema_migrations ORDER BY migration_id")
      .all() as Array<{ migration_id: string }>)
      .map((row) => row.migration_id);
  }

  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private applyMigrations(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        migration_id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    const applied = new Set(this.appliedMigrations());
    const migrations: Array<{ id: string; apply: () => void }> = [
      { id: DATABASE_MIGRATION_IDS[0], apply: () => this.db.exec(SCHEMA_SQL) },
      { id: DATABASE_MIGRATION_IDS[1], apply: () => this.ensureCurrentSchema() },
      { id: DATABASE_MIGRATION_IDS[2], apply: () => this.ensureMetadataProviderCache() },
      { id: DATABASE_MIGRATION_IDS[3], apply: () => this.ensureMusicCatalog() }
    ];

    for (const migration of migrations) {
      if (applied.has(migration.id)) continue;
      this.transaction(() => {
        migration.apply();
        this.db
          .prepare("INSERT INTO schema_migrations (migration_id) VALUES (?)")
          .run(migration.id);
      });
      applied.add(migration.id);
    }
  }

  private ensureCurrentSchema(): void {
    const playlistColumns = this.db.prepare("PRAGMA table_info(virtual_playlists)").all() as Array<{ name: string }>;
    if (!playlistColumns.some((column) => column.name === "cover_image_key")) {
      this.db.exec("ALTER TABLE virtual_playlists ADD COLUMN cover_image_key TEXT");
    }
    if (!playlistColumns.some((column) => column.name === "last_played_at")) {
      this.db.exec("ALTER TABLE virtual_playlists ADD COLUMN last_played_at TEXT");
    }

    const apiKeyColumns = this.db.prepare("PRAGMA table_info(api_keys)").all() as Array<{ name: string }>;
    if (!apiKeyColumns.some((column) => column.name === "tool_permissions_json")) {
      this.db.exec("ALTER TABLE api_keys ADD COLUMN tool_permissions_json TEXT");
    }

    const zoneColumns = this.db.prepare("PRAGMA table_info(zone_presets)").all() as Array<{ name: string }>;
    const zoneColumnNames = new Set(zoneColumns.map((column) => column.name));
    const addZoneColumn = (name: string, sql: string) => {
      if (!zoneColumnNames.has(name)) this.db.exec(`ALTER TABLE zone_presets ADD COLUMN ${sql}`);
    };
    addZoneColumn("description", "description TEXT");
    addZoneColumn("enabled", "enabled INTEGER NOT NULL DEFAULT 1");
    addZoneColumn("config_json", "config_json TEXT");
    addZoneColumn("primary_output_id", "primary_output_id TEXT");
    addZoneColumn("output_ids_json", "output_ids_json TEXT");
    addZoneColumn("volume_values_json", "volume_values_json TEXT");
    const primaryOutputColumn = zoneColumns.find((column: any) => column.name === "primary_output_id") as any;
    if (primaryOutputColumn?.notnull) {
      this.db.exec(`
        CREATE TABLE zone_presets_migration (
          preset_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          config_json TEXT,
          primary_output_id TEXT,
          output_ids_json TEXT,
          volume_values_json TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO zone_presets_migration (
          preset_id, name, description, enabled, config_json, primary_output_id,
          output_ids_json, volume_values_json, created_at, updated_at
        )
        SELECT
          preset_id, name, description, enabled, config_json, primary_output_id,
          output_ids_json, volume_values_json, created_at, updated_at
        FROM zone_presets;
        DROP TABLE zone_presets;
        ALTER TABLE zone_presets_migration RENAME TO zone_presets;
      `);
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS volume_limits (
        limit_id TEXT PRIMARY KEY,
        target_type TEXT NOT NULL,
        target_value TEXT NOT NULL,
        name TEXT NOT NULL,
        safe_max REAL NOT NULL,
        schedule_json TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS action_logs (
        action_id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        source TEXT NOT NULL,
        tool_or_endpoint TEXT NOT NULL,
        classification_json TEXT NOT NULL,
        arguments_sanitized_json TEXT NOT NULL,
        result_json TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        dry_run INTEGER NOT NULL DEFAULT 0,
        requires_confirmation INTEGER NOT NULL DEFAULT 0,
        confirmed INTEGER NOT NULL DEFAULT 0,
        warnings_json TEXT NOT NULL,
        error_code TEXT,
        correlation_id TEXT
      );

      CREATE TABLE IF NOT EXISTS system_events (
        event_id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        component TEXT NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        details_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS extension_registry (
        extension_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        manager_type TEXT NOT NULL,
        service_name TEXT,
        status TEXT NOT NULL,
        version TEXT,
        config_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tool_settings (
        tool_name TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_action_logs_timestamp
        ON action_logs (timestamp);
      CREATE INDEX IF NOT EXISTS idx_action_logs_tool
        ON action_logs (tool_or_endpoint, timestamp);
      CREATE INDEX IF NOT EXISTS idx_system_events_component
        ON system_events (component, level, timestamp);
    `);
  }

  private ensureMetadataProviderCache(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metadata_provider_cache (
        provider TEXT NOT NULL,
        cache_key TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        PRIMARY KEY (provider, cache_key)
      );
      CREATE INDEX IF NOT EXISTS idx_metadata_provider_cache_expiry
        ON metadata_provider_cache (provider, expires_at);
    `);
  }

  private ensureMusicCatalog(): void {
    this.db.exec(SCHEMA_SQL);
  }

  private migrateLegacyPlaylistsIfNeeded(): void {
    if (!fs.existsSync(this.legacyPlaylistPath)) return;

    const row = this.db
      .prepare("SELECT COUNT(*) AS count FROM virtual_playlists")
      .get() as { count?: number } | undefined;
    if ((row?.count || 0) > 0) return;

    let parsed: LegacyPlaylistStore | null = null;
    try {
      parsed = JSON.parse(fs.readFileSync(this.legacyPlaylistPath, "utf8")) as LegacyPlaylistStore;
    } catch {
      return;
    }

    const playlists = Array.isArray(parsed?.playlists) ? (parsed?.playlists as LegacyPlaylist[]) : [];
    if (playlists.length === 0) return;

    const insertPlaylist = this.db.prepare(`
      INSERT INTO virtual_playlists (playlist_id, name, description, created_at, updated_at)
      VALUES (:playlist_id, :name, :description, :created_at, :updated_at)
    `);
    const insertTrack = this.db.prepare(`
      INSERT INTO virtual_playlist_tracks (
        track_id, playlist_id, query, roon_item_key, title, artist, album, position, metadata_json, created_at
      ) VALUES (
        :track_id, :playlist_id, :query, :roon_item_key, :title, :artist, :album, :position, :metadata_json, :created_at
      )
    `);

    this.transaction(() => {
      for (const rawPlaylist of playlists) {
        const playlistId = asString(rawPlaylist.playlist_id);
        const name = asString(rawPlaylist.name);
        if (!playlistId || !name) continue;

        const createdAt = asIsoString(rawPlaylist.created_at, new Date().toISOString());
        const updatedAt = asIsoString(rawPlaylist.updated_at, createdAt);

        insertPlaylist.run({
          playlist_id: playlistId,
          name,
          description: asString(rawPlaylist.description),
          created_at: createdAt,
          updated_at: updatedAt
        });

        const tracks = Array.isArray(rawPlaylist.tracks) ? (rawPlaylist.tracks as LegacyPlaylistTrack[]) : [];
        for (const [index, rawTrack] of tracks.entries()) {
          const query = asString(rawTrack.query);
          if (!query) continue;

          insertTrack.run({
            track_id: asString(rawTrack.track_id) || `${playlistId}-track-${index + 1}`,
            playlist_id: playlistId,
            query,
            roon_item_key: null,
            title: asString(rawTrack.title),
            artist: asString(rawTrack.artist),
            album: asString(rawTrack.album),
            position: Math.max(1, asInteger(rawTrack.position, index + 1)),
            metadata_json: null,
            created_at: asIsoString(rawTrack.created_at, createdAt)
          });
        }
      }
    });
  }
}

export function createDatabase(config: AppConfig): SqliteDatabase {
  return new SqliteDatabase(config);
}
