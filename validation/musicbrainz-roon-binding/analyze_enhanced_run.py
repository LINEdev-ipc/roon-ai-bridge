#!/usr/bin/env python3
"""Create a reusable failure analysis for an enhanced validation run."""

from __future__ import annotations

import argparse
import collections
import json
import sys
from pathlib import Path
from typing import Any

from run_validation import identity_candidates, read_jsonl, title_compatible

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def classify(case: dict[str, Any], result: dict[str, Any]) -> str:
    tops = [
        candidate
        for attempt in result.get("direct_attempts") or []
        for candidate in attempt.get("top") or []
    ]
    identity = [
        match
        for attempt in result.get("direct_attempts") or []
        for match in identity_candidates(case, attempt.get("top") or [])
    ]
    compatible_albums = [
        album
        for attempt in result.get("attempts") or []
        for album in attempt.get("compatible_albums") or []
    ]
    title_only = [
        candidate
        for candidate in tops
        if title_compatible(case["title"], candidate.get("title") or "")
    ]
    if result.get("request_error"):
        return "request_error"
    if result.get("all_matches"):
        return "matched_track_but_evidence_weak"
    if compatible_albums:
        return "album_found_track_not_matched"
    if identity:
        return "identity_candidate_variant_rejected"
    if title_only:
        return "title_found_artist_credit_mismatch"
    if any(
        (attempt.get("available_count") or 0) > 0
        for attempt in result.get("direct_attempts") or []
    ):
        return "no_identity_in_top5"
    return "no_roon_results"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifacts", type=Path, required=True)
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()
    artifacts = args.artifacts.resolve()
    run_dir = artifacts / "enhanced-runs" / args.run_id
    corpus = {
        case["case_id"]: case
        for case in read_jsonl(artifacts / "corpus" / "cases.jsonl")
    }
    results = read_jsonl(run_dir / "results.jsonl")
    failures = []
    manual_cases = []
    ineligible_cases = []
    for result in results:
        if result.get("resolved"):
            continue
        case = corpus[result["case_id"]]
        if result.get("eligible") is False:
            ineligible_cases.append(
                {
                    "case_id": result["case_id"],
                    "reason": result.get("ineligible_reason"),
                    "title": case["title"],
                    "artist": case["artist"],
                    "album": case["album"],
                }
            )
            continue
        if result.get("manual_required"):
            manual_cases.append(
                {
                    "case_id": result["case_id"],
                    "reason": result.get("manual_reason"),
                    "title": case["title"],
                    "artist": case["artist"],
                    "album": case["album"],
                    "recording_id": case["recording_id"],
                    "release_group_id": case["release_group_id"],
                }
            )
            continue
        failures.append(
            {
                "case_id": result["case_id"],
                "reason": classify(case, result),
                "intent": case["intent"],
                "source_category": case["source_category"],
                "cohort": case.get("cohort") or "initial_500",
                "language": case.get("language") or "initial_500",
                "era": case.get("era") or "initial_500",
                "title": case["title"],
                "artist": case["artist"],
                "album": case["album"],
                "recording_id": case["recording_id"],
                "release_group_id": case["release_group_id"],
            }
        )

    def counter(field: str) -> dict[str, int]:
        return dict(
            sorted(collections.Counter(row[field] for row in failures).items())
        )

    album_counts = collections.Counter(
        (row["album"], row["artist"]) for row in failures
    )
    reason_intent = collections.Counter(
        (row["reason"], row["intent"]) for row in failures
    )
    passed = [
        result
        for result in results
        if result.get("resolved")
        or result.get("manual_required")
        or result.get("eligible") is False
    ]
    report = {
        "schema_version": 2,
        "run_id": args.run_id,
        "overall": {
            "total": len(results),
            "resolved": sum(result.get("resolved") is True for result in results),
            "manual_required": len(manual_cases),
            "ineligible": len(ineligible_cases),
            "unresolved": len(failures),
            "passed": len(passed),
            "initial_500_resolved": sum(
                result.get("resolved") is True for result in results[:500]
            ),
            "initial_500_passed": sum(
                result.get("resolved") is True
                or result.get("manual_required") is True
                or result.get("eligible") is False
                for result in results[:500]
            ),
            "incremental_1000_resolved": sum(
                result.get("resolved") is True for result in results[500:]
            ),
            "incremental_1000_passed": sum(
                result.get("resolved") is True
                or result.get("manual_required") is True
                or result.get("eligible") is False
                for result in results[500:]
            ),
            "baseline_1500_resolved": sum(
                result.get("resolved") is True for result in results[:1500]
            ),
            "baseline_1500_passed": sum(
                result.get("resolved") is True
                or result.get("manual_required") is True
                or result.get("eligible") is False
                for result in results[:1500]
            ),
            "incremental_1500_resolved": sum(
                result.get("resolved") is True for result in results[1500:]
            ),
            "incremental_1500_passed": sum(
                result.get("resolved") is True
                or result.get("manual_required") is True
                or result.get("eligible") is False
                for result in results[1500:]
            ),
        },
        "by_reason": counter("reason"),
        "by_intent": counter("intent"),
        "by_source_category": counter("source_category"),
        "by_cohort": counter("cohort"),
        "by_language": counter("language"),
        "reason_by_intent": {
            f"{reason}::{intent}": count
            for (reason, intent), count in sorted(reason_intent.items())
        },
        "top_failing_albums": [
            {"album": album, "artist": artist, "unresolved": count}
            for (album, artist), count in album_counts.most_common(30)
        ],
        "findings": [
            "MusicBrainz recording identity remains authoritative; Roon candidates are accepted only when title, artist, requested variant and release evidence are compatible.",
            "MusicBrainz video recordings are ineligible for an audio-only Roon binding.",
            "A frozen manual fallback is a successful safe decision only when targeted evidence has already shown that the exact recording cannot be proven automatically.",
            "Different edits, mixes, performances, remasters and split recordings remain rejected substitutes.",
        ],
        "manual_required_cases": manual_cases,
        "ineligible_cases": ineligible_cases,
        "failures": failures,
    }
    output = run_dir / "failure-analysis.json"
    output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(json.dumps(report["overall"], ensure_ascii=False))
    print(json.dumps(report["by_reason"], ensure_ascii=False))


if __name__ == "__main__":
    main()
