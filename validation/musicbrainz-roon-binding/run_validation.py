#!/usr/bin/env python3
"""Build and run an incremental MusicBrainz-to-Roon validation corpus."""

from __future__ import annotations

import argparse
import collections
import datetime as dt
import difflib
import hashlib
import json
import os
import random
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from representative_specs import REPRESENTATIVE_SPECS
from representative_specs_3000 import REPRESENTATIVE_SPECS_3000

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


SPECS = [
    ("default", "L.A. Woman", "The Doors"),
    ("default", "Are You Experienced", "The Jimi Hendrix Experience"),
    ("default", "Electric Ladyland", "The Jimi Hendrix Experience"),
    ("default", "Machine Head", "Deep Purple"),
    ("default", "Hotel California", "Eagles"),
    ("default", "Aftermath", "The Rolling Stones"),
    ("default", "Paranoid", "Black Sabbath"),
    ("default", "Who's Next", "The Who"),
    ("default", "The Wall", "Pink Floyd"),
    ("default", "Boston", "Boston"),
    ("default", "Thriller", "Michael Jackson"),
    ("default", "Rumours", "Fleetwood Mac"),
    ("default", "Abbey Road", "The Beatles"),
    ("default", "Nevermind", "Nirvana"),
    ("default", "OK Computer", "Radiohead"),
    ("default", "The Dark Side of the Moon", "Pink Floyd"),
    ("default", "Back in Black", "AC/DC"),
    ("default", "Kind of Blue", "Miles Davis"),
    ("default", "Blue", "Joni Mitchell"),
    ("default", "What's Going On", "Marvin Gaye"),
    ("default", "Purple Rain", "Prince and The Revolution"),
    ("default", "The Miseducation of Lauryn Hill", "Lauryn Hill"),
    ("default", "Discovery", "Daft Punk"),
    ("default", "Random Access Memories", "Daft Punk"),
    ("default", "The Rise and Fall of Ziggy Stardust and the Spiders From Mars", "David Bowie"),
    ("default", "Hounds of Love", "Kate Bush"),
    ("default", "Songs in the Key of Life", "Stevie Wonder"),
    ("default", "Master of Puppets", "Metallica"),
    ("default", "Dookie", "Green Day"),
    ("default", "Automatic for the People", "R.E.M."),
    ("default", "Un verano sin ti", "Bad Bunny"),
    ("default", "El mal querer", "Rosalía"),
    ("default", "Motomami", "Rosalía"),
    ("default", "Bocanada", "Gustavo Cerati"),
    ("default", "Canción animal", "Soda Stereo"),
    ("default", "Re", "Café Tacvba"),
    ("default", "Clandestino", "Manu Chao"),
    ("default", "A Rush of Blood to the Head", "Coldplay"),
    ("default", "21", "Adele"),
    ("default", "Lemonade", "Beyoncé"),
    ("default", "Trans-Europe Express", "Kraftwerk"),
    ("default", "Homogenic", "Björk"),
    ("default", "Dummy", "Portishead"),
    ("default", "To Pimp a Butterfly", "Kendrick Lamar"),
    ("default", "The College Dropout", "Kanye West"),
    ("default", "Illmatic", "Nas"),
    ("default", "The Low End Theory", "A Tribe Called Quest"),
    ("default", "Back to Black", "Amy Winehouse"),
    ("default", "Grace", "Jeff Buckley"),
    ("default", "The Joshua Tree", "U2"),
    ("live", "Live at Leeds", "The Who"),
    ("live", "Made in Japan", "Deep Purple"),
    ("live", "At Folsom Prison", "Johnny Cash"),
    ("live", "Stop Making Sense", "Talking Heads"),
    ("live", "Live at the Apollo", "James Brown"),
    ("live", "MTV Unplugged in New York", "Nirvana"),
    ("live", "Live/Dead", "Grateful Dead"),
    ("live", "Frampton Comes Alive!", "Peter Frampton"),
    ("live", "Pulse", "Pink Floyd"),
    ("live", "Alive!", "KISS"),
    ("live", "Live at Wembley '86", "Queen"),
    ("live", "Under a Blood Red Sky", "U2"),
    ("remix", "Daft Club", "Daft Punk"),
    ("remix", "Reanimation", "Linkin Park"),
    ("remix", "Further Down the Spiral", "Nine Inch Nails"),
    ("remix", "Y34RZ3R0R3M1X3D", "Nine Inch Nails"),
    ("remix", "You Can Dance", "Madonna"),
    ("remix", "Blood on the Dance Floor: HIStory in the Mix", "Michael Jackson"),
    ("remix", "J to tha L-O!: The Remixes", "Jennifer Lopez"),
    ("remix", "The Remix", "Lady Gaga"),
    ("remix", "Remixes 81–04", "Depeche Mode"),
    ("remix", "B in the Mix: The Remixes", "Britney Spears"),
    ("remix", "Love", "The Beatles"),
    ("cover", "Garage Inc.", "Metallica"),
    ("cover", "Pin Ups", "David Bowie"),
    ("cover", "Renegades", "Rage Against the Machine"),
    ("cover", "The Spaghetti Incident?", "Guns N’ Roses"),
    ("cover", "Kisses on the Bottom", "Paul McCartney"),
]

SOURCE_CATEGORY_TARGETS_1500 = {
    "default": 790,
    "live": 210,
    "remix": 240,
    "cover": 90,
    "acoustic": 80,
    "alternate": 90,
}
SOURCE_CATEGORY_TARGETS_3000 = {
    "default": 1570,
    "live": 350,
    "remix": 390,
    "cover": 260,
    "acoustic": 210,
    "alternate": 220,
}
MAX_RELEASE_GROUP_CASES_3000 = 10
MAX_ARTIST_CASES_3000 = 20

MB_HEADERS = {
    "Accept": "application/json",
    "User-Agent": "RoonIAValidation/0.2 (https://github.com/LINEdev-ipc/roon-ai-bridge)",
}
DASHES = str.maketrans({"‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-", "−": "-"})
NUMBER_WORDS = {
    "one": "1",
    "un": "1",
    "uno": "1",
    "una": "1",
    "two": "2",
    "dos": "2",
    "three": "3",
    "tres": "3",
}


def norm(value: str | None) -> str:
    value = (value or "").translate(DASHES)
    value = value.replace("'", "").replace("’", "").replace("‘", "").replace("`", "")
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower()
    value = re.sub(r"\b(pt|part)\.?\s*([0-9]+)\b", r"part \2", value)
    value = re.sub(r"[^a-z0-9]+", " ", value).strip()
    return " ".join(NUMBER_WORDS.get(token, token) for token in value.split())


def artist_names(entity: dict[str, Any]) -> list[str]:
    names = []
    for part in entity.get("artist-credit") or []:
        if isinstance(part, dict):
            artist = part.get("artist") or {}
            name = artist.get("name") or part.get("name")
            if name:
                names.append(name)
    return names


def cache_path(cache_dir: Path, url: str) -> Path:
    return cache_dir / f"{hashlib.sha256(url.encode()).hexdigest()}.json"


def mb_get(cache_dir: Path, entity: str, params: dict[str, Any]) -> dict[str, Any]:
    url = "https://musicbrainz.org/ws/2/" + entity + "?" + urllib.parse.urlencode(params)
    path = cache_path(cache_dir, url)
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))["response"]
    last_error: Exception | None = None
    for attempt in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=MB_HEADERS), timeout=60) as response:
                payload = json.load(response)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(
                json.dumps({"url": url, "fetched_at": dt.datetime.now(dt.timezone.utc).isoformat(), "response": payload}, ensure_ascii=False),
                encoding="utf-8",
            )
            time.sleep(1.1)
            return payload
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as error:
            last_error = error
            time.sleep(2 + attempt * 2)
    raise RuntimeError(f"MusicBrainz request failed: {last_error}")


def choose_release_group(data: dict[str, Any], category: str, album: str, artist: str) -> dict[str, Any] | None:
    rows = data.get("release-groups") or []
    exact = [row for row in rows if norm(row.get("title")) == norm(album) and norm(" ".join(artist_names(row))) == norm(artist)]
    if not exact:
        exact = [row for row in rows if norm(row.get("title")) == norm(album) and norm(artist) in norm(" ".join(artist_names(row)))]
    if not exact:
        return None

    def key(row: dict[str, Any]) -> tuple[Any, ...]:
        secondary = {norm(item) for item in row.get("secondary-types") or []}
        if category == "live":
            desired = 0 if "live" in secondary else 1
        elif category == "remix":
            desired = 0 if "remix" in secondary else 1
        elif category == "default":
            desired = 0 if not ({"live", "remix", "compilation"} & secondary) else 1
        else:
            desired = 0
        return desired, row.get("first-release-date") or "9999", -int(row.get("score") or 0)

    return sorted(exact, key=key)[0]


def official_release(cache_dir: Path, release_group_id: str) -> tuple[dict[str, Any] | None, list[tuple[dict[str, Any], dict[str, Any], dict[str, Any]]]]:
    data = mb_get(cache_dir, "release", {"release-group": release_group_id, "inc": "recordings+artist-credits+media", "fmt": "json", "limit": 100})
    choices = []
    for release in data.get("releases") or []:
        if norm(release.get("status")) != "official":
            continue
        tracks = []
        for medium in release.get("media") or []:
            for track in medium.get("tracks") or []:
                recording = track.get("recording") or {}
                if recording.get("id") and recording.get("title"):
                    tracks.append((medium, track, recording))
        if tracks:
            choices.append((release, tracks))
    if not choices:
        return None, []
    choices.sort(key=lambda item: (item[0].get("date") or "9999", len(item[1]), item[0].get("country") or "ZZ"))
    return choices[0]


def explicit_intent(source_category: str, title: str) -> str:
    if source_category in {"live", "cover", "acoustic", "alternate"}:
        return source_category
    text = f" {norm(title)} "
    if source_category == "remix":
        # An explicitly named edit is not interchangeable with a remix. The
        # release group category is broader than the recording title.
        if " edit " in text or " radio version " in text:
            return "edit"
        if any(word in text for word in (" remix ", " mix ", " rework ", " dub ", " version ")):
            return "remix"
        # A release group can be classified as Remix while containing new
        # songs, transitions or retitled versions. Keep these as an exact
        # release-context request instead of falsely labelling every track a
        # remix.
        return "specific_version"
    if (
        " live " in text
        or re.search(
            r"[\[(]\s*(?:ao\s+vivo|en\s+vivo|en\s+directo)\b",
            title,
            flags=re.I,
        )
    ):
        return "live"
    if " remix " in text or " rework " in text:
        return "remix"
    # Some releases (notably Aphex Twin's Syro) identify the requested mix
    # only inside a title descriptor. Do not treat an unrelated word "mix"
    # in the main title as proof of remix intent.
    if re.search(
        r"(?:[\[(][^\])]*\bmix\b[^\])]*[\])]|(?:-|–|—)\s*[^\r\n]*\bmix\b[^\r\n]*)\s*$",
        title,
        flags=re.I,
    ):
        return "remix"
    if " edit " in text or " radio version " in text:
        return "edit"
    if (
        " acoustic " in text
        or " acustico " in text
        or " unplugged " in text
    ):
        return "acoustic"
    if any(word in text for word in (" demo ", " alternate ", " alternative ", " outtake ", " rehearsal ")):
        return "alternate"
    return "default"


def build_pool(cache_dir: Path) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    pool: list[dict[str, Any]] = []
    unresolved = []
    legacy_specs = [
        {
            "category": category,
            "album": album,
            "artist": artist,
            "cohort": "legacy_initial",
            "language": "mixed",
            "era": "mixed",
        }
        for category, album, artist in SPECS
    ]
    all_specs = legacy_specs + REPRESENTATIVE_SPECS + REPRESENTATIVE_SPECS_3000
    for index, spec_row in enumerate(all_specs, 1):
        category = spec_row["category"]
        album = spec_row["album"]
        artist = spec_row["artist"]
        escaped_album = album.replace('"', '\\"')
        escaped_artist = artist.replace('"', '\\"')
        query = f'releasegroup:"{escaped_album}" AND artist:"{escaped_artist}" AND primarytype:album'
        try:
            search = mb_get(cache_dir, "release-group", {"query": query, "fmt": "json", "limit": 10})
            release_group = choose_release_group(search, category, album, artist)
            if not release_group:
                unresolved.append({"album": album, "artist": artist, "reason": "release_group_not_found"})
                continue
            release, tracks = official_release(cache_dir, release_group["id"])
            if not release:
                unresolved.append({"album": album, "artist": artist, "reason": "official_tracklist_not_found"})
                continue
            for medium, track, recording in tracks:
                artists = artist_names(recording) or artist_names(release)
                if not artists:
                    continue
                pool.append(
                    {
                        "recording_id": recording["id"],
                        "title": recording["title"],
                        "artist": artists[0],
                        "artists": artists,
                        "album": release_group.get("title") or album,
                        "release_group_id": release_group["id"],
                        "release_id": release.get("id"),
                        "release_date": release.get("date"),
                        "country": release.get("country"),
                        "track_position": track.get("position"),
                        "disc_position": medium.get("position"),
                        "duration_ms": recording.get("length") or track.get("length"),
                        "intent": explicit_intent(category, recording["title"]),
                        "source_category": category,
                        "cohort": spec_row["cohort"],
                        "language": spec_row["language"],
                        "era": spec_row["era"],
                        "dataset_generation": spec_row.get(
                            "dataset_generation",
                            (
                                "initial_500"
                                if spec_row["cohort"] == "legacy_initial"
                                else "representative_1500"
                            ),
                        ),
                    }
                )
        except Exception as error:  # Keep the rest of the corpus usable.
            unresolved.append({"album": album, "artist": artist, "reason": f"{type(error).__name__}: {error}"})
        if index % 10 == 0:
            print(json.dumps({"phase": "dataset", "processed_specs": index, "pool": len(pool), "unresolved": len(unresolved)}), flush=True)
    unique = {}
    for case in pool:
        unique.setdefault((case["recording_id"], case["intent"]), case)
    return list(unique.values()), unresolved


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n" for row in rows), encoding="utf-8")


def balanced_rows(rows: list[dict[str, Any]], seed: int) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str, str], list[dict[str, Any]]] = collections.defaultdict(list)
    for row in rows:
        grouped[
            (
                row.get("cohort") or "unknown",
                row.get("language") or "unknown",
                row.get("era") or "unknown",
            )
        ].append(row)
    randomizer = random.Random(seed)
    for values in grouped.values():
        randomizer.shuffle(values)
    keys = sorted(grouped)
    randomizer.shuffle(keys)
    ordered = []
    while keys:
        remaining = []
        for key in keys:
            values = grouped[key]
            if values:
                ordered.append(values.pop())
            if values:
                remaining.append(key)
        keys = remaining
    return ordered


def extend_corpus(existing: list[dict[str, Any]], pool: list[dict[str, Any]], target: int) -> list[dict[str, Any]]:
    if len(existing) >= target:
        return existing
    used = {case["recording_id"] for case in existing}
    available = [case for case in pool if case["recording_id"] not in used]
    by_source: dict[str, list[dict[str, Any]]] = collections.defaultdict(list)
    for case in available:
        by_source[case["source_category"]].append(case)

    selected = list(existing)
    counts = collections.Counter(case["source_category"] for case in selected)
    release_group_counts = collections.Counter(
        case["release_group_id"] for case in selected
    )
    artist_counts = collections.Counter(norm(case["artist"]) for case in selected)
    desired = (
        SOURCE_CATEGORY_TARGETS_3000
        if target >= 3000
        else SOURCE_CATEGORY_TARGETS_1500
        if target >= 1500
        else {
            "default": 320,
            "live": 80,
            "remix": 80,
            "cover": 20,
        }
    )

    def can_select(case: dict[str, Any]) -> bool:
        if target < 3000:
            return True
        release_group_id = case["release_group_id"]
        artist = norm(case["artist"])
        return (
            release_group_counts[release_group_id] < MAX_RELEASE_GROUP_CASES_3000
            and artist_counts[artist] < MAX_ARTIST_CASES_3000
        )

    def add_case(case: dict[str, Any]) -> None:
        selected.append(case)
        counts[case["source_category"]] += 1
        release_group_counts[case["release_group_id"]] += 1
        artist_counts[norm(case["artist"])] += 1

    for category, wanted in desired.items():
        rows = balanced_rows(by_source[category], 20260727 + len(category))
        while rows and len(selected) < target and counts[category] < wanted:
            case = rows.pop(0)
            if can_select(case):
                add_case(case)
        if target >= 1500 and counts[category] < wanted:
            raise RuntimeError(
                f"Only {counts[category]} cases available for source category "
                f"{category}; target quota is {wanted}"
            )
    selected_recordings = {item["recording_id"] for item in selected}
    leftovers = [
        case
        for category, rows in by_source.items()
        for case in balanced_rows(rows, 20260727 + len(category))
        if case["recording_id"] not in selected_recordings
    ]
    for case in leftovers:
        if len(selected) >= target:
            break
        if can_select(case):
            add_case(case)
    if len(selected) < target:
        raise RuntimeError(f"Only {len(selected)} unique cases available; add more album specifications before target {target}")
    for index, case in enumerate(selected, 1):
        case["case_id"] = f"MBR-{index:06d}"
    return selected


def base_title(value: str | None) -> str:
    value = (value or "").translate(DASHES)
    # Roon sometimes prefixes a slash-separated live performance with
    # "Medley:" while MusicBrainz stores the same recording without it.
    if "/" in value:
        value = re.sub(r"^\s*medley\s*:\s*", "", value, flags=re.I)
    # Remove only a version suffix that starts at this bracket. Earlier
    # semantic parentheses such as "(Reprise)" or "(Is by Your Side)" stay.
    suffix = re.search(
        r"\s*[\[(]\s*(?:(?:\d{4}\s*(?:/|-)\s*)?(?:live|ao\s+vivo|en\s+vivo|en\s+directo|remix|remaster(?:ed)?|edit|radio|acoustic|ac[uú]stic[oa]|unplugged|demo|alternate|alternative|outtake|session|rehearsal|mono|stereo|dub|rework|feat\.?))\b.*$",
        value,
        flags=re.I,
    )
    if suffix:
        value = value[: suffix.start()]
    value = re.sub(r"\s*[\[(]\s*transition\s*[\])]\s*$", "", value, flags=re.I)
    value = re.sub(
        r"\s+-\s+.*(?:live|ao\s+vivo|en\s+vivo|en\s+directo|remix|mix|remaster|edit|version).*$",
        "",
        value,
        flags=re.I,
    )
    normalized = norm(value)
    # Archival session titles often gain a recording date in Roon while
    # MusicBrainz keeps the same take name without it.
    normalized = re.sub(
        r"\b\d{1,2}\s+\d{1,2}\s+\d{2,4}\b",
        " ",
        normalized,
    )
    return re.sub(r"\s+", " ", normalized).strip()


def title_compatible(expected: str, actual: str) -> bool:
    expected_base, actual_base = base_title(expected), base_title(actual)
    if expected_base == actual_base:
        return True
    # A few catalogues preserve both the short title and its article-prefixed
    # form, e.g. "Carioca (The Carioca)". Accept only this exact,
    # self-repeating shape; arbitrary parenthetical subtitles remain distinct.
    article_alias = re.fullmatch(r"\s*([^()]+)\s*\(([^()]+)\)\s*", actual)
    if article_alias:
        short_title = norm(article_alias.group(1))
        long_title = norm(article_alias.group(2))
        expected_norm = norm(expected)
        if (
            long_title == expected_norm
            and re.sub(r"^(?:the|a|an)\s+", "", long_title) == short_title
        ):
            return True
    if len(expected_base) >= 4 and actual_base.startswith(expected_base + " "):
        return len(actual_base.split()) - len(expected_base.split()) <= 8
    if len(actual_base) >= 5 and expected_base.startswith(actual_base + " "):
        return len(expected_base.split()) - len(actual_base.split()) <= 3
    return difflib.SequenceMatcher(None, expected_base, actual_base).ratio() >= 0.92


def candidate_variant(candidate: dict[str, Any]) -> str:
    text = f" {norm(candidate.get('title'))} "
    hint = candidate.get("version_hint") or "unknown"
    if hint == "live" or any(
        marker in text
        for marker in (" live ", " ao vivo ", " en vivo ", " en directo ")
    ):
        return "live"
    if hint == "remix" or any(word in text for word in (" remix ", " rework ", " dub ", " club mix ")):
        return "remix"
    if hint == "edit" or " edit " in text or " radio version " in text:
        return "edit"
    if (
        " acoustic " in text
        or " acustico " in text
        or " unplugged " in text
    ):
        return "acoustic"
    if hint == "cover" or " cover " in text or " karaoke " in text:
        return "cover"
    if (
        hint == "alternate"
        and " lp version " not in text
        and " album version " not in text
    ):
        return "alternate"
    if any(word in text for word in (" demo ", " alternate ", " outtake ", " session ", " rehearsal ", " concerto ")):
        return "alternate"
    return "default"


def variant_compatible(case: dict[str, Any], candidate: dict[str, Any]) -> bool:
    intent = case["intent"]
    observed = candidate_variant(candidate)
    exact_named_variant = norm(case["title"]) == norm(candidate.get("title"))
    if intent == "default":
        return observed == "default"
    if intent == "cover":
        # A cover release may itself contain a specifically named session.
        # The exact full title proves that identity even if Roon classifies
        # the row as an alternate/session rather than as a cover.
        return observed in {"default", "cover"} or exact_named_variant
    if intent == "remix":
        expected = norm(case["title"])
        actual = norm(candidate.get("title"))
        album = norm(case.get("album"))
        evidence = (
            observed == "remix"
            or any(word in f" {expected} {actual} " for word in (" remix ", " mix ", " rework ", " dub ", " version ", " transition "))
            or (album and album in actual)
            or ("/" in case["title"] and "/" in (candidate.get("title") or ""))
        )
        return observed == "remix" or (title_compatible(case["title"], candidate.get("title") or "") and evidence)
    if intent == "specific_version":
        actual_album = norm(candidate.get("album"))
        expected_album = norm(case.get("album"))
        actual_title = norm(candidate.get("title"))
        # Roon normally omits the album here. Only call this strong when the
        # exact release context is nevertheless present in the candidate.
        return bool(expected_album and (actual_album == expected_album or expected_album in actual_title))
    if intent == "alternate":
        title = f" {norm(case['title'])} "
        explicitly_named = any(
            word in title
            for word in (
                " demo ",
                " alternate ",
                " alternative ",
                " outtake ",
                " rehearsal ",
                " session ",
                " take ",
                " taped ",
                " insert ",
                " continued ",
                " part ",
                " pts ",
            )
        )
        named_identity = title_compatible(
            case["title"],
            candidate.get("title") or "",
        )
        if case.get("source_category") == "alternate" and not explicitly_named:
            return observed == "alternate"
        return observed == "alternate" or (
            explicitly_named and named_identity
        )
    if intent == "edit":
        return observed == "edit" or exact_named_variant
    if intent == "acoustic":
        title = f" {norm(case['title'])} "
        explicitly_named = any(
            marker in title
            for marker in (" acoustic ", " acustico ", " unplugged ")
        )
        candidate_title = f" {norm(candidate.get('title'))} "
        candidate_explicitly_acoustic = (
            " acoustic " in candidate_title
            or " acustico " in candidate_title
            or " unplugged " in candidate_title
        )
        archival_take = " take " in title or " session " in title
        if case.get("source_category") == "acoustic" and not explicitly_named:
            return observed == "acoustic" or (
                (archival_take or candidate_explicitly_acoustic)
                and title_compatible(
                    case["title"],
                    candidate.get("title") or "",
                )
            )
        return observed == "acoustic" or exact_named_variant
    return observed == intent


def query_for(case: dict[str, Any]) -> str:
    query = f"{case['title']} {case['artist']}"
    if case["intent"] == "live":
        query += " live"
    elif case["intent"] == "remix":
        title = f" {norm(case['title'])} "
        if not any(word in title for word in (" remix ", " mix ", " rework ", " dub ", " version ")):
            query += f" {case['album']}"
    elif case["intent"] == "specific_version":
        query += f" {case['album']}"
    elif case["intent"] in {"edit", "acoustic", "alternate"}:
        query += f" {case['intent']}"
    return query


def roon_search(token: str, query: str) -> dict[str, Any]:
    payload = json.dumps({"query": query, "types": ["track"], "count": 25, "source_preference": "highest_quality"}).encode()
    request = urllib.request.Request(
        "http://localhost:3000/roon/media/search",
        data=payload,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        return json.load(response)


def compact_candidate(candidate: dict[str, Any]) -> dict[str, Any]:
    return {
        "title": candidate.get("title"),
        "artists": [artist.get("title") for artist in candidate.get("artists") or []],
        "album": candidate.get("album"),
        "version_hint": candidate.get("version_hint"),
        "roon_rank": candidate.get("roon_rank"),
        "match_score": candidate.get("match_score"),
        "source": candidate.get("source"),
    }


def compatible_candidates(case: dict[str, Any], candidates: list[dict[str, Any]]) -> list[tuple[int, dict[str, Any]]]:
    return [row for row in identity_candidates(case, candidates) if variant_compatible(case, row[1])]


def identity_candidates(case: dict[str, Any], candidates: list[dict[str, Any]]) -> list[tuple[int, dict[str, Any]]]:
    expected_artists = {norm(artist) for artist in case["artists"]}
    matches = []
    for position, candidate in enumerate(candidates, 1):
        roon_artists = {norm(artist) for artist in candidate.get("artists") or [] if artist}
        # Live Roon responses contain {title}; persisted compact responses
        # contain plain strings. Support both representations.
        if not roon_artists:
            roon_artists = {
                norm(artist.get("title"))
                for artist in candidate.get("artists") or []
                if isinstance(artist, dict) and artist.get("title")
            }
        if expected_artists & roon_artists and title_compatible(case["title"], candidate.get("title") or ""):
            matches.append((position, candidate))
    return matches


def evaluate_case(token: str, case: dict[str, Any]) -> dict[str, Any]:
    query = query_for(case)
    response = roon_search(token, query)
    candidates = response.get("results") or []
    compact = [compact_candidate(candidate) for candidate in candidates]
    selected_rows = compatible_candidates(case, compact)
    selected = selected_rows[0] if selected_rows else None
    return {
        "case_id": case["case_id"],
        "query": query,
        "intent": case["intent"],
        "available_count": response.get("available_counts", {}).get("track"),
        "compatible_position": selected[0] if selected else None,
        "compatible_candidate": selected[1] if selected else None,
        "candidates": compact,
    }


def summarize(corpus: list[dict[str, Any]], results: list[dict[str, Any]], unresolved: list[dict[str, str]]) -> dict[str, Any]:
    by_case = {case["case_id"]: case for case in corpus}
    groups: dict[str, dict[str, int]] = collections.defaultdict(
        lambda: {
            "total": 0,
            "top1": 0,
            "top5": 0,
            "top10": 0,
            "top25": 0,
            "unresolved": 0,
            "variant_unverified": 0,
            "variant_conflict": 0,
            "candidate_missing": 0,
        }
    )
    failures = []
    for result in results:
        group = groups[result["intent"]]
        group["total"] += 1
        position = result["compatible_position"]
        if position is None:
            group["unresolved"] += 1
            case = by_case[result["case_id"]]
            identity = identity_candidates(case, result.get("candidates") or [])
            if not identity:
                group["candidate_missing"] += 1
            elif result["intent"] in {"remix", "specific_version"} and candidate_variant(identity[0][1]) == "default":
                group["variant_unverified"] += 1
            else:
                group["variant_conflict"] += 1
            if len(failures) < 50:
                failures.append({"case_id": result["case_id"], "intent": result["intent"], "expected": {key: case[key] for key in ("title", "artist", "album", "recording_id")}, "query": result["query"], "identity_candidate_position": identity[0][0] if identity else None, "identity_candidate_variant": candidate_variant(identity[0][1]) if identity else None, "top": result["candidates"][:3]})
            continue
        for limit, key in ((1, "top1"), (5, "top5"), (10, "top10"), (25, "top25")):
            if position <= limit:
                group[key] += 1
    overall = {
        key: sum(group[key] for group in groups.values())
        for key in ("total", "top1", "top5", "top10", "top25", "unresolved", "variant_unverified", "variant_conflict", "candidate_missing")
    }

    def with_rates(row: dict[str, int]) -> dict[str, Any]:
        total = row["total"] or 1
        return {**row, **{f"{key}_pct": round(100 * row[key] / total, 2) for key in ("top1", "top5", "top10", "top25")}}

    return {
        "schema_version": 1,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "overall": with_rates(overall),
        "by_intent": {intent: with_rates(row) for intent, row in sorted(groups.items())},
        "dataset": {"cases": len(corpus), "release_groups": len({case["release_group_id"] for case in corpus}), "distribution": dict(collections.Counter(case["intent"] for case in corpus)), "unresolved_specs": unresolved},
        "failure_examples": failures,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", type=int, default=500)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--reevaluate-run", help="Re-evaluate a stored run without network access")
    parser.add_argument(
        "--build-only",
        action="store_true",
        help="Extend the cached MusicBrainz corpus without querying Roon",
    )
    args = parser.parse_args()

    root = args.output_root.resolve()
    cache_dir = root / "cache" / "musicbrainz"
    corpus_path = root / "corpus" / "cases.jsonl"
    existing = read_jsonl(corpus_path)
    previous_corpus_size = len(existing)
    if args.reevaluate_run:
        source_dir = root / "runs" / args.reevaluate_run
        stored = read_jsonl(source_dir / "results.jsonl")
        for case in existing:
            case["intent"] = explicit_intent(case["source_category"], case["title"])
        write_jsonl(corpus_path, existing)
        by_case = {case["case_id"]: case for case in existing}
        reevaluated = []
        for result in stored:
            case = by_case[result["case_id"]]
            selected_rows = compatible_candidates(case, result.get("candidates") or [])
            selected = selected_rows[0] if selected_rows else None
            reevaluated.append({**result, "intent": case["intent"], "compatible_position": selected[0] if selected else None, "compatible_candidate": selected[1] if selected else None})
        run_id = args.reevaluate_run + "-reevaluated-v2"
        run_dir = root / "runs" / run_id
        write_jsonl(run_dir / "results.jsonl", reevaluated)
        source_summary = json.loads((source_dir / "summary.json").read_text(encoding="utf-8"))
        unresolved_specs = source_summary.get("dataset", {}).get("unresolved_specs", [])
        summary = summarize(existing, reevaluated, unresolved_specs)
        (run_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
        state = json.loads((root / "state.json").read_text(encoding="utf-8"))
        state.update({"last_run_id": run_id, "last_run_completed_at": summary["generated_at"]})
        (root / "state.json").write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
        print("FINAL_SUMMARY " + json.dumps(summary, ensure_ascii=False, separators=(",", ":")), flush=True)
        return

    token = os.environ.get("ROONIA_VALIDATION_TOKEN")
    if not token:
        raise SystemExit("ROONIA_VALIDATION_TOKEN is required")
    pool, unresolved = build_pool(cache_dir)
    corpus = extend_corpus(existing, pool, args.target)
    if len(corpus) > previous_corpus_size and previous_corpus_size:
        snapshot_path = (
            root
            / "corpus"
            / "snapshots"
            / f"cases-{previous_corpus_size}-before-{len(corpus)}.jsonl"
        )
        if not snapshot_path.exists():
            write_jsonl(snapshot_path, existing)
    write_jsonl(corpus_path, corpus)
    print(json.dumps({"phase": "corpus_complete", "cases": len(corpus), "distribution": dict(collections.Counter(case["intent"] for case in corpus)), "cached_mb_responses": len(list(cache_dir.glob("*.json")))}), flush=True)
    if args.build_only:
        state_path = root / "state.json"
        state = (
            json.loads(state_path.read_text(encoding="utf-8"))
            if state_path.exists()
            else {"schema_version": 1}
        )
        state.update(
            {
                "corpus_size": len(corpus),
                "next_case_number": len(corpus) + 1,
                "last_corpus_build_completed_at": dt.datetime.now(
                    dt.timezone.utc
                ).isoformat(),
                "musicbrainz_cache_entries": len(list(cache_dir.glob("*.json"))),
            }
        )
        state_path.write_text(
            json.dumps(state, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(
            "BUILD_SUMMARY "
            + json.dumps(
                {
                    "cases": len(corpus),
                    "source_categories": dict(
                        collections.Counter(
                            case["source_category"] for case in corpus
                        )
                    ),
                    "intents": dict(
                        collections.Counter(case["intent"] for case in corpus)
                    ),
                    "cohorts_501_plus": dict(
                        collections.Counter(
                            case.get("cohort") or "unknown"
                            for case in corpus[500:]
                        )
                    ),
                    "languages_501_plus": dict(
                        collections.Counter(
                            case.get("language") or "unknown"
                            for case in corpus[500:]
                        )
                    ),
                    "eras_501_plus": dict(
                        collections.Counter(
                            case.get("era") or "unknown"
                            for case in corpus[500:]
                        )
                    ),
                    "incremental_segment": {
                        "first_case_id": (
                            corpus[previous_corpus_size]["case_id"]
                            if previous_corpus_size < len(corpus)
                            else None
                        ),
                        "cases": max(0, len(corpus) - previous_corpus_size),
                        "release_groups": len(
                            {
                                case["release_group_id"]
                                for case in corpus[previous_corpus_size:]
                            }
                        ),
                        "artists": len(
                            {
                                norm(case["artist"])
                                for case in corpus[previous_corpus_size:]
                            }
                        ),
                        "source_categories": dict(
                            collections.Counter(
                                case["source_category"]
                                for case in corpus[previous_corpus_size:]
                            )
                        ),
                        "cohorts": dict(
                            collections.Counter(
                                case.get("cohort") or "unknown"
                                for case in corpus[previous_corpus_size:]
                            )
                        ),
                        "languages": dict(
                            collections.Counter(
                                case.get("language") or "unknown"
                                for case in corpus[previous_corpus_size:]
                            )
                        ),
                        "eras": dict(
                            collections.Counter(
                                case.get("era") or "unknown"
                                for case in corpus[previous_corpus_size:]
                            )
                        ),
                    },
                    "unresolved_specs": unresolved,
                },
                ensure_ascii=False,
                separators=(",", ":"),
            ),
            flush=True,
        )
        return

    run_id = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_dir = root / "runs" / run_id
    results = []
    for index, case in enumerate(corpus, 1):
        try:
            results.append(evaluate_case(token, case))
        except Exception as error:
            results.append({"case_id": case["case_id"], "query": query_for(case), "intent": case["intent"], "available_count": None, "compatible_position": None, "compatible_candidate": None, "candidates": [], "request_error": f"{type(error).__name__}: {error}"})
        if index % 25 == 0:
            print(json.dumps({"phase": "roon", "processed": index, "compatible": sum(result["compatible_position"] is not None for result in results)}), flush=True)
    write_jsonl(run_dir / "results.jsonl", results)
    summary = summarize(corpus, results, unresolved)
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    state = {"schema_version": 1, "corpus_size": len(corpus), "next_case_number": len(corpus) + 1, "last_run_id": run_id, "last_run_completed_at": summary["generated_at"], "musicbrainz_cache_entries": len(list(cache_dir.glob("*.json")))}
    (root / "state.json").write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    print("FINAL_SUMMARY " + json.dumps(summary, ensure_ascii=False, separators=(",", ":")), flush=True)


if __name__ == "__main__":
    main()
