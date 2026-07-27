#!/usr/bin/env python3
"""Run the resumable corpus through the evidence-based Roon binding ladder."""

from __future__ import annotations

import argparse
import collections
import datetime as dt
import json
import os
import sys
from pathlib import Path
from typing import Any

from run_conflict_validation import case_intent, resolve_case
from run_validation import explicit_intent, read_jsonl, write_jsonl

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def load_manual_expectations(path: Path) -> dict[str, dict[str, str]]:
    if not path.exists():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    rows = list(payload.get("cases") or [])
    for group in payload.get("groups") or []:
        rows.extend(
            {
                "case_id": case_id,
                "reason": group["reason"],
                "evidence_group": group.get("evidence_group"),
            }
            for case_id in group.get("case_ids") or []
        )
    return {row["case_id"]: row for row in rows}


def summarize(
    corpus: list[dict[str, Any]],
    results: list[dict[str, Any]],
    started_at: str,
    elapsed_seconds: float,
) -> dict[str, Any]:
    by_case = {case["case_id"]: case for case in corpus}
    intent_groups: dict[str, dict[str, int]] = collections.defaultdict(
        lambda: {
            "total": 0,
            "resolved": 0,
            "manual_required": 0,
            "ineligible": 0,
            "unresolved": 0,
        }
    )
    cohort_groups: dict[str, dict[str, int]] = collections.defaultdict(
        lambda: {
            "total": 0,
            "resolved": 0,
            "manual_required": 0,
            "ineligible": 0,
            "unresolved": 0,
        }
    )
    strategies: collections.Counter[str] = collections.Counter()
    direct_query_steps: collections.Counter[int] = collections.Counter()
    request_errors = 0
    for result in results:
        group = intent_groups[result["intent"]]
        cohort = by_case[result["case_id"]].get("cohort") or (
            "initial_500" if int(result["case_id"].split("-")[-1]) <= 500 else "unknown"
        )
        cohort_group = cohort_groups[cohort]
        group["total"] += 1
        cohort_group["total"] += 1
        if result.get("eligible") is False:
            group["ineligible"] += 1
            cohort_group["ineligible"] += 1
        elif result.get("resolved"):
            group["resolved"] += 1
            cohort_group["resolved"] += 1
            resolution = result.get("resolution") or {}
            strategies[resolution.get("strategy") or "unknown"] += 1
            if resolution.get("strategy") == "roon_direct_query_ladder":
                queries = [attempt["query"] for attempt in result.get("direct_attempts") or []]
                try:
                    direct_query_steps[queries.index(resolution.get("query")) + 1] += 1
                except ValueError:
                    direct_query_steps[0] += 1
        elif result.get("manual_required"):
            group["manual_required"] += 1
            cohort_group["manual_required"] += 1
        else:
            group["unresolved"] += 1
            cohort_group["unresolved"] += 1
        if result.get("request_error"):
            request_errors += 1
    resolved = sum(result.get("resolved") is True for result in results)
    ineligible = sum(result.get("eligible") is False for result in results)
    manual_required = sum(
        result.get("manual_required") is True for result in results
    )
    unresolved = len(results) - resolved - ineligible - manual_required
    passed = resolved + ineligible + manual_required
    return {
        "schema_version": 2,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "started_at": started_at,
        "elapsed_seconds": round(elapsed_seconds, 2),
        "strategy": "direct_query_ladder_then_verified_album_tracklist",
        "overall": {
            "total": len(results),
            "resolved": resolved,
            "manual_required": manual_required,
            "ineligible": ineligible,
            "unresolved": unresolved,
            "passed": passed,
            "resolved_pct": round(100 * resolved / max(1, len(results)), 2),
            "passed_pct": round(100 * passed / max(1, len(results)), 2),
            "request_errors": request_errors,
        },
        "by_intent": dict(sorted(intent_groups.items())),
        "by_cohort": dict(sorted(cohort_groups.items())),
        "by_resolution_strategy": dict(sorted(strategies.items())),
        "direct_query_step": {
            str(step): count for step, count in sorted(direct_query_steps.items())
        },
        "dataset": {
            "cases": len(corpus),
            "manual_fallback_expectations": manual_required,
            "first_case_id": corpus[0]["case_id"] if corpus else None,
            "last_case_id": corpus[-1]["case_id"] if corpus else None,
            "release_groups": len(
                {case["release_group_id"] for case in corpus}
            ),
            "derived_intent_distribution": dict(
                sorted(
                    collections.Counter(
                        case_intent(case)
                        for case in corpus
                    ).items()
                )
            ),
            "source_category_distribution": dict(
                sorted(
                    collections.Counter(
                        case["source_category"] for case in corpus
                    ).items()
                )
            ),
            "incremental_501_plus": {
                "cases": max(0, len(corpus) - 500),
                "cohorts": dict(
                    sorted(
                        collections.Counter(
                            case.get("cohort") or "unknown"
                            for case in corpus[500:]
                        ).items()
                    )
                ),
                "languages": dict(
                    sorted(
                        collections.Counter(
                            case.get("language") or "unknown"
                            for case in corpus[500:]
                        ).items()
                    )
                ),
                "eras": dict(
                    sorted(
                        collections.Counter(
                            case.get("era") or "unknown"
                            for case in corpus[500:]
                        ).items()
                    )
                ),
            },
            "incremental_1501_plus": {
                "cases": max(0, len(corpus) - 1500),
                "release_groups": len(
                    {
                        case["release_group_id"]
                        for case in corpus[1500:]
                    }
                ),
                "artists": len(
                    {
                        case["artist"].casefold()
                        for case in corpus[1500:]
                    }
                ),
                "cohorts": dict(
                    sorted(
                        collections.Counter(
                            case.get("cohort") or "unknown"
                            for case in corpus[1500:]
                        ).items()
                    )
                ),
                "languages": dict(
                    sorted(
                        collections.Counter(
                            case.get("language") or "unknown"
                            for case in corpus[1500:]
                        ).items()
                    )
                ),
                "eras": dict(
                    sorted(
                        collections.Counter(
                            case.get("era") or "unknown"
                            for case in corpus[1500:]
                        ).items()
                    )
                ),
            },
        },
        "unresolved_cases": [
            {
                "case_id": result["case_id"],
                "intent": result["intent"],
                "expected": result["expected"],
                "request_error": result.get("request_error"),
            }
            for result in results
            if result.get("eligible") is not False and not result.get("resolved")
            and not result.get("manual_required")
        ],
        "manual_required_cases": [
            {
                "case_id": result["case_id"],
                "intent": result["intent"],
                "reason": result.get("manual_reason"),
            }
            for result in results
            if result.get("manual_required")
        ],
        "ineligible_cases": [
            {
                "case_id": result["case_id"],
                "intent": result["intent"],
                "reason": result.get("ineligible_reason"),
            }
            for result in results
            if result.get("eligible") is False
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifacts", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--limit", type=int)
    parser.add_argument(
        "--source-run-unresolved",
        help="Run only unresolved cases from a stored enhanced run",
    )
    parser.add_argument(
        "--source-results",
        type=Path,
        help="Run only eligible unresolved cases from an explicit results JSONL",
    )
    parser.add_argument(
        "--resume-run",
        help="Continue an incomplete run directory without repeating saved cases",
    )
    args = parser.parse_args()
    token = os.environ.get("ROONIA_VALIDATION_TOKEN")
    if not token:
        raise SystemExit("ROONIA_VALIDATION_TOKEN is required")

    artifacts = args.artifacts.resolve()
    corpus = read_jsonl(artifacts / "corpus" / "cases.jsonl")
    context_path = artifacts / "corpus" / "binding-context.jsonl"
    contexts = {
        row["case_id"]: row
        for row in read_jsonl(context_path)
    }
    corpus = [
        {**case, **contexts.get(case["case_id"], {})}
        for case in corpus
    ]
    expectations_path = (
        artifacts / "corpus" / "manual-fallback-expectations.json"
    )
    expectations = load_manual_expectations(expectations_path)
    if args.source_run_unresolved or args.source_results:
        source_path = (
            args.source_results.resolve()
            if args.source_results
            else artifacts
            / "enhanced-runs"
            / args.source_run_unresolved
            / "results.jsonl"
        )
        source_results = read_jsonl(source_path)
        selected_ids = {
            result["case_id"]
            for result in source_results
            if result.get("eligible") is not False
            and not result.get("resolved")
            and not result.get("manual_required")
        }
        corpus = [case for case in corpus if case["case_id"] in selected_ids]
    if args.limit is not None:
        corpus = corpus[: max(0, args.limit)]
    output_root = args.output_root.resolve()
    run_id = args.resume_run or dt.datetime.now(dt.timezone.utc).strftime(
        "%Y%m%dT%H%M%SZ"
    )
    run_dir = output_root / run_id
    progress_path = run_dir / "progress.json"
    saved_results = (
        read_jsonl(run_dir / "results.jsonl") if args.resume_run else []
    )
    results_by_case = {result["case_id"]: result for result in saved_results}
    if progress_path.exists():
        progress = json.loads(progress_path.read_text(encoding="utf-8"))
        started = dt.datetime.fromisoformat(progress["started_at"])
    else:
        started = dt.datetime.now(dt.timezone.utc)
    for index, case in enumerate(corpus, 1):
        if case["case_id"] in results_by_case:
            continue
        try:
            result = resolve_case(token, case)
        except Exception as error:
            intent = case_intent(case)
            result = {
                "case_id": case["case_id"],
                "intent": intent,
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
                "eligible": True,
                "resolution": None,
                "direct_attempts": [],
                "attempts": [],
                "all_matches": [],
                "request_error": f"{type(error).__name__}: {error}",
            }
        expectation = expectations.get(case["case_id"])
        if (
            expectation
            and result.get("eligible") is not False
            and not result.get("resolved")
            and not result.get("request_error")
        ):
            result["manual_required"] = True
            result["manual_reason"] = expectation["reason"]
        results_by_case[case["case_id"]] = result
        completed = len(results_by_case)
        if completed % 10 == 0 or completed == len(corpus):
            results = [
                results_by_case[item["case_id"]]
                for item in corpus
                if item["case_id"] in results_by_case
            ]
            write_jsonl(run_dir / "results.jsonl", results)
            run_dir.mkdir(parents=True, exist_ok=True)
            progress_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "run_id": run_id,
                        "started_at": started.isoformat(),
                        "updated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                        "completed": completed,
                        "total": len(corpus),
                        "last_case_id": result["case_id"],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            print(
                json.dumps(
                    {
                        "phase": "enhanced_validation",
                        "processed": completed,
                        "total": len(corpus),
                        "resolved": sum(
                            item.get("resolved") is True for item in results
                        ),
                        "passed": sum(
                            item.get("resolved") is True
                            or item.get("eligible") is False
                            or item.get("manual_required") is True
                            for item in results
                        ),
                    }
                ),
                flush=True,
            )

    results = [
        results_by_case[item["case_id"]]
        for item in corpus
        if item["case_id"] in results_by_case
    ]
    write_jsonl(run_dir / "results.jsonl", results)
    summary = summarize(
        corpus,
        results,
        started.isoformat(),
        (dt.datetime.now(dt.timezone.utc) - started).total_seconds(),
    )
    (run_dir / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    progress_path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "run_id": run_id,
                "status": "complete",
                "started_at": started.isoformat(),
                "updated_at": summary["generated_at"],
                "completed": len(results),
                "total": len(corpus),
                "last_case_id": corpus[-1]["case_id"] if corpus else None,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    if (
        not args.source_run_unresolved
        and not args.source_results
        and args.limit is None
    ):
        state_path = artifacts / "state.json"
        state = (
            json.loads(state_path.read_text(encoding="utf-8"))
            if state_path.exists()
            else {"schema_version": 1}
        )
        state.update(
            {
                "last_enhanced_run_id": run_id,
                "last_enhanced_run_completed_at": summary["generated_at"],
                "last_enhanced_run_cases": len(results),
            }
        )
        state_path.write_text(
            json.dumps(state, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    print(
        "FINAL_SUMMARY "
        + json.dumps(summary, ensure_ascii=False, separators=(",", ":")),
        flush=True,
    )


if __name__ == "__main__":
    main()
