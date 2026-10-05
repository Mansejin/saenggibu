from __future__ import annotations

import json
import os
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from . import datastore
from .api_errors import friendly_api_error
from .config import JOBS_DIR, ensure_data_dirs
from .generator import generate_for_student
from .io_utils import save_json
from .models import new_id
from .storage_policy import apply_run_draft, apply_run_drafts, draft_map_from_items, store_generated_on_server
from .student_store import get_student, list_students
from .write_sections import (
    ALL_TARGETS_SECTION,
    normalize_write_sections,
    pending_sections_for_student,
    students_needing_section,
    students_with_any_pending,
)

# A worker holding the lease is assumed dead once it expires; matches the serverless max duration.
LEASE_SEC = 300


@dataclass
class RunJob:
    id: str
    kind: str = "run"
    status: str = "pending"  # pending | running | done | error
    section: str = ""
    all_targets: bool = False
    student_id: str | None = None
    limit: int | None = None
    total: int = 0
    processed: int = 0
    current_section: str = ""
    current_label: str = ""
    message: str = ""
    result: dict[str, Any] = field(default_factory=dict)
    errors: list[dict[str, str]] = field(default_factory=list)
    drafts: list[dict[str, Any]] = field(default_factory=list)
    created_at: str = ""
    updated_at: str = ""
    planned: bool = False
    tasks: list[list[str]] = field(default_factory=list)
    cursor: int = 0
    results: dict[str, dict[str, Any]] = field(default_factory=dict)
    last_student: dict[str, Any] = field(default_factory=dict)
    lease_token: str = ""
    lease_until: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def _job_budget_sec() -> float:
    raw = os.getenv("SGB_JOB_BUDGET_SEC", "").strip()
    if raw:
        try:
            return max(0.0, float(raw))
        except ValueError:
            pass
    return 180.0 if os.getenv("VERCEL") else 0.0


def _job_path(job_id: str) -> Path:
    return JOBS_DIR / f"{job_id}.json"


def _set_lease(job: RunJob, token: str) -> None:
    job.lease_token = token
    job.lease_until = (_now() + timedelta(seconds=LEASE_SEC)).isoformat()


def _lease_expired(job: RunJob) -> bool:
    if not job.lease_until:
        return True
    try:
        return datetime.fromisoformat(job.lease_until) <= _now()
    except ValueError:
        return True


def create_run_job(
    *,
    sections: list[str] | None = None,
    all_targets: bool = False,
    student_id: str | None = None,
    limit: int | None = None,
    drafts: list[dict[str, Any]] | None = None,
) -> RunJob:
    ensure_data_dirs()
    if all_targets:
        section = ALL_TARGETS_SECTION
    else:
        section = normalize_write_sections(sections)[0]
    job = RunJob(
        id=new_id("job"),
        section=section,
        all_targets=all_targets,
        student_id=student_id,
        limit=limit,
        drafts=drafts or [],
        created_at=_now_iso(),
        updated_at=_now_iso(),
    )
    _set_lease(job, new_id("lease"))
    save_job(job)
    return job


def save_job(job: RunJob) -> RunJob:
    ensure_data_dirs()
    job.updated_at = _now_iso()
    save_json(_job_path(job.id), job.to_dict())
    return job


def get_job(job_id: str) -> RunJob | None:
    path = _job_path(job_id)
    try:
        data = json.loads(datastore.read_text(path))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    known = RunJob.__dataclass_fields__
    return RunJob(**{key: value for key, value in data.items() if key in known})


def claim_stalled_job(job_id: str) -> str | None:
    """Take over an unfinished job whose worker stopped; returns the new lease token."""
    job = get_job(job_id)
    if not job or job.status in ("done", "error") or not _lease_expired(job):
        return None
    token = new_id("lease")
    _set_lease(job, token)
    save_job(job)
    return token


def _batch_result_item(updated) -> dict[str, Any]:
    item: dict[str, Any] = {
        "id": updated.id,
        "name": updated.display_name,
        "status": updated.status,
    }
    if not store_generated_on_server():
        item["generated"] = updated.generated
    return item


def _is_single(job: RunJob) -> bool:
    return bool(job.student_id)


def _get_student_for_run(student_id: str, draft_map: dict[str, dict[str, Any]]):
    student = get_student(student_id)
    if not student:
        return None
    return apply_run_draft(student, draft_map.get(student_id))


def _plan_tasks(job: RunJob) -> list[list[str]]:
    draft_map = draft_map_from_items(job.drafts)
    if job.student_id:
        student = _get_student_for_run(job.student_id, draft_map)
        if not student:
            raise ValueError("학생을 찾을 수 없습니다.")
        job.current_label = student.display_name
        if job.all_targets:
            return [[student.id, section] for section in pending_sections_for_student(student)]
        return [[student.id, job.section]]

    students = apply_run_drafts(list_students(), draft_map)
    if job.all_targets:
        students = students_with_any_pending(students)
        if job.limit:
            students = students[: job.limit]
        return [[s.id, section] for s in students for section in pending_sections_for_student(s)]
    students = students_needing_section(students, job.section)
    if job.limit:
        students = students[: job.limit]
    return [[s.id, job.section] for s in students]


def _remember_draft(job: RunJob, updated) -> None:
    if store_generated_on_server() or not updated.generated:
        return
    job.drafts = [item for item in job.drafts if item.get("student_id") != updated.id]
    job.drafts.append({"student_id": updated.id, "generated": updated.generated})


def _empty_message(job: RunJob) -> str:
    if job.all_targets:
        return "작성이 필요한 항목이 없습니다." if _is_single(job) else "작성이 필요한 학생·항목이 없습니다."
    return f"작성이 필요한 학생이 없습니다 ({job.section})."


def _finish(job: RunJob) -> RunJob:
    job.status = "done"
    job.lease_until = ""
    if job.total and not job.message.startswith("작성이 필요"):
        job.message = "완료"
    if _is_single(job):
        job.processed = job.total if job.all_targets else min(job.total, 1)
        result: dict[str, Any] = {"mode": "single"}
        if job.all_targets:
            result["all_targets"] = True
            result["sections_done"] = [section for _, section in job.tasks]
        else:
            result["section"] = job.section
        if job.last_student:
            result["student"] = job.last_student
        elif job.student_id:
            student = _get_student_for_run(job.student_id, draft_map_from_items(job.drafts))
            if student:
                result["student"] = student.to_dict()
        job.result = result
        return save_job(job)

    results = list(job.results.values())
    if not job.all_targets:
        job.processed = len(results)
    job.result = {
        "mode": "batch",
        **({"all_targets": True} if job.all_targets else {"section": job.section}),
        "processed": len(results),
        "errors": job.errors,
        "results": results,
    }
    return save_job(job)


def execute_run_job(job_id: str, lease_token: str | None = None) -> RunJob:
    job = get_job(job_id)
    if not job:
        raise ValueError(f"job not found: {job_id}")
    if job.status in ("done", "error"):
        return job
    if lease_token is None:
        lease_token = job.lease_token
    if job.lease_token != lease_token:
        return job

    started = time.monotonic()
    budget = _job_budget_sec()
    job.status = "running"
    if not job.planned:
        job.message = "작성을 시작합니다."
    _set_lease(job, lease_token)
    save_job(job)

    try:
        if not job.planned:
            job.tasks = _plan_tasks(job)
            job.total = len(job.tasks)
            job.planned = True
            if not job.tasks:
                job.message = _empty_message(job)
                return _finish(job)
            save_job(job)

        while job.cursor < len(job.tasks):
            if budget and time.monotonic() - started > budget:
                job.lease_until = ""
                job.message = f"이어서 작성합니다... ({job.cursor}/{job.total})"
                return save_job(job)

            student_id, section = job.tasks[job.cursor]
            student = _get_student_for_run(student_id, draft_map_from_items(job.drafts))
            if not student:
                if _is_single(job):
                    raise ValueError("학생을 찾을 수 없습니다.")
                job.errors.append({"id": student_id, "name": student_id, "error": "학생을 찾을 수 없습니다."})
                job.cursor += 1
                job.processed = job.cursor
                save_job(job)
                continue

            job.current_label = student.display_name
            job.current_section = section
            job.processed = job.cursor
            job.message = f"{student.display_name} · {section} 작성 중..."
            _set_lease(job, lease_token)
            save_job(job)
            try:
                updated = generate_for_student(
                    student,
                    sections=[section],
                    progress=lambda sec, message, s=student, sec_name=section: _update_job_progress(
                        job_id, message, s.display_name, sec_name
                    ),
                )
            except Exception as exc:
                if _is_single(job):
                    raise
                job.errors.append({"id": student.id, "name": student.display_name, "error": friendly_api_error(exc)})
            else:
                _remember_draft(job, updated)
                job.results[updated.id] = _batch_result_item(updated)
                if _is_single(job):
                    job.last_student = updated.to_dict()
            job.cursor += 1
            job.processed = job.cursor
            save_job(job)

        return _finish(job)
    except Exception as exc:
        job.status = "error"
        job.lease_until = ""
        job.message = friendly_api_error(exc)
        job.errors.append({"id": job.id, "error": friendly_api_error(exc)})
        return save_job(job)


def _update_job_progress(
    job_id: str,
    message: str,
    current_label: str | None = None,
    current_section: str | None = None,
) -> None:
    job = get_job(job_id)
    if not job:
        return
    job.message = message
    if current_label:
        job.current_label = current_label
    if current_section:
        job.current_section = current_section
    save_job(job)
