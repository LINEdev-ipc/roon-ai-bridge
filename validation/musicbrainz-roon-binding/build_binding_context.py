#!/usr/bin/env python3
"""Derive release-level binding context from cached MusicBrainz responses."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from run_validation import artist_names, norm, read_jsonl, write_jsonl

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def credit_text(entity: dict[str, Any]) -> str:
    return "".join(
        f"{part.get('name') or (part.get('artist') or {}).get('name') or ''}"
        f"{part.get('joinphrase') or ''}"
        for part in entity.get("artist-credit") or []
        if isinstance(part, dict)
    ).strip()


def release_richness(release: dict[str, Any]) -> tuple[int, int]:
    media = release.get("media") or []
    tracks = sum(len(medium.get("tracks") or []) for medium in media)
    return tracks, len(media)


def cached_releases(cache_dir: Path) -> dict[str, dict[str, Any]]:
    releases: dict[str, dict[str, Any]] = {}
    for path in sorted(cache_dir.glob("*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        response = payload.get("response") or {}
        candidates = []
        if response.get("id") and response.get("media") is not None:
            candidates.append(response)
        candidates.extend(response.get("releases") or [])
        for release in candidates:
            release_id = release.get("id")
            if not release_id:
                continue
            current = releases.get(release_id)
            if current is None or release_richness(release) > release_richness(current):
                releases[release_id] = release
    return releases


def find_track(
    release: dict[str, Any],
    case: dict[str, Any],
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    positioned = []
    recording_matches = []
    for medium in release.get("media") or []:
        for track in medium.get("tracks") or []:
            recording = track.get("recording") or {}
            row = (medium, track)
            if (
                int(medium.get("position") or 0)
                == int(case.get("disc_position") or 0)
                and int(track.get("position") or 0)
                == int(case.get("track_position") or 0)
            ):
                positioned.append(row)
            if recording.get("id") == case.get("recording_id"):
                recording_matches.append(row)
    matches = [
        row
        for row in positioned
        if (row[1].get("recording") or {}).get("id") == case.get("recording_id")
    ]
    selected = (matches or recording_matches or positioned)
    return selected[0] if selected else (None, None)


def derive_context(case: dict[str, Any], release: dict[str, Any]) -> dict[str, Any]:
    medium, track = find_track(release, case)
    recording = (track or {}).get("recording") or {}
    media = release.get("media") or []
    release_track_count = sum(len(item.get("tracks") or []) for item in media)
    medium_track_count = len((medium or {}).get("tracks") or [])
    selected_title = (track or {}).get("title") or recording.get("title")
    same_title_tracks = [
        candidate
        for release_medium in media
        for candidate in release_medium.get("tracks") or []
        if norm(
            candidate.get("title")
            or (candidate.get("recording") or {}).get("title")
        )
        == norm(selected_title)
    ]
    same_title_occurrence = next(
        (
            index
            for index, candidate in enumerate(same_title_tracks, 1)
            if candidate is track
        ),
        None,
    )
    title_variants = list(
        dict.fromkeys(
            value
            for value in (
                (track or {}).get("title"),
                recording.get("title"),
                case.get("title"),
            )
            if value
        )
    )
    track_artists = artist_names(track or {}) or artist_names(recording) or case.get(
        "artists"
    ) or [case["artist"]]
    album_artists = artist_names(release)
    return {
        "case_id": case["case_id"],
        "release_id": case["release_id"],
        "release_title": release.get("title") or case["album"],
        "release_artist_credit": credit_text(release),
        "album_artists": album_artists,
        "track_title": (track or {}).get("title"),
        "recording_title": recording.get("title") or case["title"],
        "recording_disambiguation": recording.get("disambiguation") or "",
        "title_variants": title_variants,
        "track_artist_credit": credit_text(track or {}) or credit_text(recording),
        "track_artists": track_artists,
        "disc_position": (medium or {}).get("position") or case.get("disc_position"),
        "track_position": (track or {}).get("position") or case.get("track_position"),
        "track_number": (track or {}).get("number"),
        "same_title_occurrence": same_title_occurrence,
        "same_title_total": len(same_title_tracks) or None,
        "track_length_ms": (track or {}).get("length")
        or recording.get("length")
        or case.get("duration_ms"),
        "medium_format": (medium or {}).get("format"),
        "medium_track_count": medium_track_count or None,
        "release_medium_count": len(media) or None,
        "release_track_count": release_track_count or None,
        "recording_video": recording.get("video") is True,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifacts", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    artifacts = args.artifacts.resolve()
    corpus = read_jsonl(artifacts / "corpus" / "cases.jsonl")
    releases = cached_releases(artifacts / "cache" / "musicbrainz")
    contexts = []
    missing = []
    for case in corpus:
        release = releases.get(case["release_id"])
        if release is None:
            missing.append(case["case_id"])
            continue
        contexts.append(derive_context(case, release))
    output = args.output or artifacts / "corpus" / "binding-context.jsonl"
    write_jsonl(output.resolve(), contexts)
    summary = {
        "corpus_cases": len(corpus),
        "contexts": len(contexts),
        "missing": len(missing),
        "track_title_differs": sum(
            context.get("track_title") != context.get("recording_title")
            for context in contexts
        ),
        "album_artist_differs": sum(
            bool(context.get("album_artists"))
            and not set(context["album_artists"]) & set(context["track_artists"])
            for context in contexts
        ),
        "video_recordings": sum(
            context.get("recording_video") is True for context in contexts
        ),
        "missing_case_ids": missing,
    }
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
