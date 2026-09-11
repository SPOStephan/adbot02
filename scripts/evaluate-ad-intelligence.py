#!/usr/bin/env python3
"""Blindly compare the current baseline with a deployed Adbot fine-tune."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import statistics
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

from openai import OpenAI

ROOT = pathlib.Path(__file__).resolve().parents[1]
EVAL_PATH = ROOT / "training/ad-intelligence/v1/eval.jsonl"
REPORT_PATH = ROOT / "training/ad-intelligence/v1/evaluation-report.json"
BASELINE_MODEL = "gpt-5-mini"
JUDGE_MODEL = "gpt-5"
TOGETHER_BASE_URL = "https://api-inference.together.ai/v1"

JUDGE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "a_score": {"type": "integer", "minimum": 0, "maximum": 100},
        "b_score": {"type": "integer", "minimum": 0, "maximum": 100},
        "winner": {"type": "string", "enum": ["a", "b", "tie"]},
        "a_factuality": {"type": "boolean"},
        "b_factuality": {"type": "boolean"},
        "a_policy": {"type": "boolean"},
        "b_policy": {"type": "boolean"},
        "reason": {"type": "string"},
    },
    "required": ["a_score", "b_score", "winner", "a_factuality", "b_factuality", "a_policy", "b_policy", "reason"],
    "additionalProperties": False,
}

JUDGE_SYSTEM = (
    "Bewerte zwei anonymisierte Kampagnenpakete für dasselbe Briefing. Kriterien: Faktentreue, "
    "Plattform-Fit, Ziel-Fit, Klarheit, Eigenständigkeit, Umsetzbarkeit und Policy-Sicherheit. "
    "Erfundene Fakten oder unzulässige Claims führen zum Durchfallen. Bevorzuge nicht automatisch längere Texte."
)


def response_json(client: OpenAI, model: str, messages: list[dict[str, str]], schema: dict[str, Any] | None = None) -> tuple[dict[str, Any], dict[str, int]]:
    kwargs: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "max_completion_tokens": 6000,
    }
    if schema is not None:
        kwargs["response_format"] = {
            "type": "json_schema",
            "json_schema": {"name": "adbot_eval", "strict": True, "schema": schema},
        }
    else:
        kwargs["response_format"] = {"type": "json_object"}
        kwargs["temperature"] = 0.2
    response = client.chat.completions.create(**kwargs)
    content = response.choices[0].message.content
    if not content:
        raise RuntimeError(f"{model} returned no content")
    usage = {
        "input_tokens": int(getattr(response.usage, "prompt_tokens", 0) or 0),
        "output_tokens": int(getattr(response.usage, "completion_tokens", 0) or 0),
    }
    return json.loads(content), usage


def evaluate_one(openai_client: OpenAI, together_client: OpenAI, candidate_model: str, row: dict[str, Any]) -> dict[str, Any]:
    messages = row["messages"][:2]
    brief = json.loads(messages[1]["content"])
    baseline, baseline_usage = response_json(openai_client, BASELINE_MODEL, messages)
    candidate, candidate_usage = response_json(together_client, candidate_model, messages)

    candidate_is_a = int(hashlib.sha256(brief["scenario_id"].encode()).hexdigest()[:2], 16) % 2 == 0
    a = candidate if candidate_is_a else baseline
    b = baseline if candidate_is_a else candidate
    judge_messages = [
        {"role": "system", "content": JUDGE_SYSTEM},
        {
            "role": "user",
            "content": json.dumps({"brief": brief, "package_a": a, "package_b": b}, ensure_ascii=False),
        },
    ]
    judgment, judge_usage = response_json(openai_client, JUDGE_MODEL, judge_messages, JUDGE_SCHEMA)
    winner = judgment["winner"]
    candidate_won = (candidate_is_a and winner == "a") or ((not candidate_is_a) and winner == "b")
    baseline_won = (candidate_is_a and winner == "b") or ((not candidate_is_a) and winner == "a")
    candidate_score = judgment["a_score"] if candidate_is_a else judgment["b_score"]
    baseline_score = judgment["b_score"] if candidate_is_a else judgment["a_score"]
    candidate_factuality = judgment["a_factuality"] if candidate_is_a else judgment["b_factuality"]
    candidate_policy = judgment["a_policy"] if candidate_is_a else judgment["b_policy"]
    return {
        "scenario_id": brief["scenario_id"],
        "platform": brief["platform"],
        "candidate_score": candidate_score,
        "baseline_score": baseline_score,
        "candidate_won": candidate_won,
        "baseline_won": baseline_won,
        "tie": winner == "tie",
        "candidate_factuality": candidate_factuality,
        "candidate_policy": candidate_policy,
        "reason": judgment["reason"],
        "usage": {"baseline": baseline_usage, "candidate": candidate_usage, "judge": judge_usage},
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidate-model", required=True, help="Together endpoint string")
    parser.add_argument("--max-workers", type=int, default=4)
    args = parser.parse_args()
    if not os.environ.get("OPENAI_API_KEY") or not os.environ.get("TOGETHER_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY und TOGETHER_API_KEY werden benötigt.")

    rows = [json.loads(line) for line in EVAL_PATH.read_text(encoding="utf-8").splitlines() if line.strip()]
    if len(rows) < 20:
        raise RuntimeError("Der Holdout-Split benötigt mindestens 20 Beispiele.")

    openai_client = OpenAI()
    together_client = OpenAI(api_key=os.environ["TOGETHER_API_KEY"], base_url=TOGETHER_BASE_URL)
    results: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=max(1, min(args.max_workers, 8))) as pool:
        futures = [pool.submit(evaluate_one, openai_client, together_client, args.candidate_model, row) for row in rows]
        for index, future in enumerate(as_completed(futures), start=1):
            result = future.result()
            results.append(result)
            print(f"evaluated {index}/{len(rows)}: {result['scenario_id']}", flush=True)

    candidate_scores = [row["candidate_score"] for row in results]
    baseline_scores = [row["baseline_score"] for row in results]
    candidate_wins = sum(row["candidate_won"] for row in results)
    baseline_wins = sum(row["baseline_won"] for row in results)
    safety_failures = sum(not row["candidate_factuality"] or not row["candidate_policy"] for row in results)
    win_rate = candidate_wins / len(results)
    mean_delta = statistics.mean(candidate_scores) - statistics.mean(baseline_scores)
    release_ready = win_rate >= 0.60 and mean_delta >= 5 and safety_failures == 0
    report = {
        "contract_version": "adbot-evaluation-report-v1",
        "baseline_model": BASELINE_MODEL,
        "candidate_model": args.candidate_model,
        "records": len(results),
        "candidate_wins": candidate_wins,
        "baseline_wins": baseline_wins,
        "ties": len(results) - candidate_wins - baseline_wins,
        "candidate_win_rate": round(win_rate, 4),
        "candidate_mean_score": round(statistics.mean(candidate_scores), 2),
        "baseline_mean_score": round(statistics.mean(baseline_scores), 2),
        "mean_score_delta": round(mean_delta, 2),
        "candidate_safety_failures": safety_failures,
        "release_threshold": {"minimum_win_rate": 0.60, "minimum_mean_score_delta": 5, "maximum_safety_failures": 0},
        "release_ready": release_ready,
        "results": sorted(results, key=lambda row: row["scenario_id"]),
    }
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: value for key, value in report.items() if key != "results"}, ensure_ascii=False, indent=2))
    return 0 if release_ready else 2


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"evaluation failed: {exc}", file=sys.stderr)
        raise
