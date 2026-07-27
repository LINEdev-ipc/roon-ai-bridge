#!/usr/bin/env python3
"""Resolve stored binding conflicts through Roon album tracklists."""

from __future__ import annotations

import argparse
import collections
import datetime as dt
import difflib
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from run_validation import (
    base_title,
    candidate_variant,
    compact_candidate,
    explicit_intent,
    norm,
    read_jsonl,
    title_compatible,
    variant_compatible,
    write_jsonl,
)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

VERIFIED_RELEASE_GROUPS: dict[
    str,
    list[tuple[dict[str, Any], dict[str, Any]]],
] = collections.defaultdict(list)
EXHAUSTED_RELEASE_GROUPS: set[str] = set()


def api_request(token: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    headers = {"Authorization": f"Bearer {token}"}
    data = None
    method = "GET"
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload).encode()
        method = "POST"
    request = urllib.request.Request(
        "http://localhost:3000/roon" + path,
        data=data,
        headers=headers,
        method=method,
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


ALBUM_EDITION_TOKENS = {
    "anniversary",
    "deluxe",
    "edition",
    "edicion",
    "expanded",
    "live",
    "mtv",
    "remaster",
    "remastered",
    "version",
    "versao",
}


def album_title_match_strength(
    expected: str,
    actual: str,
    expected_artists: list[str] | None = None,
) -> str | None:
    expected_norm = norm(expected)
    actual_norm = norm(actual)
    if actual_norm == expected_norm:
        return "strict"
    expected_tokens = expected_norm.split()
    actual_tokens = actual_norm.split()
    if actual_norm.startswith(expected_norm + " "):
        suffix = actual_tokens[len(expected_tokens) :]
        if suffix and set(suffix) <= ALBUM_EDITION_TOKENS:
            return "strict"
    if expected_norm.startswith(actual_norm + " "):
        suffix = expected_tokens[len(actual_tokens) :]
        if suffix and set(suffix) <= ALBUM_EDITION_TOKENS:
            return "strict"
    # Latin American MTV releases are sometimes reduced by Roon to the
    # generic commercial title "Unplugged". Treat this only as a release-shape
    # candidate: artist, ordered track count and position must still prove it.
    if actual_norm == "unplugged" and expected_norm.endswith("mtv unplugged"):
        return "release_shape_required"
    # Roon sometimes prefixes a self-identifying release with the artist,
    # e.g. "Shakira MTV Unplugged". Only remove a prefix/suffix whose tokens
    # are fully explained by the verified MusicBrainz album artist.
    artist_tokens = {
        token
        for artist in expected_artists or []
        for token in norm(artist).split()
    }
    if artist_tokens and expected_norm in actual_norm:
        remaining = actual_norm.replace(expected_norm, " ", 1).split()
        if remaining and set(remaining) <= artist_tokens:
            return "strict"
    family_noise = ALBUM_EDITION_TOKENS | {
        "ao",
        "em",
        "vivo",
    } | artist_tokens
    expected_core = [
        token for token in expected_tokens if token not in family_noise
    ]
    actual_core = [
        token for token in actual_tokens if token not in family_noise
    ]
    if (
        expected_core
        and actual_core
        and (
            expected_core == actual_core
            or (
                expected_core[0] == actual_core[0]
                and (
                    set(expected_core) < set(actual_core)
                    or set(actual_core) < set(expected_core)
                )
            )
        )
    ):
        return "release_shape_required"
    return None


def album_title_compatible(
    expected: str,
    actual: str,
    expected_artists: list[str] | None = None,
) -> bool:
    return album_title_match_strength(expected, actual, expected_artists) is not None


def album_artist_compatible(case: dict[str, Any], album: dict[str, Any]) -> bool:
    expected = {
        norm(artist)
        for artist in case.get("album_artists") or case["artists"]
        if artist
    }
    observed = {
        norm(artist.get("title"))
        for artist in album.get("artists") or []
        if isinstance(artist, dict) and artist.get("title")
    }
    observed.update(
        norm(value)
        for value in (
            album.get("artist"),
            album.get("album_artist"),
            album.get("subtitle"),
        )
        if value
    )
    return artist_sets_compatible(expected, observed) or any(
        left == right
        or (len(left) >= 4 and left in right)
        or (len(right) >= 4 and right in left)
        for left in expected
        for right in observed
    )


def compact_album(album: dict[str, Any]) -> dict[str, Any]:
    return {
        "title": album.get("title"),
        "artist": album.get("artist"),
        "album_artist": album.get("album_artist"),
        "artists": [
            artist.get("title") if isinstance(artist, dict) else artist
            for artist in album.get("artists") or []
            if artist
        ],
        "source": album.get("source"),
        "version_hint": album.get("version_hint"),
        "release_type": album.get("release_type"),
        "roon_rank": album.get("roon_rank"),
    }


def compact_track(track: dict[str, Any]) -> dict[str, Any]:
    return {
        "result_id": track.get("result_id"),
        "roon_item_key": track.get("roon_item_key"),
        "title": track.get("title"),
        "artist": track.get("artist"),
        "artists": [
            artist.get("title") if isinstance(artist, dict) else artist
            for artist in track.get("artists") or []
            if artist
        ],
        "album": track.get("album"),
        "album_artist": track.get("album_artist"),
        "version_hint": track.get("version_hint"),
        "track_number": track.get("track_number"),
        "disc_number": track.get("disc_number"),
        "duration_seconds": track.get("duration_seconds"),
        "source": track.get("source"),
        "playable": track.get("playable"),
    }


def main_title(value: str | None) -> str:
    return norm(re.split(r"\s*[\[(]", value or "", maxsplit=1)[0])


def variant_descriptors(value: str | None) -> str:
    raw = value or ""
    groups = [
        group
        for group in re.findall(r"[\[(]([^\])]+)[\])]", raw)
        if not re.match(r"\s*(?:feat|featuring|with)\b", group, flags=re.I)
    ]
    dash = re.search(
        r"\s+-\s+(.+\b(?:remix|mix|edit|version|extended|dub|rework)\b.*)$",
        raw,
        flags=re.I,
    )
    if dash:
        groups.append(dash.group(1))
    return norm(" ".join(groups))


def descriptor_key(value: str | None) -> str:
    tokens = []
    for token in variant_descriptors(value).split():
        if token in {
            "the",
            "of",
            "remix",
            "mix",
            "version",
            "edit",
            "extended",
            "radio",
            "new",
            "remaster",
            "remastered",
        }:
            continue
        if len(token) > 4 and token.endswith("s"):
            token = token[:-1]
        tokens.append(token)
    return "".join(tokens)


def named_variant_title_compatible(expected: str, actual: str) -> bool:
    if title_compatible(expected, actual):
        return True
    if main_title(expected) != main_title(actual):
        return False
    expected_key = descriptor_key(expected)
    actual_key = descriptor_key(actual)
    return bool(
        expected_key
        and actual_key
        and difflib.SequenceMatcher(None, expected_key, actual_key).ratio() >= 0.9
    )


def case_title_compatible(
    case: dict[str, Any],
    actual: str,
    *,
    album_context: bool = False,
) -> bool:
    if album_context:
        expected_titles = case.get("title_variants") or [case["title"]]
    else:
        expected_titles = [
            case.get("recording_title") or case["title"],
            case["title"],
        ]
    expected_titles = list(dict.fromkeys(title for title in expected_titles if title))
    occurrence = int(case.get("same_title_occurrence") or 0)
    total = int(case.get("same_title_total") or 0)
    if occurrence and total > 1:
        actual_base = base_title(actual)
        if any(
            actual_base == f"{base_title(expected)} {occurrence}"
            for expected in expected_titles
        ):
            return True
    if case["intent"] in {"remix", "edit", "alternate", "acoustic"}:
        return any(
            named_variant_title_compatible(expected, actual)
            for expected in expected_titles
        )
    return any(title_compatible(expected, actual) for expected in expected_titles)


def track_variant_compatible(case: dict[str, Any], track: dict[str, Any]) -> bool:
    # Album context proves live/remix/specific-version intent even when Roon
    # labels an individual row as studio. For a default request, however, a
    # remix/live/edit/alternate track must still be rejected.
    if case["intent"] == "default":
        return candidate_variant(track) == "default"
    return True


def case_intent(case: dict[str, Any]) -> str:
    intent = explicit_intent(case["source_category"], case["title"])
    if intent not in {"default", "specific_version"}:
        return intent
    disambiguation = f" {norm(case.get('recording_disambiguation'))} "
    if any(word in disambiguation for word in (" live ", " concert ", " en vivo ")):
        return "live"
    if any(word in disambiguation for word in (" remix ", " mix ", " rework ", " dub ")):
        return "remix"
    if any(word in disambiguation for word in (" edit ", " radio version ")):
        return "edit"
    if any(word in disambiguation for word in (" acoustic ", " unplugged ")):
        return "acoustic"
    if any(
        word in disambiguation
        for word in (
            " alternate ",
            " alternative ",
            " outtake ",
            " rehearsal ",
            " demo ",
            " take ",
        )
    ):
        return "alternate"
    return intent


def query_ladder(case: dict[str, Any]) -> list[str]:
    title = case.get("recording_title") or case["title"]
    artist = (case.get("track_artists") or [case["artist"]])[0]
    queries = []
    occurrence = int(case.get("same_title_occurrence") or 0)
    total = int(case.get("same_title_total") or 0)
    if occurrence and total > 1:
        queries.append(f"{title} #{occurrence} {artist}")
    queries.append(f"{title} {artist}")
    if case.get("album"):
        queries.append(f"{title} {artist} {case['album']}")
    if case["intent"] == "acoustic":
        album = norm(case.get("album"))
        if "unplugged" in album:
            queries.append(f"{title} {artist} Unplugged")
        if "acustico" in album:
            queries.append(f"{title} {artist} Acústico")
    # MusicBrainz treats remastering as the same recording identity. This is a
    # safe fallback for an original request when Roon ranks a later remix but
    # still exposes a remastered issue.
    if case["intent"] == "default":
        queries.append(f"{title} {artist} Remaster")
    return list(dict.fromkeys(queries))


def album_query_ladder(case: dict[str, Any]) -> list[str]:
    titles = list(
        dict.fromkeys(
            title
            for title in (case.get("release_title"), case.get("album"))
            if title
        )
    )
    artists = list(
        dict.fromkeys(
            artist
            for artist in (
                *(case.get("album_artists") or []),
                case.get("artist"),
            )
            if artist
        )
    )
    return list(
        dict.fromkeys(
            [
                *(f"{title} {artist}" for title in titles for artist in artists),
                *titles,
            ]
        )
    )


def candidate_artists(candidate: dict[str, Any]) -> set[str]:
    return {
        norm(artist.get("title") if isinstance(artist, dict) else artist)
        for artist in candidate.get("artists") or []
        if artist
    }


def artist_sets_compatible(expected: set[str], observed: set[str]) -> bool:
    if expected & observed:
        return True
    # Roon currently exposes the Korean group f(x) as just "f". This alias is
    # deliberately artist-specific; dropping arbitrary parenthetical text
    # would merge unrelated artist identities.
    aliases = {
        ("f x", "f"),
        ("f", "f x"),
    }
    return any((left, right) in aliases for left in expected for right in observed)


def direct_match(case: dict[str, Any], candidate: dict[str, Any]) -> bool:
    expected_artists = {
        norm(artist)
        for artist in case.get("track_artists") or case["artists"]
    }
    if not artist_sets_compatible(expected_artists, candidate_artists(candidate)):
        return False
    if not case_title_compatible(case, candidate.get("title") or ""):
        return False
    compact = compact_candidate(candidate)
    if variant_compatible(case, compact):
        return True
    return (
        case["intent"] == "remix"
        and candidate_variant(compact) != "edit"
        and named_variant_title_compatible(
            case["title"],
            candidate.get("title") or "",
        )
    )


def resolve_direct(token: str, case: dict[str, Any]) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    attempts = []
    for query in query_ladder(case):
        response = api_request(
            token,
            "/media/search",
            {
                "query": query,
                "types": ["track"],
                "count": 25,
                "source_preference": "highest_quality",
            },
        )
        candidates = response.get("results") or []
        compatible = [
            (position, candidate)
            for position, candidate in enumerate(candidates, 1)
            if direct_match(case, candidate)
        ]
        attempts.append(
            {
                "query": query,
                "available_count": response.get("available_counts", {}).get("track"),
                "compatible_positions": [position for position, _ in compatible],
                "top": [compact_candidate(candidate) for candidate in candidates[:5]],
            }
        )
        if compatible:
            position, candidate = compatible[0]
            if candidate.get("playable") is not False and candidate.get("identity_verified") is not False:
                return {
                    "strategy": "roon_direct_query_ladder",
                    "query": query,
                    "position": position,
                    "track": compact_track(candidate),
                    "ordered": candidate.get("ordered"),
                    "identity_verified": candidate.get("identity_verified"),
                    "data_origin": candidate.get("data_origin"),
                    "completeness": candidate.get("completeness"),
                    "warnings": candidate.get("warnings") or [],
                }, attempts
    return None, attempts


def track_coordinate_matches(
    case: dict[str, Any],
    track: dict[str, Any],
    ordinal: int,
) -> bool:
    expected_track = int(case.get("track_position") or 0)
    expected_disc = int(case.get("disc_position") or 1)
    observed_track = int(track.get("track_number") or ordinal)
    observed_disc = int(track.get("disc_number") or 1)
    return (observed_disc, observed_track) == (expected_disc, expected_track)


def track_position_matches(
    case: dict[str, Any],
    track: dict[str, Any],
    ordinal: int,
    all_tracks: list[dict[str, Any]],
) -> bool:
    if not track_coordinate_matches(case, track, ordinal):
        return False
    if int(case.get("release_track_count") or 0) != len(all_tracks):
        return False
    observed_discs = {
        int(item.get("disc_number") or 1)
        for item in all_tracks
    }
    if int(case.get("release_medium_count") or 0) != len(observed_discs):
        return False
    expected_artists = {
        norm(artist)
        for artist in case.get("track_artists") or case["artists"]
    }
    return artist_sets_compatible(expected_artists, candidate_artists(track))


def matches_from_album_detail(
    case: dict[str, Any],
    album: dict[str, Any],
    detail: dict[str, Any],
    *,
    require_position: bool = False,
) -> list[dict[str, Any]]:
    tracks = detail.get("tracks") or []
    matches = []
    for ordinal, track in enumerate(tracks, 1):
        title_match = case_title_compatible(
            case,
            track.get("title") or "",
            album_context=True,
        )
        position_match = track_position_matches(
            case,
            track,
            ordinal,
            tracks,
        )
        coordinate_match = track_coordinate_matches(case, track, ordinal)
        if require_position and not (
            position_match or (title_match and coordinate_match)
        ):
            continue
        if not title_match and not position_match:
            continue
        if not track_variant_compatible(case, track):
            continue
        matches.append(
            {
                "album": compact_album(album),
                "track": compact_track(track),
                "match_basis": (
                    "musicbrainz_title_and_position"
                    if require_position and title_match and coordinate_match
                    else "musicbrainz_title_variant"
                    if title_match
                    else "verified_release_shape_and_position"
                ),
                "ordered": detail.get("ordered"),
                "identity_verified": detail.get("identity_verified"),
                "data_origin": detail.get("data_origin"),
                "completeness": detail.get("completeness"),
                "warnings": detail.get("warnings") or [],
            }
        )
    return matches


def find_album_matches(
    token: str,
    case: dict[str, Any],
    album: dict[str, Any],
    *,
    require_position: bool = False,
) -> list[dict[str, Any]]:
    detail = api_request(
        token,
        f"/media/{urllib.parse.quote(album['result_id'])}/album-detail?count=200",
    )
    release_group_id = case.get("release_group_id")
    if release_group_id and detail.get("ordered") and detail.get("identity_verified"):
        cache_key = (
            norm(album.get("title")),
            norm(album.get("artist")),
            album.get("source"),
        )
        cached_keys = {
            (
                norm(cached_album.get("title")),
                norm(cached_album.get("artist")),
                cached_album.get("source"),
            )
            for cached_album, _ in VERIFIED_RELEASE_GROUPS[release_group_id]
        }
        if cache_key not in cached_keys:
            VERIFIED_RELEASE_GROUPS[release_group_id].append((album, detail))
    return matches_from_album_detail(
        case,
        album,
        detail,
        require_position=require_position,
    )


def strong_album_match(matches: list[dict[str, Any]]) -> dict[str, Any] | None:
    return next(
        (
            match
            for match in matches
            if match["ordered"]
            and match["identity_verified"]
            and match["track"].get("playable") is not False
        ),
        None,
    )


def resolved_album_result(
    case: dict[str, Any],
    direct_attempts: list[dict[str, Any]],
    attempts: list[dict[str, Any]],
    matches: list[dict[str, Any]],
    match: dict[str, Any],
    strategy: str,
) -> dict[str, Any]:
    return {
        "case_id": case["case_id"],
        "intent": case["intent"],
        "eligible": True,
        "expected": {
            key: case[key]
            for key in (
                "title",
                "artist",
                "album",
                "recording_id",
                "release_group_id",
                "release_id",
            )
        },
        "resolved": True,
        "resolution": {
            **match,
            "strategy": strategy,
        },
        "direct_attempts": direct_attempts,
        "attempts": attempts,
        "all_matches": matches,
    }


def unresolved_result(
    case: dict[str, Any],
    direct_attempts: list[dict[str, Any]],
    attempts: list[dict[str, Any]],
    matches: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "case_id": case["case_id"],
        "intent": case["intent"],
        "eligible": True,
        "expected": {
            key: case[key]
            for key in (
                "title",
                "artist",
                "album",
                "recording_id",
                "release_group_id",
                "release_id",
            )
        },
        "resolved": False,
        "resolution": None,
        "direct_attempts": direct_attempts,
        "attempts": attempts,
        "all_matches": matches,
    }


def resolve_case(token: str, case: dict[str, Any]) -> dict[str, Any]:
    case = {
        **case,
        "intent": case_intent(case),
    }
    if case.get("recording_video") is True:
        return {
            "case_id": case["case_id"],
            "intent": case["intent"],
            "eligible": False,
            "ineligible_reason": "musicbrainz_video_recording",
            "resolved": False,
            "resolution": None,
            "direct_attempts": [],
            "attempts": [],
            "all_matches": [],
        }
    direct_resolution, direct_attempts = resolve_direct(token, case)
    if direct_resolution:
        return {
            "case_id": case["case_id"],
            "intent": case["intent"],
            "eligible": True,
            "expected": {
                key: case[key]
                for key in (
                    "title",
                    "artist",
                    "album",
                    "recording_id",
                    "release_group_id",
                    "release_id",
                )
            },
            "resolved": True,
            "resolution": direct_resolution,
            "direct_attempts": direct_attempts,
            "attempts": [],
            "all_matches": [direct_resolution],
        }
    attempts = []
    matches = []
    for album, detail in VERIFIED_RELEASE_GROUPS.get(
        case.get("release_group_id") or "",
        [],
    ):
        strengths = [
            album_title_match_strength(
                expected_title,
                album.get("title") or "",
                case.get("album_artists") or case["artists"],
            )
            for expected_title in (
                case.get("release_title"),
                case.get("album"),
            )
            if expected_title
        ]
        if not any(strengths) or not album_artist_compatible(case, album):
            continue
        cached_matches = matches_from_album_detail(
            case,
            album,
            detail,
            require_position="strict" not in strengths,
        )
        matches.extend(cached_matches)
        strong = strong_album_match(cached_matches)
        if strong:
            attempts.append(
                {
                    "navigation": "verified_release_group_cache",
                    "release_group_id": case.get("release_group_id"),
                    "compatible_albums": [compact_album(album)],
                }
            )
            return resolved_album_result(
                case,
                direct_attempts,
                attempts,
                matches,
                strong,
                "roon_verified_release_group_cache",
            )
    release_group_id = case.get("release_group_id")
    if release_group_id in EXHAUSTED_RELEASE_GROUPS:
        attempts.append(
            {
                "navigation": "exhausted_release_group_cache",
                "release_group_id": release_group_id,
            }
        )
        return unresolved_result(case, direct_attempts, attempts, matches)
    seen_albums = set()
    for preference in ("highest_quality", "streaming_first", "library_first"):
        for album_query in album_query_ladder(case):
            response = api_request(
                token,
                "/media/search",
                {
                    "query": album_query,
                    "types": ["album"],
                    "count": 25,
                    "source_preference": preference,
                },
            )
            albums = [
                album
                for album in response.get("results") or []
                if any(
                    album_title_compatible(
                        expected_title,
                        album.get("title") or "",
                        case.get("album_artists") or case["artists"],
                    )
                    for expected_title in (
                        case.get("release_title"),
                        case.get("album"),
                    )
                    if expected_title
                )
                and album_artist_compatible(case, album)
            ]
            attempts.append(
                {
                    "query": album_query,
                    "source_preference": preference,
                    "available_count": response.get("available_counts", {}).get("album"),
                    "compatible_albums": [compact_album(album) for album in albums],
                }
            )
            for album in albums[:8]:
                # Result IDs are session-local, so open the result returned by
                # this exact search before starting the next search.
                album_key = (
                    norm(album.get("title")),
                    norm(album.get("artist")),
                    album.get("source"),
                    preference,
                )
                if album_key in seen_albums:
                    continue
                seen_albums.add(album_key)
                strengths = [
                    album_title_match_strength(
                        expected_title,
                        album.get("title") or "",
                        case.get("album_artists") or case["artists"],
                    )
                    for expected_title in (
                        case.get("release_title"),
                        case.get("album"),
                    )
                    if expected_title
                ]
                album_matches = find_album_matches(
                    token,
                    case,
                    album,
                    require_position="strict" not in strengths,
                )
                matches.extend(album_matches)
                strong = strong_album_match(album_matches)
                if strong:
                    return resolved_album_result(
                        case,
                        direct_attempts,
                        attempts,
                        matches,
                        strong,
                        "roon_album_tracklist",
                    )
    for artist_name in case.get("album_artists") or []:
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
        artists = [
            artist
            for artist in response.get("results") or []
            if norm(artist.get("title")) == norm(artist_name)
        ]
        attempts.append(
            {
                "navigation": "artist_search",
                "query": artist_name,
                "available_count": response.get("available_counts", {}).get("artist"),
                "compatible_artists": [
                    {
                        "title": artist.get("title"),
                        "subtitle": artist.get("subtitle"),
                        "source": artist.get("source"),
                    }
                    for artist in artists
                ],
            }
        )
        for artist in artists[:2]:
            releases_detail = api_request(
                token,
                f"/media/{urllib.parse.quote(artist['result_id'])}/releases?count=250",
            )
            albums = [
                album
                for album in releases_detail.get("releases") or []
                if any(
                    album_title_compatible(
                        expected_title,
                        album.get("title") or "",
                        case.get("album_artists") or case["artists"],
                    )
                    for expected_title in (
                        case.get("release_title"),
                        case.get("album"),
                    )
                    if expected_title
                )
                and album_artist_compatible(case, album)
            ]
            attempts.append(
                {
                    "navigation": "artist_releases",
                    "query": artist_name,
                    "available_count": len(releases_detail.get("releases") or []),
                    "compatible_albums": [compact_album(album) for album in albums],
                }
            )
            for album in albums[:8]:
                strengths = [
                    album_title_match_strength(
                        expected_title,
                        album.get("title") or "",
                        case.get("album_artists") or case["artists"],
                    )
                    for expected_title in (
                        case.get("release_title"),
                        case.get("album"),
                    )
                    if expected_title
                ]
                album_matches = find_album_matches(
                    token,
                    case,
                    album,
                    require_position="strict" not in strengths,
                )
                matches.extend(album_matches)
                strong = strong_album_match(album_matches)
                if strong:
                    return resolved_album_result(
                        case,
                        direct_attempts,
                        attempts,
                        matches,
                        strong,
                        "roon_artist_release_tracklist",
                    )
    if release_group_id:
        EXHAUSTED_RELEASE_GROUPS.add(release_group_id)
    return unresolved_result(case, direct_attempts, attempts, matches)


def summarize(results: list[dict[str, Any]]) -> dict[str, Any]:
    groups: dict[str, dict[str, int]] = collections.defaultdict(
        lambda: {"total": 0, "resolved": 0, "unresolved": 0}
    )
    for result in results:
        group = groups[result["intent"]]
        group["total"] += 1
        group["resolved" if result["resolved"] else "unresolved"] += 1
    resolved = sum(result["resolved"] for result in results)
    return {
        "schema_version": 1,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "strategy": "direct_query_ladder_then_verified_album_tracklist",
        "overall": {
            "total": len(results),
            "resolved": resolved,
            "unresolved": len(results) - resolved,
            "resolved_pct": round(100 * resolved / max(1, len(results)), 2),
        },
        "by_intent": dict(sorted(groups.items())),
        "unresolved_cases": [
            {
                "case_id": result["case_id"],
                "intent": result["intent"],
                "expected": result["expected"],
                "attempts": result["attempts"],
            }
            for result in results
            if not result["resolved"]
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifacts", type=Path, required=True)
    parser.add_argument("--source-run", required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    args = parser.parse_args()
    token = os.environ.get("ROONIA_VALIDATION_TOKEN")
    if not token:
        raise SystemExit("ROONIA_VALIDATION_TOKEN is required")

    artifacts = args.artifacts.resolve()
    corpus = {
        case["case_id"]: case
        for case in read_jsonl(artifacts / "corpus" / "cases.jsonl")
    }
    source_summary = json.loads(
        (artifacts / "runs" / args.source_run / "summary.json").read_text(
            encoding="utf-8"
        )
    )
    conflict_ids = [
        failure["case_id"] for failure in source_summary["failure_examples"]
    ]
    results = []
    for index, case_id in enumerate(conflict_ids, 1):
        result = resolve_case(token, corpus[case_id])
        results.append(result)
        print(
            json.dumps(
                {
                    "phase": "conflicts",
                    "processed": index,
                    "total": len(conflict_ids),
                    "resolved": sum(item["resolved"] for item in results),
                    "case_id": case_id,
                }
            ),
            flush=True,
        )

    run_id = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_dir = args.output_root.resolve() / run_id
    write_jsonl(run_dir / "results.jsonl", results)
    summary = summarize(results)
    (run_dir / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(
        "FINAL_SUMMARY "
        + json.dumps(summary, ensure_ascii=False, separators=(",", ":")),
        flush=True,
    )


if __name__ == "__main__":
    main()
