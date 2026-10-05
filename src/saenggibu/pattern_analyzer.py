from __future__ import annotations

import json
import re
import statistics
from typing import Any

from .config import PATTERNS_PATH, PROMPT_PATH, ensure_data_dirs
from .models import SampleRecord
from .sample_store import list_samples


def _sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?…])\s+|[\n\r]+", text.strip())
    return [p.strip() for p in parts if p.strip()]


def _char_count(text: str) -> int:
    return len(re.sub(r"\s+", "", text))


def _analyze_text_block(text: str) -> dict[str, Any]:
    if not text.strip():
        return {"char_count": 0, "sentence_count": 0, "avg_sentence_length": 0, "samples": []}

    sents = _sentences(text)
    lengths = [_char_count(s) for s in sents] or [0]
    return {
        "char_count": _char_count(text),
        "sentence_count": len(sents),
        "avg_sentence_length": round(statistics.mean(lengths), 1),
        "samples": sents[:3],
    }


def _collect_section_texts(samples: list[SampleRecord]) -> dict[str, list[str]]:
    buckets: dict[str, list[str]] = {"행발": [], "창체_자율": [], "창체_동아리": [], "창체_봉사": [], "창체_진로": []}
    subject_texts: dict[str, list[str]] = {}

    for sample in samples:
        sections = sample.sections or {}
        if sections.get("행발"):
            buckets["행발"].append(str(sections["행발"]))

        changche = sections.get("창체") or {}
        if isinstance(changche, dict):
            for key in ("자율", "동아리", "봉사", "진로"):
                if changche.get(key):
                    buckets[f"창체_{key}"].append(str(changche[key]))

        setuk = sections.get("세특") or {}
        if isinstance(setuk, dict):
            for subject, text in setuk.items():
                if text:
                    subject_texts.setdefault(str(subject), []).append(str(text))

    buckets["세특"] = subject_texts
    return buckets


def analyze_patterns_local(samples: list[SampleRecord] | None = None) -> dict[str, Any]:
    samples = samples or list_samples()
    if not samples:
        raise ValueError("분석할 샘플이 없습니다. 먼저 `sgb.py samples import`로 과거 생기부를 넣으세요.")

    buckets = _collect_section_texts(samples)
    stats: dict[str, Any] = {
        "sample_count": len(samples),
        "sections": {},
    }

    for key in ("행발", "창체_자율", "창체_동아리", "창체_봉사", "창체_진로"):
        texts = buckets.get(key, [])
        if not texts:
            continue
        char_counts = [_char_count(t) for t in texts]
        sent_counts = [len(_sentences(t)) for t in texts]
        stats["sections"][key] = {
            "count": len(texts),
            "char_count": {
                "min": min(char_counts),
                "max": max(char_counts),
                "avg": round(statistics.mean(char_counts), 1),
            },
            "sentence_count": {
                "min": min(sent_counts),
                "max": max(sent_counts),
                "avg": round(statistics.mean(sent_counts), 1),
            },
            "examples": [_analyze_text_block(t) for t in texts[:2]],
        }

    setuk_stats: dict[str, Any] = {}
    for subject, texts in buckets.get("세특", {}).items():
        char_counts = [_char_count(t) for t in texts]
        sent_counts = [len(_sentences(t)) for t in texts]
        setuk_stats[subject] = {
            "count": len(texts),
            "char_count": {
                "min": min(char_counts),
                "max": max(char_counts),
                "avg": round(statistics.mean(char_counts), 1),
            },
            "sentence_count": {
                "min": min(sent_counts),
                "max": max(sent_counts),
                "avg": round(statistics.mean(sent_counts), 1),
            },
            "examples": texts[:2],
        }
    if setuk_stats:
        stats["sections"]["세특"] = setuk_stats

    return stats


def build_style_guide_text(patterns: dict[str, Any]) -> str:
    lines = [
        "# 생기부 스타일 가이드 (샘플 자동 분석)",
        f"- 학습 샘플 수: {patterns.get('sample_count', 0)}",
        "",
        "## 영역별 글자 수·문장 수 목표",
    ]

    for section, info in patterns.get("sections", {}).items():
        if section == "세특" and isinstance(info, dict):
            lines.append("\n### 세특 (과목별)")
            for subject, sub in info.items():
                cc = sub["char_count"]
                sc = sub["sentence_count"]
                lines.append(
                    f"- {subject}: 글자 {cc['min']}~{cc['max']}자(평균 {cc['avg']}), "
                    f"문장 {sc['min']}~{sc['max']}개(평균 {sc['avg']})"
                )
            continue

        cc = info["char_count"]
        sc = info["sentence_count"]
        lines.append(
            f"- {section}: 글자 {cc['min']}~{cc['max']}자(평균 {cc['avg']}), "
            f"문장 {sc['min']}~{sc['max']}개(평균 {sc['avg']})"
        )

    base_rules = ""
    if PROMPT_PATH.exists():
        base_rules = PROMPT_PATH.read_text(encoding="utf-8")

    lines.extend(["", "## 기본 작성 규칙", base_rules])
    return "\n".join(lines)


def save_patterns(patterns: dict[str, Any], *, style_guide: str = "") -> dict[str, Any]:
    ensure_data_dirs()
    payload = {
        **patterns,
        "style_guide": style_guide or build_style_guide_text(patterns),
    }
    from .secure_io import save_secure_json

    save_secure_json(PATTERNS_PATH, payload)
    return payload


def load_patterns() -> dict[str, Any] | None:
    from . import datastore

    if not datastore.exists(PATTERNS_PATH):
        return None
    from .secure_io import load_secure_json

    try:
        data = load_secure_json(PATTERNS_PATH)
    except (OSError, ValueError, json.JSONDecodeError, RuntimeError):
        return None
    if not isinstance(data, dict) or data.get("__enc"):
        return None
    return data


def analyze_and_save(*, use_gemini: bool = False) -> dict[str, Any]:
    patterns = analyze_patterns_local()
    style_guide = build_style_guide_text(patterns)

    if use_gemini:
        from .gemini_client import refine_style_guide

        style_guide = refine_style_guide(patterns, style_guide)

    return save_patterns(patterns, style_guide=style_guide)


def update_style_guide(style_guide: str) -> dict[str, Any]:
    patterns = load_patterns()
    if not patterns:
        raise ValueError("먼저 샘플을 업로드하고 스타일 분석을 실행하세요.")
    return save_patterns(patterns, style_guide=style_guide.strip())
