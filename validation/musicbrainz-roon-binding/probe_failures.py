#!/usr/bin/env python3
"""Capture raw Roon evidence for selected unresolved binding cases."""

from __future__ import annotations

import argparse
import difflib
import json
import os
import sys
import urllib.parse
from pathlib import Path
from typing import Any

from run_conflict_validation import api_request, query_ladder
from run_validation import explicit_intent, norm, read_jsonl

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def compact_media(item: dict[str, Any]) -> dict[str, Any]:
    return {
        key: item.get(key)
        for key in (
            "result_id",
            "media_type",
            "title",
            "artist",
            "album_artist",
            "album",
            "artists",
            "subtitle",
            "track_number",
            "disc_number",
            "duration_seconds",
            "version_hint",
            "source",
            "playable",
            "ordered",
            "identity_verified",
        )
        if item.get(key) is not None
    }


def album_similarity(expected: str, actual: str) -> float:
    expected_norm = norm(expected)
    actual_norm = norm(actual)
    if expected_norm == actual_norm:
        return 1.0
    if expected_norm in actual_norm or actual_norm in expected_norm:
        return 0.95
    return difflib.SequenceMatcher(None, expected_norm, actual_norm).ratio()


def probe_case(token: str, case: dict[str, Any], max_albums: int) -> dict[str, Any]:
    enriched = {
        **case,
        "intent": explicit_intent(case["source_category"], case["title"]),
    }
    direct = []
    for query in query_ladder(enriched):
        response = api_request(
            token,
            "/media/search",
            {
                "query": query,
                "types": ["track"],
                "count": 50,
                "source_preference": "highest_quality",
            },
        )
        direct.append(
            {
                "query": query,
                "available_count": response.get("available_counts", {}).get("track"),
                "results": [
                    compact_media(item) for item in (response.get("results") or [])[:15]
                ],
            }
        )

    album_queries = list(
        dict.fromkeys(
            (
                f"{case['album']} {case['artist']}",
                case["album"],
                f"{case['artist']} {case['album']}",
            )
        )
    )
    album_observations = []
    opened = set()
    for query in album_queries:
        response = api_request(
            token,
            "/media/search",
            {
                "query": query,
                "types": ["album"],
                "count": 50,
                "source_preference": "highest_quality",
            },
        )
        albums = response.get("results") or []
        rows = []
        for album in albums[:15]:
            similarity = album_similarity(case["album"], album.get("title") or "")
            row = {
                "similarity": round(similarity, 4),
                "album": compact_media(album),
            }
            result_id = album.get("result_id")
            if (
                result_id
                and similarity >= 0.7
                and result_id not in opened
                and len(opened) < max_albums
            ):
                opened.add(result_id)
                detail = api_request(
                    token,
                    f"/media/{urllib.parse.quote(result_id)}/album-detail?count=300",
                )
                row["detail"] = {
                    "ordered": detail.get("ordered"),
                    "identity_verified": detail.get("identity_verified"),
                    "completeness": detail.get("completeness"),
                    "tracks": [
                        {
                            "ordinal": ordinal,
                            **compact_media(track),
                        }
                        for ordinal, track in enumerate(detail.get("tracks") or [], 1)
                    ],
                }
            rows.append(row)
        album_observations.append(
            {
                "query": query,
                "available_count": response.get("available_counts", {}).get("album"),
                "results": rows,
            }
        )
    artist_observations = []
    for artist_name in list(
        dict.fromkeys(
            artist
            for artist in (
                *(case.get("album_artists") or []),
                case.get("artist"),
            )
            if artist
        )
    ):
        response = api_request(
            token,
            "/media/search",
            {
                "query": artist_name,
                "types": ["artist"],
                "count": 10,
                "source_preference": "highest_quality",
            },
        )
        artists = response.get("results") or []
        rows = []
        for artist in artists[:5]:
            row = {"artist": compact_media(artist)}
            if (
                artist.get("result_id")
                and norm(artist.get("title")) == norm(artist_name)
            ):
                detail = api_request(
                    token,
                    f"/media/{urllib.parse.quote(artist['result_id'])}/releases?count=250",
                )
                row["releases"] = [
                    compact_media(release)
                    for release in detail.get("releases") or []
                ]
            rows.append(row)
        artist_observations.append(
            {
                "query": artist_name,
                "available_count": response.get("available_counts", {}).get("artist"),
                "results": rows,
            }
        )
    return {
        "case_id": case["case_id"],
        "expected": {
            key: case.get(key)
            for key in (
                "title",
                "artist",
                "artists",
                "album",
                "recording_id",
                "release_group_id",
                "release_id",
                "disc_position",
                "track_position",
                "duration_ms",
                "source_category",
            )
        },
        "intent": enriched["intent"],
        "direct": direct,
        "albums": album_observations,
        "artists": artist_observations,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifacts", type=Path, required=True)
    parser.add_argument("--case-id", action="append", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--max-albums", type=int, default=5)
    args = parser.parse_args()
    token = os.environ.get("ROONIA_VALIDATION_TOKEN")
    if not token:
        raise SystemExit("ROONIA_VALIDATION_TOKEN is required")
    corpus = {
        case["case_id"]: case
        for case in read_jsonl(args.artifacts.resolve() / "corpus" / "cases.jsonl")
    }
    contexts = {
        row["case_id"]: row
        for row in read_jsonl(
            args.artifacts.resolve() / "corpus" / "binding-context.jsonl"
        )
    }
    corpus = {
        case_id: {**case, **contexts.get(case_id, {})}
        for case_id, case in corpus.items()
    }
    missing = [case_id for case_id in args.case_id if case_id not in corpus]
    if missing:
        raise SystemExit(f"Unknown case IDs: {', '.join(missing)}")
    observations = []
    for index, case_id in enumerate(args.case_id, 1):
        observations.append(probe_case(token, corpus[case_id], args.max_albums))
        print(
            json.dumps(
                {"phase": "probe", "processed": index, "case_id": case_id},
                ensure_ascii=False,
            ),
            flush=True,
        )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(observations, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
