#!/usr/bin/env python3
"""Robust multi-process wrapper for the Adbot seed generator.

Each scenario runs in an isolated subprocess with a hard timeout. Accepted rows
are persisted atomically, so interrupted jobs can resume without re-generating
completed scenarios.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import pathlib
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

ROOT = pathlib.Path(__file__).resolve().parents[1]
GENERATOR = ROOT / "scripts/generate-ad-intelligence-seed.py"
SPEC_PATH = ROOT / "training/ad-intelligence/seed-spec.json"
OUTPUT_DIR = ROOT / "training/ad-intelligence/v1"
RAW_PATH = OUTPUT_DIR / "records.jsonl"

spec = importlib.util.spec_from_file_location("adbot_seed_generator", GENERATOR)
if spec is None or spec.loader is None:
    raise RuntimeError("Could not load seed generator module")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def write_jsonl(path: pathlib.Path, rows: list[dict[str, Any]]) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        "".join(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n" for row in rows),
        encoding="utf-8",
    )
    temporary.replace(path)


def generate_process(scenario_id: str, timeout_seconds: int) -> dict[str, Any]:
    result = subprocess.run(
        [sys.executable, str(GENERATOR), "--scenario-id", scenario_id],
        cwd=ROOT,
        env=os.environ.copy(),
        capture_output=True,
        text=True,
        timeout=timeout_seconds,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or f"scenario process exited {result.returncode}")
    lines = [line for line in result.stdout.splitlines() if line.strip()]
    if not lines:
        raise RuntimeError("scenario process returned no JSON")
    return json.loads(lines[-1])


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-workers", type=int, default=4)
    parser.add_argument("--timeout-seconds", type=int, default=420)
    parser.add_argument("--rounds", type=int, default=4)
    args = parser.parse_args()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    source_spec = json.loads(SPEC_PATH.read_text(encoding="utf-8"))
    scenarios = module.build_scenarios(source_spec)
    records: dict[str, dict[str, Any]] = {}
    if RAW_PATH.exists():
        for line in RAW_PATH.read_text(encoding="utf-8").splitlines():
            if line.strip():
                row = json.loads(line)
                records[row["scenario_id"]] = row

    failures: dict[str, str] = {}
    for round_number in range(1, args.rounds + 1):
        pending = [row for row in scenarios if row["scenario_id"] not in records]
        if not pending:
            break
        print(f"round {round_number}: pending {len(pending)}", flush=True)
        with ThreadPoolExecutor(max_workers=max(1, min(args.max_workers, 8))) as pool:
            futures = {
                pool.submit(generate_process, row["scenario_id"], args.timeout_seconds): row
                for row in pending
            }
            for future in as_completed(futures):
                source = futures[future]
                try:
                    row = future.result()
                    records[row["scenario_id"]] = row
                    failures.pop(row["scenario_id"], None)
                    ordered = [records[item["scenario_id"]] for item in scenarios if item["scenario_id"] in records]
                    write_jsonl(RAW_PATH, ordered)
                    print(f"accepted {len(records)}/{len(scenarios)}: {row['scenario_id']}", flush=True)
                except Exception as exc:
                    failures[source["scenario_id"]] = str(exc)
                    print(f"retry later {source['scenario_id']}: {exc}", file=sys.stderr, flush=True)

    missing = [row["scenario_id"] for row in scenarios if row["scenario_id"] not in records]
    if missing:
        (OUTPUT_DIR / "failures.json").write_text(
            json.dumps({scenario_id: failures.get(scenario_id, "not completed") for scenario_id in missing}, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        raise RuntimeError(f"{len(missing)} scenarios remain after bounded retry rounds")

    ordered = [records[row["scenario_id"]] for row in scenarios]
    train = [module.conversation(row) for row in ordered if module.split_for(row["brief"]) == "train"]
    evaluation = [module.conversation(row) for row in ordered if module.split_for(row["brief"]) == "eval"]
    preferences = [module.preference(row) for row in ordered if module.split_for(row["brief"]) == "train"]
    write_jsonl(OUTPUT_DIR / "train.jsonl", train)
    write_jsonl(OUTPUT_DIR / "eval.jsonl", evaluation)
    write_jsonl(OUTPUT_DIR / "preferences.jsonl", preferences)

    platforms: dict[str, int] = {}
    industries: dict[str, int] = {}
    usage = {"teacher_input": 0, "teacher_output": 0, "judge_input": 0, "judge_output": 0}
    for row in ordered:
        platform = row["brief"]["platform"]
        industry = row["brief"]["industry"]
        platforms[platform] = platforms.get(platform, 0) + 1
        industries[industry] = industries.get(industry, 0) + 1
        usage["teacher_input"] += row["usage"]["teacher"]["input_tokens"]
        usage["teacher_output"] += row["usage"]["teacher"]["output_tokens"]
        usage["judge_input"] += row["usage"]["judge"]["input_tokens"]
        usage["judge_output"] += row["usage"]["judge"]["output_tokens"]

    manifest = {
        "contract_version": "adbot-training-manifest-v1",
        "dataset_version": "adbot-cross-platform-seed-v1",
        "source": "synthetic_first_party",
        "contains_customer_data": False,
        "contains_third_party_ads": False,
        "teacher_model": module.TEACHER_MODEL,
        "judge_model": module.JUDGE_MODEL,
        "records": len(ordered),
        "train_records": len(train),
        "eval_records": len(evaluation),
        "preference_records": len(preferences),
        "platform_distribution": platforms,
        "industry_distribution": industries,
        "usage": usage,
        "split_rule": "sha256(adbot-v1-split|industry|objective) modulo 10; buckets 0-1 eval; all platforms stay in one split",
        "rights_note": "Fictional brands and offers generated from Adbot-owned seed specifications; no customer or third-party ad content.",
    }
    (OUTPUT_DIR / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    failure_path = OUTPUT_DIR / "failures.json"
    if failure_path.exists():
        failure_path.unlink()
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"robust seed generation failed: {exc}", file=sys.stderr)
        raise
