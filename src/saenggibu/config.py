from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent.parent
load_dotenv(ROOT / ".env")
load_dotenv(ROOT / ".env.local", override=True)

DATA_DIR = ROOT / "data" / "saenggibu"
SAMPLES_DIR = DATA_DIR / "samples"
STUDENTS_DIR = DATA_DIR / "students"
OUTPUTS_DIR = DATA_DIR / "outputs"
JOBS_DIR = DATA_DIR / "jobs"
PATTERNS_PATH = DATA_DIR / "patterns.json"
PROMPT_PATH = ROOT / "prompts" / "saenggibu.md"

CHANGCHE_SUBSECTIONS = ("자율", "동아리", "봉사", "진로")


def get_gemini_api_key() -> str:
    key = os.getenv("GEMINI_API_KEY", "").strip()
    if not key:
        raise RuntimeError(
            "GEMINI_API_KEY가 .env에 설정되지 않았습니다. "
            "https://aistudio.google.com/apikey 에서 발급 후 설정하세요."
        )
    return key


def get_gemini_model_pro() -> str:
    """생기부 작성·샘플 분석용 (3.1 Pro)."""
    explicit = os.getenv("GEMINI_MODEL_PRO", "").strip()
    if explicit:
        return explicit
    legacy = os.getenv("GEMINI_MODEL", "gemini-3.1-pro-preview").strip()
    return legacy or "gemini-3.1-pro-preview"


def get_gemini_model() -> str:
    """생기부 작성 모델 (Pro)."""
    return get_gemini_model_pro()


def gemini_models_for_api() -> dict[str, str]:
    return {
        "gemini_model": get_gemini_model_pro(),
        "gemini_model_pro": get_gemini_model_pro(),
    }


def is_dev_mode() -> bool:
    return os.getenv("SGB_DEV", "").strip().lower() in ("1", "true", "yes")


def ensure_data_dirs() -> None:
    from .datastore import ensure_dir

    for path in (SAMPLES_DIR, STUDENTS_DIR, OUTPUTS_DIR, JOBS_DIR):
        ensure_dir(path)
