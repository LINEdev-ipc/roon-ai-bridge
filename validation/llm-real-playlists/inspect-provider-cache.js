const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");

function argument(name, fallback = null) {
  const prefix = `--${name}=`;
  const value = process.argv.find((entry) => entry.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

const databasePath = path.resolve(argument("db"));
const titles = String(argument("titles", ""))
  .split("|")
  .map((title) => title.trim())
  .filter(Boolean);
if (!databasePath || !titles.length) {
  throw new Error("Use --db=<roonia.sqlite> --titles=<title|title>");
}

const database = new DatabaseSync(databasePath, { readOnly: true });
const rows = database.prepare(
  `SELECT cache_key, entity_type, status, payload_json
   FROM metadata_provider_cache
   WHERE provider = 'musicbrainz'
     AND entity_type = 'recording_resolution'`
).all();

for (const title of titles) {
  const normalizedTitle = title.toLocaleLowerCase();
  const matches = rows.flatMap((row) => {
    const payload = JSON.parse(row.payload_json);
    if (!JSON.stringify(payload).toLocaleLowerCase().includes(normalizedTitle)) return [];
    return [{
      cache_key: row.cache_key,
      entity_type: row.entity_type,
      status: row.status,
      resolution: {
        status: payload.status,
        reason: payload.reason,
        candidates: payload.candidates,
        trace: payload.trace
      }
    }];
  });
  process.stdout.write(`${JSON.stringify({ title, matches }, null, 2)}\n`);
}
