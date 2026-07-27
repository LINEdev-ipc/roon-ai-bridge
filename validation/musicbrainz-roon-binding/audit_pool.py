#!/usr/bin/env python3
"""Audit cached MusicBrainz pool capacity without querying Roon."""

from __future__ import annotations

import argparse
import collections
import json
from pathlib import Path

from run_validation import (
    SOURCE_CATEGORY_TARGETS_1500,
    SOURCE_CATEGORY_TARGETS_3000,
    build_pool,
    extend_corpus,
    read_jsonl,
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifacts", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--target", type=int, default=1500)
    args = parser.parse_args()
    artifacts = args.artifacts.resolve()
    pool, unresolved = build_pool(artifacts / "cache" / "musicbrainz")
    corpus = read_jsonl(artifacts / "corpus" / "cases.jsonl")
    used = {case["recording_id"] for case in corpus}
    available = [case for case in pool if case["recording_id"] not in used]
    current = collections.Counter(case["source_category"] for case in corpus)
    capacity = collections.Counter(case["source_category"] for case in pool)
    available_counts = collections.Counter(
        case["source_category"] for case in available
    )
    targets = (
        SOURCE_CATEGORY_TARGETS_3000
        if args.target >= 3000
        else SOURCE_CATEGORY_TARGETS_1500
    )
    projection = None
    projection_error = None
    try:
        projected = extend_corpus(
            [dict(case) for case in corpus],
            [dict(case) for case in pool],
            args.target,
        )
        incremental = projected[len(corpus) :]
        projection = {
            "cases": len(projected),
            "incremental_cases": len(incremental),
            "incremental_release_groups": len(
                {case["release_group_id"] for case in incremental}
            ),
            "incremental_artists": len(
                {case["artist"].casefold() for case in incremental}
            ),
            "incremental_source_categories": dict(
                collections.Counter(
                    case["source_category"] for case in incremental
                )
            ),
            "incremental_cohorts": dict(
                collections.Counter(
                    case.get("cohort") or "unknown" for case in incremental
                )
            ),
            "incremental_languages": dict(
                collections.Counter(
                    case.get("language") or "unknown" for case in incremental
                )
            ),
            "incremental_eras": dict(
                collections.Counter(
                    case.get("era") or "unknown" for case in incremental
                )
            ),
        }
    except RuntimeError as error:
        projection_error = str(error)
    report = {
        "pool_cases": len(pool),
        "current": dict(current),
        "capacity": dict(capacity),
        "available_new": dict(available_counts),
        "targets": targets,
        "shortfalls": {
            category: max(0, target - capacity[category])
            for category, target in targets.items()
        },
        "unresolved_specs": unresolved,
        "projection": projection,
        "projection_error": projection_error,
    }
    if args.output:
        output = args.output.resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(
            json.dumps(report, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    print(
        "POOL_AUDIT "
        + json.dumps(
            report,
            ensure_ascii=False,
            separators=(",", ":"),
        )
    )


if __name__ == "__main__":
    main()
