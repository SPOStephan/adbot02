#!/usr/bin/env python3
"""Upload, estimate and optionally start the Adbot LoRA training job.

The default mode stops after provider-side validation and a price estimate.
Starting a billed job requires both --submit and the exact confirmation phrase.
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "training/ad-intelligence/v1"
DEFAULT_MODEL = "Qwen/Qwen3.5-9B"
CONFIRMATION = "START_ADBOT_LORA_WITH_CHARGES"


def wait_for_file(client, file_id: str):
    deadline = time.time() + 30 * 60
    while time.time() < deadline:
        meta = client.files.retrieve(file_id)
        status = str(meta.processing_status)
        print(f"file {file_id}: {status}", flush=True)
        if status == "COMPLETED":
            return meta
        if status in {"INVALID_FORMAT", "FAILED"}:
            raise RuntimeError(f"Together rejected file {file_id}: {meta.validation_report}")
        time.sleep(5)
    raise TimeoutError(f"Together file processing timed out: {file_id}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--submit", action="store_true")
    parser.add_argument("--confirm", default="")
    args = parser.parse_args()

    if not os.environ.get("TOGETHER_API_KEY"):
        raise RuntimeError("TOGETHER_API_KEY fehlt.")
    try:
        from together import Together
    except ImportError as exc:
        raise RuntimeError(
            'Together SDK fehlt. Installiere es isoliert mit: pip install "together>=2.24.0"'
        ) from exc

    train_path = DATA_DIR / "train.jsonl"
    eval_path = DATA_DIR / "eval.jsonl"
    manifest_path = DATA_DIR / "manifest.json"
    for path in (train_path, eval_path, manifest_path):
        if not path.is_file() or path.stat().st_size == 0:
            raise RuntimeError(f"Fehlendes Trainingsartefakt: {path}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("contains_customer_data") or manifest.get("contains_third_party_ads"):
        raise RuntimeError("Nur der rechtebereinigte Seed-Korpus darf automatisch hochgeladen werden.")

    client = Together()
    train_file = client.files.upload(file=str(train_path), purpose="fine-tune", check=True)
    eval_file = client.files.upload(file=str(eval_path), purpose="fine-tune", check=True)
    wait_for_file(client, train_file.id)
    wait_for_file(client, eval_file.id)

    estimate = client.fine_tuning.estimate_price(
        training_file=train_file.id,
        validation_file=eval_file.id,
        model=args.model,
        n_epochs=args.epochs,
        n_evals=4,
        training_method={"method": "sft"},
        training_type={"type": "Lora", "lora_r": 8},
    )
    print(json.dumps({"training_file": train_file.id, "validation_file": eval_file.id, "estimate": str(estimate)}, indent=2))

    if not args.submit:
        print("Estimate-only: no billed fine-tuning job was started.")
        return 0
    if args.confirm != CONFIRMATION:
        raise RuntimeError(
            f"Billed training requires --confirm {CONFIRMATION}"
        )

    existing = client.fine_tuning.list()
    for job in getattr(existing, "data", []):
        if (
            getattr(job, "training_file", None) == train_file.id
            and str(getattr(job, "status", "")) in {"pending", "queued", "running", "uploading"}
        ):
            raise RuntimeError(f"Aktiver Job für dieselbe Datei existiert bereits: {job.id}")

    job = client.fine_tuning.create(
        training_file=train_file.id,
        validation_file=eval_file.id,
        model=args.model,
        n_epochs=args.epochs,
        n_checkpoints=1,
        n_evals=4,
        learning_rate=1e-5,
        warmup_ratio=0,
        train_on_inputs="auto",
        lora=True,
        suffix="adbot-cross-platform-v1",
    )
    print(json.dumps({"job_id": job.id, "status": str(job.status)}, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"training setup failed: {exc}", file=sys.stderr)
        raise
