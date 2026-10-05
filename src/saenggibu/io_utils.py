from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any


def save_json(path: Path, data: Any) -> None:
    from . import datastore

    datastore.write_text(path, json.dumps(data, ensure_ascii=False, indent=2))


def parse_tsv_rows(text: str) -> list[dict[str, str]]:
    lines = [line for line in text.strip().splitlines() if line.strip()]
    if not lines:
        return []

    delimiter = "\t" if "\t" in lines[0] else ","
    reader = csv.DictReader(lines, delimiter=delimiter)
    rows: list[dict[str, str]] = []
    for row in reader:
        cleaned = {k.strip(): (v or "").strip() for k, v in row.items() if k}
        if any(cleaned.values()):
            rows.append(cleaned)
    return rows


def read_table_file(path: Path) -> list[dict[str, str]]:
    return parse_tsv_rows(path.read_text(encoding="utf-8"))
