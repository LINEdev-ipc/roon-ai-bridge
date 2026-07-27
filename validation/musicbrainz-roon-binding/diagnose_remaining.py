#!/usr/bin/env python3
"""Collect read-only Roon evidence for unresolved MusicBrainz bindings."""

from __future__ import annotations

import json
import os
import sys
import urllib.parse
from pathlib import Path
from typing import Any

from run_conflict_validation import api_request, compact_album, compact_track
from run_validation import base_title, norm, read_jsonl

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


QUERY_OVERRIDES = {
    "MBR-000151": [
        "Carry That Weight The Beatles",
        "Carry That Weight The Beatles Remaster",
        "Carry That Weight The Beatles 2009 Remaster",
        "Abbey Road The Beatles 2009 Remaster",
    ],
    "MBR-000259": [
        "I Want You She's So Heavy The Beatles",
        "I Want You She's So Heavy The Beatles Remaster",
        "I Want You She's So Heavy The Beatles 2009 Remaster",
        "Abbey Road The Beatles 2009 Remaster",
    ],
    "MBR-000333": [
        "11 O'Clock Tick Tock U2",
        "11 OClock Tick Tock U2",
        "11 O'Clock Tick Tock U2 Under A Blood Red Sky",
        "Under A Blood Red Sky U2",
    ],
    "MBR-000454": [
        "Voyager Dominique Torti Wild Style Edit Daft Punk",
        "Voyager Daft Punk Daft Club",
        "Daft Club Daft Punk",
    ],
    "MBR-000468": [
        "Breathe On Me Jacques Lu Cont Thin White Duke Britney Spears",
        "Breathe On Me Jaques LuCont Britney Spears",
        "B In The Mix The Remixes Britney Spears",
    ],
    "MBR-000479": [
        "Alejandro Sounds of Arrow Remix Lady Gaga",
        "Alejandro The Sound of Arrows Remix Lady Gaga",
        "The Remix Lady Gaga",
    ],
}


def compact_result(result: dict[str, Any]) -> dict[str, Any]:
    artists = [
        artist.get("title")
        for artist in result.get("artists") or []
        if artist.get("title")
    ]
    return {
        "title": result.get("title"),
        "artist": result.get("artist"),
        "artists": artists,
        "album": result.get("album"),
        "type": result.get("type"),
        "source": result.get("source"),
        "version_hint": result.get("version_hint"),
        "release_type": result.get("release_type"),
        "duration_seconds": result.get("duration_seconds"),
        "track_number": result.get("track_number"),
        "disc_number": result.get("disc_number"),
        "roon_rank": result.get("roon_rank"),
        "match_score": result.get("match_score"),
        "playable": result.get("playable"),
    }


def main() -> None:
    token = os.environ.get("ROONIA_VALIDATION_TOKEN")
    if not token:
        raise SystemExit("ROONIA_VALIDATION_TOKEN is required")
    root = Path(sys.argv[1]).resolve()
    cases = {
        case["case_id"]: case
        for case in read_jsonl(root / "artifacts" / "corpus" / "cases.jsonl")
    }
    report: list[dict[str, Any]] = []
    for case_id, queries in QUERY_OVERRIDES.items():
        case = cases[case_id]
        item: dict[str, Any] = {
            "case_id": case_id,
            "expected": {
                key: case[key]
                for key in ("title", "artist", "album", "intent", "recording_id")
            },
            "searches": [],
        }
        for query in queries:
            search = api_request(
                token,
                "/media/search",
                {
                    "query": query,
                    "types": ["track", "album"],
                    "count": 100,
                    "source_preference": "highest_quality",
                },
            )
            results = search.get("results") or []
            search_item: dict[str, Any] = {
                "query": query,
                "available_counts": search.get("available_counts"),
                "tracks": [
                    compact_result(result)
                    for result in results
                    if result.get("type") == "track"
                ][:30],
                "albums": [],
            }
            for album in [
                result for result in results if result.get("type") == "album"
            ][:12]:
                detail = api_request(
                    token,
                    f"/media/{urllib.parse.quote(album['result_id'])}/album-detail?count=250",
                )
                expected_base = base_title(case["title"])
                related_tracks = [
                    compact_track(track)
                    for track in detail.get("tracks") or []
                    if (
                        base_title(track.get("title")) == expected_base
                        or expected_base in base_title(track.get("title"))
                        or base_title(track.get("title")) in expected_base
                    )
                ]
                search_item["albums"].append(
                    {
                        **compact_album(album),
                        "ordered": detail.get("ordered"),
                        "identity_verified": detail.get("identity_verified"),
                        "track_count": len(detail.get("tracks") or []),
                        "related_tracks": related_tracks,
                        "all_track_titles": [
                            track.get("title") for track in detail.get("tracks") or []
                        ],
                    }
                )
            item["searches"].append(search_item)
        report.append(item)
        print(json.dumps({"diagnosed": case_id}), flush=True)
    output = root / "remaining-diagnostic.json"
    output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(str(output), flush=True)


if __name__ == "__main__":
    main()
