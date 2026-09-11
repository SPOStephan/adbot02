#!/usr/bin/env python3
"""Generate Adbot's rights-clean cross-platform seed corpus.

The script uses only fictional brands and product facts from seed-spec.json.
It never reads customer data or third-party ad creatives. A cheap teacher creates
candidate packages; an independent stronger judge must accept the preferred
candidate before it enters train/eval data.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import pathlib
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

from openai import OpenAI

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC_PATH = ROOT / "training/ad-intelligence/seed-spec.json"
OUTPUT_DIR = ROOT / "training/ad-intelligence/v1"
CONTRACT_VERSION = "adbot-ad-intelligence-v1"
TEACHER_MODEL = "gpt-5-mini"
JUDGE_MODEL = "gpt-5"

PACKAGE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "contract_version": {"type": "string", "const": CONTRACT_VERSION},
        "platform": {"type": "string", "enum": ["meta", "openai_ads", "google", "tiktok"]},
        "strategy": {
            "type": "object",
            "properties": {
                "audience_insight": {"type": "string"},
                "big_idea": {"type": "string"},
                "value_proposition": {"type": "string"},
                "proof_angle": {"type": "string"},
                "funnel_stage": {"type": "string", "enum": ["awareness", "consideration", "conversion", "retention"]},
            },
            "required": ["audience_insight", "big_idea", "value_proposition", "proof_angle", "funnel_stage"],
            "additionalProperties": False,
        },
        "copy": {
            "type": "object",
            "properties": {
                "primary_text": {"type": "string"},
                "headline": {"type": "string"},
                "description": {"type": "string"},
                "cta": {"type": "string"},
                "search_headlines": {"type": "array", "items": {"type": "string"}, "maxItems": 15},
                "search_descriptions": {"type": "array", "items": {"type": "string"}, "maxItems": 4},
                "video_hook": {"type": "string"},
                "voiceover": {"type": "string"},
            },
            "required": ["primary_text", "headline", "description", "cta", "search_headlines", "search_descriptions", "video_hook", "voiceover"],
            "additionalProperties": False,
        },
        "creative": {
            "type": "object",
            "properties": {
                "concept": {"type": "string"},
                "image_prompt": {"type": "string"},
                "visual_hierarchy": {"type": "array", "items": {"type": "string"}, "maxItems": 8},
                "format_notes": {"type": "string"},
            },
            "required": ["concept", "image_prompt", "visual_hierarchy", "format_notes"],
            "additionalProperties": False,
        },
        "compliance": {
            "type": "object",
            "properties": {
                "claims_to_verify": {"type": "array", "items": {"type": "string"}, "maxItems": 12},
                "prohibited_assumptions": {"type": "array", "items": {"type": "string"}, "maxItems": 12},
            },
            "required": ["claims_to_verify", "prohibited_assumptions"],
            "additionalProperties": False,
        },
    },
    "required": ["contract_version", "platform", "strategy", "copy", "creative", "compliance"],
    "additionalProperties": False,
}

PAIR_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "preferred": PACKAGE_SCHEMA,
        "rejected": PACKAGE_SCHEMA,
        "rejection_reasons": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": 6},
    },
    "required": ["preferred", "rejected", "rejection_reasons"],
    "additionalProperties": False,
}

JUDGE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "accepted": {"type": "boolean"},
        "preferred_score": {"type": "integer", "minimum": 0, "maximum": 100},
        "rejected_score": {"type": "integer", "minimum": 0, "maximum": 100},
        "factuality_pass": {"type": "boolean"},
        "policy_pass": {"type": "boolean"},
        "platform_fit_pass": {"type": "boolean"},
        "reasons": {"type": "array", "items": {"type": "string"}, "maxItems": 8},
    },
    "required": ["accepted", "preferred_score", "rejected_score", "factuality_pass", "policy_pass", "platform_fit_pass", "reasons"],
    "additionalProperties": False,
}

RUNTIME_SYSTEM_PROMPT = (
    "Du bist der plattformübergreifende Adbot-Kreativkern. "
    f"Antworte ausschließlich als JSON nach {CONTRACT_VERSION}. "
    "Entwickle eine belegbare Werbestrategie, keine erfundenen Produktfakten. "
    "Nutze nur Fakten aus dem Briefing und kennzeichne zu prüfende Claims. "
    "Erzeuge eigenständige Formulierungen ohne reale Marken, Slogans oder Vorlagen nachzuahmen. "
    "Verwende freigegebene Brand-Assets zuerst und plane neue Assets nur für fehlende Formate. "
    "Passe Copy, Format und Creative-Brief an die Zielplattform an. "
    "Alle Felder des Vertrags müssen vorhanden sein; nicht benötigte Textfelder und Listen bleiben leer."
)

TEACHER_SYSTEM_PROMPT = (
    "Du erstellst Trainingsbeispiele für den plattformübergreifenden Adbot-Kreativkern. "
    "Alle Marken sind ausdrücklich fiktiv. Verwende ausschließlich Fakten aus dem Briefing. "
    "Erzeuge eine starke bevorzugte und eine plausible, aber strategisch schwächere abgelehnte Antwort. "
    "Die schwächere Antwort darf weder gefährlich noch rechtswidrig sein; sie soll an Klarheit, Ziel-Fit, "
    "Belegbarkeit oder Plattform-Fit scheitern. Kopiere keine realen Slogans oder Anzeigen. "
    "Für Meta priorisiere Feed/Story-Copy, für ChatGPT Ads kontextuelle Klarheit und hilfreiche Relevanz, "
    "Für Meta: primary_text 1–125, headline 1–40, description 0–25 Zeichen. "
    "Für ChatGPT Ads: primary_text 1–100 und headline 3–50 Zeichen. "
    "Für Google Search: primary_text/headline/description leer lassen, 3–15 search_headlines mit je maximal 30 "
    "und 2–4 search_descriptions mit je maximal 90 Zeichen. Für TikTok: primary_text 1–100 Zeichen ohne Emoji, "
    "Hashtag oder @ und einen sofortigen Video-Hook erzeugen. "
    "Nicht benötigte plattformspezifische Textfelder und Listen bleiben leer. Antworte nur im geforderten JSON-Schema."
)

JUDGE_PROMPT = (
    "Du bist ein unabhängiger Qualitätsrichter für Werbekampagnen. Akzeptiere ein Paar nur, wenn die "
    "bevorzugte Antwort faktentreu, eigenständig, plattformgerecht, konkret und klar besser als die "
    "abgelehnte Antwort ist. Lehne erfundene Fakten, unbelegte Garantien, sensible Zuschreibungen, reale "
    "Markenimitation und nur kosmetische Unterschiede ab. Mindestscore bevorzugt: 82; Mindestabstand: 15."
)


def json_schema(name: str, schema: dict[str, Any]) -> dict[str, Any]:
    return {"type": "json_schema", "json_schema": {"name": name, "strict": True, "schema": schema}}


def pair_schema_for(platform: str) -> dict[str, Any]:
    schema = copy.deepcopy(PAIR_SCHEMA)
    for output_name in ("preferred", "rejected"):
        fields = schema["properties"][output_name]["properties"]["copy"]["properties"]
        if platform == "meta":
            fields["primary_text"].update(minLength=1, maxLength=125)
            fields["headline"].update(minLength=1, maxLength=40)
            fields["description"].update(maxLength=25)
            fields["search_headlines"].update(maxItems=0)
            fields["search_descriptions"].update(maxItems=0)
        elif platform == "openai_ads":
            fields["primary_text"].update(minLength=1, maxLength=100)
            fields["headline"].update(minLength=3, maxLength=50)
            fields["search_headlines"].update(maxItems=0)
            fields["search_descriptions"].update(maxItems=0)
        elif platform == "google":
            fields["primary_text"].update(maxLength=0)
            fields["headline"].update(maxLength=0)
            fields["description"].update(maxLength=0)
            fields["search_headlines"].update(minItems=3, maxItems=15)
            fields["search_headlines"]["items"].update(minLength=1, maxLength=30)
            fields["search_descriptions"].update(minItems=2, maxItems=4)
            fields["search_descriptions"]["items"].update(minLength=1, maxLength=90)
        elif platform == "tiktok":
            fields["primary_text"].update(minLength=1, maxLength=100)
            fields["search_headlines"].update(maxItems=0)
            fields["search_descriptions"].update(maxItems=0)
    return schema


def canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def validate_platform_package(package: dict[str, Any], platform: str) -> None:
    if package.get("platform") != platform:
        raise ValueError("package platform does not match brief")
    copy = package["copy"]
    if platform == "meta":
        if not 1 <= len(copy["primary_text"]) <= 125:
            raise ValueError("Meta primary_text must contain 1-125 characters")
        if not 1 <= len(copy["headline"]) <= 40:
            raise ValueError("Meta headline must contain 1-40 characters")
        if len(copy["description"]) > 25:
            raise ValueError("Meta description must contain at most 25 characters")
    elif platform == "openai_ads":
        if not 1 <= len(copy["primary_text"]) <= 100:
            raise ValueError("OpenAI Ads body must contain 1-100 characters")
        if not 3 <= len(copy["headline"]) <= 50:
            raise ValueError("OpenAI Ads title must contain 3-50 characters")
    elif platform == "google":
        headlines = copy["search_headlines"]
        descriptions = copy["search_descriptions"]
        if not 3 <= len(headlines) <= 15 or any(not 1 <= len(item) <= 30 for item in headlines):
            raise ValueError("Google requires 3-15 headlines with at most 30 characters")
        if not 2 <= len(descriptions) <= 4 or any(not 1 <= len(item) <= 90 for item in descriptions):
            raise ValueError("Google requires 2-4 descriptions with at most 90 characters")
        if copy["primary_text"] or copy["headline"] or copy["description"]:
            raise ValueError("Google generic copy fields must stay empty")
    elif platform == "tiktok":
        ad_text = copy["primary_text"]
        if not 1 <= len(ad_text) <= 100:
            raise ValueError("TikTok ad text must contain 1-100 characters")
        if "@" in ad_text or "#" in ad_text or any(ord(char) > 0xFFFF for char in ad_text):
            raise ValueError("TikTok ad text must not contain @, hashtags or emoji")
        if not copy["video_hook"] or not copy["voiceover"]:
            raise ValueError("TikTok requires video_hook and voiceover")


def scenario_id(brief: dict[str, Any]) -> str:
    return hashlib.sha256(canonical(brief).encode("utf-8")).hexdigest()[:20]


def build_scenarios(spec: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for industry in spec["industries"]:
        for objective in spec["objectives"]:
            for platform in spec["platforms"]:
                brief = {
                    "contract_version": CONTRACT_VERSION,
                    "platform": platform,
                    "industry": industry["name"],
                    "objective": objective["value"],
                    "funnel_stage": objective["funnel_stage"],
                    "market": spec["market"],
                    "language": spec["language"],
                    "brand_name": industry["brand"],
                    "offer": industry["offers"][objective["value"]],
                    "audience": industry["audience"],
                    "objective_detail": objective["intent"],
                    "required_facts": industry["required_facts"],
                    "forbidden_claims": industry["forbidden_claims"],
                    "brand_assets": [],
                    "asset_policy": "reuse_first_then_generate_missing",
                    "data_origin": "synthetic_first_party",
                }
                brief["scenario_id"] = scenario_id(brief)
                rows.append(brief)
    return rows


def completion(client: OpenAI, model: str, system: str, user: str, schema_name: str, schema: dict[str, Any]) -> tuple[dict[str, Any], dict[str, int]]:
    response = client.chat.completions.create(
        model=model,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        response_format=json_schema(schema_name, schema),
        max_completion_tokens=7000,
    )
    content = response.choices[0].message.content
    if not content:
        raise RuntimeError(f"{model} returned no content")
    usage = {
        "input_tokens": int(getattr(response.usage, "prompt_tokens", 0) or 0),
        "output_tokens": int(getattr(response.usage, "completion_tokens", 0) or 0),
    }
    return json.loads(content), usage


def generate_one(client: OpenAI, brief: dict[str, Any], attempts: int = 5) -> dict[str, Any]:
    user = "BRIEFING:\n" + json.dumps(brief, ensure_ascii=False, indent=2)
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            pair, teacher_usage = completion(
                client,
                TEACHER_MODEL,
                TEACHER_SYSTEM_PROMPT,
                user,
                "adbot_training_pair",
                pair_schema_for(brief["platform"]),
            )
            validate_platform_package(pair["preferred"], brief["platform"])
            validate_platform_package(pair["rejected"], brief["platform"])
            judge_input = json.dumps({"brief": brief, "pair": pair}, ensure_ascii=False)
            judge, judge_usage = completion(client, JUDGE_MODEL, JUDGE_PROMPT, judge_input, "adbot_training_judgment", JUDGE_SCHEMA)
            accepted = (
                judge["accepted"]
                and judge["factuality_pass"]
                and judge["policy_pass"]
                and judge["platform_fit_pass"]
                and judge["preferred_score"] >= 82
                and judge["preferred_score"] - judge["rejected_score"] >= 15
            )
            if not accepted:
                raise RuntimeError("judge rejected pair: " + "; ".join(judge["reasons"]))
            return {
                "scenario_id": brief["scenario_id"],
                "brief": brief,
                "preferred": pair["preferred"],
                "rejected": pair["rejected"],
                "rejection_reasons": pair["rejection_reasons"],
                "judgment": judge,
                "usage": {"teacher": teacher_usage, "judge": judge_usage},
            }
        except Exception as exc:  # bounded retry with deterministic scenario input
            last_error = exc
            if attempt + 1 < attempts:
                time.sleep(2 ** attempt)
    raise RuntimeError(f"{brief['scenario_id']}: {last_error}")


def split_for(brief: dict[str, Any]) -> str:
    group = f"{brief['industry']}|{brief['objective']}"
    bucket = int(hashlib.sha256(("adbot-v1-split|" + group).encode()).hexdigest()[:8], 16) % 10
    return "eval" if bucket < 2 else "train"


def conversation(record: dict[str, Any]) -> dict[str, Any]:
    return {
        "messages": [
            {"role": "system", "content": RUNTIME_SYSTEM_PROMPT},
            {"role": "user", "content": json.dumps(record["brief"], ensure_ascii=False, sort_keys=True)},
            {"role": "assistant", "content": json.dumps(record["preferred"], ensure_ascii=False, sort_keys=True)},
        ],
        "weight": 1.0,
    }


def preference(record: dict[str, Any]) -> dict[str, Any]:
    return {
        "input": {
            "messages": [
                {"role": "system", "content": RUNTIME_SYSTEM_PROMPT},
                {"role": "user", "content": json.dumps(record["brief"], ensure_ascii=False, sort_keys=True)},
            ]
        },
        "preferred_output": [{"role": "assistant", "content": json.dumps(record["preferred"], ensure_ascii=False, sort_keys=True)}],
        "non_preferred_output": [{"role": "assistant", "content": json.dumps(record["rejected"], ensure_ascii=False, sort_keys=True)}],
    }


def write_jsonl(path: pathlib.Path, rows: list[dict[str, Any]]) -> None:
    path.write_text("".join(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n" for row in rows), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-workers", type=int, default=4)
    parser.add_argument("--limit", type=int, default=0, help="Development-only scenario limit")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--scenario-id", default="", help="Generate exactly one scenario as JSON")
    args = parser.parse_args()

    if not os.environ.get("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY is required in the sandbox environment")
    spec = json.loads(SPEC_PATH.read_text(encoding="utf-8"))
    scenarios = build_scenarios(spec)
    if args.scenario_id:
        matches = [row for row in scenarios if row["scenario_id"] == args.scenario_id]
        if len(matches) != 1:
            raise RuntimeError(f"Unknown scenario id: {args.scenario_id}")
        print(json.dumps(generate_one(OpenAI(timeout=120.0, max_retries=1), matches[0]), ensure_ascii=False))
        return 0
    if args.limit > 0:
        scenarios = scenarios[: args.limit]

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    raw_path = OUTPUT_DIR / "records.jsonl"
    by_id: dict[str, dict[str, Any]] = {}
    if args.resume and raw_path.exists():
        for line in raw_path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                row = json.loads(line)
                by_id[row["scenario_id"]] = row

    todo = [row for row in scenarios if row["scenario_id"] not in by_id]
    client = OpenAI(timeout=120.0, max_retries=1)
    with ThreadPoolExecutor(max_workers=max(1, min(args.max_workers, 8))) as pool:
        futures = {pool.submit(generate_one, client, row): row for row in todo}
        for index, future in enumerate(as_completed(futures), start=1):
            row = future.result()
            by_id[row["scenario_id"]] = row
            ordered = [by_id[item["scenario_id"]] for item in scenarios if item["scenario_id"] in by_id]
            write_jsonl(raw_path, ordered)
            print(f"accepted {index}/{len(todo)}: {row['scenario_id']}", flush=True)

    records = [by_id[row["scenario_id"]] for row in scenarios]
    train = [conversation(row) for row in records if split_for(row["brief"]) == "train"]
    evaluation = [conversation(row) for row in records if split_for(row["brief"]) == "eval"]
    preferences = [preference(row) for row in records if split_for(row["brief"]) == "train"]
    write_jsonl(OUTPUT_DIR / "train.jsonl", train)
    write_jsonl(OUTPUT_DIR / "eval.jsonl", evaluation)
    write_jsonl(OUTPUT_DIR / "preferences.jsonl", preferences)

    platforms: dict[str, int] = {}
    industries: dict[str, int] = {}
    total_usage = {"teacher_input": 0, "teacher_output": 0, "judge_input": 0, "judge_output": 0}
    for row in records:
        platform = row["brief"]["platform"]
        industry = row["brief"]["industry"]
        platforms[platform] = platforms.get(platform, 0) + 1
        industries[industry] = industries.get(industry, 0) + 1
        total_usage["teacher_input"] += row["usage"]["teacher"]["input_tokens"]
        total_usage["teacher_output"] += row["usage"]["teacher"]["output_tokens"]
        total_usage["judge_input"] += row["usage"]["judge"]["input_tokens"]
        total_usage["judge_output"] += row["usage"]["judge"]["output_tokens"]

    manifest = {
        "contract_version": "adbot-training-manifest-v1",
        "dataset_version": "adbot-cross-platform-seed-v1",
        "source": "synthetic_first_party",
        "contains_customer_data": False,
        "contains_third_party_ads": False,
        "teacher_model": TEACHER_MODEL,
        "judge_model": JUDGE_MODEL,
        "records": len(records),
        "train_records": len(train),
        "eval_records": len(evaluation),
        "preference_records": len(preferences),
        "platform_distribution": platforms,
        "industry_distribution": industries,
        "usage": total_usage,
        "split_rule": "sha256(adbot-v1-split|industry|objective) modulo 10; buckets 0-1 eval; all platforms stay in one split",
        "rights_note": "Fictional brands and offers generated from Adbot-owned seed specifications; no customer or third-party ad content.",
    }
    (OUTPUT_DIR / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"seed generation failed: {exc}", file=sys.stderr)
        raise
