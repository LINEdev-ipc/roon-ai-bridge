const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "musicbrainz-roon-binding", "artifacts", "corpus");
const OUTPUT = path.join(__dirname, "fixtures");
const DESIRED = 100;

function rows(file) {
  return fs.readFileSync(file, "utf8").trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
}

function normalize(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function year(value) {
  const parsed = Number(String(value || "").slice(0, 4));
  return Number.isFinite(parsed) ? parsed : null;
}

function hash(seed, value) {
  return crypto.createHash("sha256").update(`${seed}:${value}`).digest("hex");
}

const ELECTRONIC = new Set([
  "air", "aphex twin", "arca", "battles", "bicep", "boards of canada",
  "bonobo", "caribou", "chemical brothers", "daft punk", "depeche mode",
  "dj shadow", "floating points", "flying lotus", "four tet", "goldfrapp",
  "jon hopkins", "kiasmos", "lcd soundsystem", "massive attack", "moderat",
  "moby", "nine inch nails", "portishead", "sophie", "the knife",
  "thievery corporation", "unkle", "yellow magic orchestra", "zero 7"
].map(normalize));

const ACTION = new Set([
  ...ELECTRONIC,
  ...[
    "public enemy", "run the jewels", "kendrick lamar", "pusha t",
    "tyler the creator", "the clash", "green day", "interpol", "nirvana",
    "pearl jam", "arctic monkeys", "bloc party", "linkin park", "radiohead",
    "the prodigy", "muse", "queens of the stone age", "the weeknd"
  ].map(normalize)
]);

const ROCK = new Set([
  "arctic monkeys", "biffy clyro", "big thief", "bloc party", "coldplay",
  "dream theater", "editors", "fiona apple", "florence the machine",
  "green day", "interpol", "linkin park", "muse", "nine inch nails",
  "pearl jam", "radiohead", "run the jewels", "sturgill simpson",
  "the chemical brothers", "the killers", "the strokes", "the white stripes",
  "vampire weekend", "yeah yeah yeahs", "battles", "bon iver", "cat power",
  "deafheaven", "elliott smith", "jason isbell", "king gizzard the lizard wizard",
  "korn", "leonard cohen", "patti smith", "paul mccartney", "phoebe bridgers",
  "sufjan stevens", "tame impala", "waxahatchee", "wolf alice", "ryan adams"
].map(normalize));

const INTERNATIONAL = new Set([
  "a r rahman", "amadou mariam", "angèle", "bebel gilberto", "belchior",
  "bebo valdés diego el cigala", "bts", "buena vista social club",
  "burna boy", "caetano veloso", "café tacvba", "cesária évora",
  "charly garcía", "cornelius", "daler mehndi", "deep forest", "desireless",
  "f x", "fela kuti", "fishmans", "gipsy kings", "gotan project",
  "ichiko aoba", "iu", "joe hisaishi", "jorge ben", "lenine", "maná",
  "mercedes sosa", "mory kanté", "natalia lafourcade", "nena", "neu",
  "ofra haza", "panjabi mc", "rema", "ricky martin", "ryo fukui",
  "salif keita", "serú girán", "soda stereo", "stromae", "tinariwen",
  "tatsuro yamashita", "vanessa paradis", "willie colón", "yellow magic orchestra",
  "youssou n dour", "zaz"
].map(normalize));

const CALM = new Set([
  ...ELECTRONIC,
  ...[
    "alice coltrane", "art blakey the jazz messengers", "c418",
    "cannonball adderley", "christopher larkin", "gustavo santaolalla",
    "howard shore", "ichiko aoba", "joe hisaishi", "john coltrane",
    "miles davis", "ornette coleman", "pharoah sanders", "ryo fukui",
    "the seatbelts", "weather report"
  ].map(normalize)
]);

const METAL = /\b(?:metallica|black sabbath|dream theater|slayer|iron maiden|megadeth|judas priest)\b/i;

const specs = [
  {
    id: "P01",
    prompt: "Crea una playlist de 100 canciones de electrónica con bajos potentes.",
    complexity: "standard",
    multiplier: 1.25,
    filter: (entry) => ELECTRONIC.has(normalize(entry.artist))
  },
  {
    id: "P02",
    prompt: "Haz una playlist de 100 canciones para conducir de noche, con mucha energía y sensación de película de acción.",
    complexity: "constrained",
    multiplier: 1.4,
    filter: (entry) => ACTION.has(normalize(entry.artist))
  },
  {
    id: "P03",
    prompt: "Prepara una playlist de 100 canciones para hacer HIIT en casa mezclando géneros, pero sin metal.",
    complexity: "constrained",
    multiplier: 1.4,
    filter: (entry) => year(entry.release_date) >= 1990 && !METAL.test(entry.artist)
  },
  {
    id: "P04",
    prompt: "Haz una playlist de 100 canciones de rock de los últimos 20 años.",
    complexity: "constrained",
    multiplier: 1.4,
    release_year_from: 2006,
    filter: (entry) => year(entry.release_date) >= 2006 && ROCK.has(normalize(entry.artist))
  },
  {
    id: "P05",
    prompt: "Crea una playlist de 100 canciones internacionales en distintos idiomas para descubrir música de otros países.",
    complexity: "constrained",
    multiplier: 1.4,
    filter: (entry) => INTERNATIONAL.has(normalize(entry.artist))
  },
  {
    id: "P06",
    prompt: "Quiero una playlist de 100 remixes y versiones extendidas conocidas para una fiesta.",
    complexity: "exact_versions",
    multiplier: 1.6,
    filter: (entry) => entry.source_category === "remix"
  },
  {
    id: "P07",
    prompt: "Haz una playlist de 100 grabaciones en directo que transmitan bien la energía del concierto.",
    complexity: "exact_versions",
    multiplier: 1.6,
    filter: (entry) => entry.source_category === "live"
  },
  {
    id: "P08",
    prompt: "Prepara una playlist de 100 canciones acústicas y versiones para una tarde tranquila.",
    complexity: "exact_versions",
    multiplier: 1.6,
    filter: (entry) => entry.source_category === "acoustic" || entry.source_category === "cover"
  },
  {
    id: "P09",
    prompt: "Crea una playlist de 100 clásicos variados de los años 60, 70 y 80.",
    complexity: "standard",
    multiplier: 1.25,
    filter: (entry) => {
      const releaseYear = year(entry.release_date);
      return entry.source_category === "default" && releaseYear >= 1960 && releaseYear <= 1989;
    }
  },
  {
    id: "P10",
    prompt: "Haz una playlist de 100 canciones instrumentales y ambientales para trabajar concentrado.",
    complexity: "constrained",
    multiplier: 1.4,
    filter: (entry) => CALM.has(normalize(entry.artist))
  }
];

function select(pool, spec) {
  const needed = Math.ceil(DESIRED * spec.multiplier);
  const candidates = pool
    .filter(spec.filter)
    .sort((left, right) =>
      hash(spec.id, left.case_id).localeCompare(hash(spec.id, right.case_id))
    );
  const selected = [];
  const recordings = new Set();
  const artistCounts = new Map();
  for (const entry of candidates) {
    if (recordings.has(entry.recording_id)) continue;
    const artistKey = normalize(entry.artist);
    const artistCount = artistCounts.get(artistKey) || 0;
    if (artistCount >= 8) continue;
    recordings.add(entry.recording_id);
    artistCounts.set(artistKey, artistCount + 1);
    selected.push(entry);
    if (selected.length === needed) break;
  }
  if (selected.length < needed) {
    throw new Error(`${spec.id} only has ${selected.length}/${needed} eligible candidates`);
  }
  return selected;
}

function candidate(entry, index, spec) {
  const artists = Array.isArray(entry.artists) && entry.artists.length
    ? entry.artists
    : [entry.artist];
  const intent = entry.source_category === "default"
    ? "standard"
    : entry.source_category;
  return {
    candidate_id: `${spec.id}-${String(index + 1).padStart(3, "0")}`,
    role: index < DESIRED ? "primary" : "reserve",
    title: entry.title,
    artist_credit: artists.join(", "),
    required_credits: artists.slice(0, 12).map((name, artistIndex) => ({
      name,
      role: artistIndex === 0 ? "primary" : "featured"
    })),
    album_hint: entry.album || undefined,
    release_year_hint: year(entry.release_date) || undefined,
    recording_intent: ["live", "remix", "cover", "acoustic", "alternate"].includes(intent)
      ? intent
      : "standard",
    performance_sensitive: entry.source_category === "live",
    user_metadata: {
      validation_case_id: entry.case_id
    }
  };
}

function main() {
  const pool = rows(path.join(ROOT, "cases.jsonl"));
  fs.mkdirSync(OUTPUT, { recursive: true });
  const manifest = specs.map((spec) => {
    const entries = select(pool, spec);
    const payload = {
      prompt_id: spec.id,
      prompt: spec.prompt,
      tool: "roon_save_playlist",
      arguments: {
        name: `Beta 9 ${spec.id}`,
        description: spec.prompt,
        desired_count: DESIRED,
        selection_complexity: spec.complexity,
        ...(spec.release_year_from ? { release_year_from: spec.release_year_from } : {}),
        no_adjacent_same_artist: true,
        tracks: entries.map((entry, index) => candidate(entry, index, spec))
      }
    };
    const file = `${spec.id}.json`;
    fs.writeFileSync(path.join(OUTPUT, file), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    return {
      prompt_id: spec.id,
      prompt: spec.prompt,
      desired_count: DESIRED,
      selection_complexity: spec.complexity,
      candidate_count: entries.length,
      file
    };
  });
  fs.writeFileSync(
    path.join(OUTPUT, "manifest.json"),
    `${JSON.stringify({ generated_at: new Date().toISOString(), playlists: manifest }, null, 2)}\n`,
    "utf8"
  );
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

main();
