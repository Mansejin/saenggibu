from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .api_errors import friendly_api_error
from .config import JOBS_DIR, ensure_data_dirs
from .generator import generate_for_student
from .io_utils import save_json
from .models import new_id
from .storage_policy import apply_run_draft, apply_run_drafts, draft_map_from_items
from .student_store import get_student, list_students
from .write_sections import (
    ALL_TARGETS_SECTION,
    normalize_write_sections,
    pending_sections_for_student,
    student_needs_section,
    students_needing_section,
    students_with_any_pending,
)


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

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _job_path(job_id: str) -> Path:
    return JOBS_DIR / f"{job_id}.json"


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
    save_job(job)
    return job


def save_job(job: RunJob) -> RunJob:
    ensure_data_dirs()
    job.updated_at = _now_iso()
    save_json(_job_path(job.id), job.to_dict())
    return job


def get_job(job_id: str) -> RunJob | None:
    path = _job_path(job_id)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    data.setdefault("all_targets", False)
    data.setdefault("current_section", "")
    data.setdefault("drafts", [])
    return RunJob(**data)


def _batch_result_item(updated) -> dict[str, Any]:
    from .storage_policy import store_generated_on_server

    item: dict[str, Any] = {
        "id": updated.id,
        "name": updated.display_name,
        "status": updated.status,
    }
    if not store_generated_on_server():
        item["generated"] = updated.generated
    return item


def _plan_all_target_tasks(students: list) -> list[tuple[str, str]]:
    tasks: list[tuple[str, str]] = []
    for student in students:
        for section in pending_sections_for_student(student):
            tasks.append((student.id, section))
    return tasks


def _job_draft_map(job: RunJob) -> dict[str, dict[str, Any]]:
    return draft_map_from_items(job.drafts)


def _get_student_for_run(student_id: str, draft_map: dict[str, dict[str, Any]]):
    student = get_student(student_id)
    if not student:
        return None
    return apply_run_draft(student, draft_map.get(student_id))


def execute_run_job(job_id: str) -> RunJob:
    job = get_job(job_id)
    if not job:
        raise ValueError(f"job not found: {job_id}")

    draft_map = _job_draft_map(job)
    job.status = "running"
    job.message = "작성을 시작합니다."
    save_job(job)

    try:
        if job.all_targets:
            return _execute_all_targets_job(job)

        sections = [job.section]
        if job.student_id:
            student = _get_student_for_run(job.student_id, draft_map)
            if not student:
                raise ValueError("학생을 찾을 수 없습니다.")
            if not student_needs_section(student, job.section):
                job.status = "done"
                job.total = 0
                job.processed = 0
                job.current_label = student.display_name
                job.current_section = job.section
                job.message = f"작성이 필요한 항목이 없습니다 ({job.section})."
                job.result = {
                    "mode": "single",
                    "section": job.section,
                    "processed": 0,
                    "skipped": True,
                    "student": student.to_dict(),
                }
                return save_job(job)
            job.total = 1
            job.current_label = student.display_name
            job.current_section = job.section
            save_job(job)
            updated = generate_for_student(
                student,
                sections=sections,
                progress=lambda section, message, s=student: _update_job_progress(
                    job_id, message, s.display_name, section
                ),
            )
            job.status = "done"
            job.processed = 1
            job.result = {"mode": "single", "section": job.section, "student": updated.to_dict()}
            job.message = "완료"
            return save_job(job)

        students = students_needing_section(
            apply_run_drafts(list_students(), draft_map),
            job.section,
        )
        if job.limit:
            students = students[: job.limit]
        job.total = len(students)
        save_job(job)

        if not students:
            job.status = "done"
            job.message = f"작성이 필요한 학생이 없습니다 ({job.section})."
            job.result = {
                "mode": "batch",
                "section": job.section,
                "processed": 0,
                "errors": [],
                "results": [],
            }
            return save_job(job)

        results: list[dict[str, Any]] = []
        errors: list[dict[str, str]] = []
        for index, student in enumerate(students, start=1):
            job.current_label = student.display_name
            job.current_section = job.section
            job.processed = index - 1
            job.message = f"{student.display_name} · {job.section} 작성 중..."
            save_job(job)
            try:
                updated = generate_for_student(
                    student,
                    sections=sections,
                    progress=lambda section, message, s=student: _update_job_progress(
                        job_id, message, s.display_name, section
                    ),
                )
                results.append(_batch_result_item(updated))
            except Exception as exc:
                errors.append({"id": student.id, "name": student.display_name, "error": friendly_api_error(exc)})

        job.status = "done"
        job.processed = len(results)
        job.errors = errors
        job.result = {
            "mode": "batch",
            "section": job.section,
            "processed": len(results),
            "errors": errors,
            "results": results,
        }
        job.message = "완료"
        return save_job(job)
    except Exception as exc:
        job.status = "error"
        job.message = friendly_api_error(exc)
        job.errors.append({"id": job.id, "error": friendly_api_error(exc)})
        return save_job(job)


def _execute_all_targets_job(job: RunJob) -> RunJob:
    draft_map = _job_draft_map(job)
    if job.student_id:
        student = _get_student_for_run(job.student_id, draft_map)
        if not student:
            raise ValueError("학생을 찾을 수 없습니다.")
        sections = pending_sections_for_student(student)
        job.total = len(sections)
        if not sections:
            job.status = "done"
            job.message = "작성이 필요한 항목이 없습니다."
            job.result = {
                "mode": "single",
                "all_targets": True,
                "student": student.to_dict(),
                "sections_done": [],
            }
            return save_job(job)

        current = student
        for index, section in enumerate(sections, start=1):
            job.current_label = current.display_name
            job.current_section = section
            job.processed = index - 1
            job.message = f"{current.display_name} · {section} 작성 중..."
            save_job(job)
            current = generate_for_student(
                current,
                sections=[section],
                progress=lambda sec, message, s=current, sec_name=section: _update_job_progress(
                    job.id, message, s.display_name, sec_name
                ),
            )
            job.processed = index
            save_job(job)

        job.status = "done"
        job.result = {
            "mode": "single",
            "all_targets": True,
            "student": current.to_dict(),
            "sections_done": sections,
        }
        job.message = "완료"
        return save_job(job)

    students = students_with_any_pending(apply_run_drafts(list_students(), draft_map))
    if job.limit:
        students = students[: job.limit]
    tasks = _plan_all_target_tasks(students)
    job.total = len(tasks)
    save_job(job)

    if not tasks:
        job.status = "done"
        job.message = "작성이 필요한 학생·항목이 없습니다."
        job.result = {
            "mode": "batch",
            "all_targets": True,
            "processed": 0,
            "errors": [],
            "results": [],
        }
        return save_job(job)

    results_by_id: dict[str, dict[str, Any]] = {}
    errors: list[dict[str, str]] = []
    for index, (student_id, section) in enumerate(tasks, start=1):
        student = _get_student_for_run(student_id, draft_map)
        if not student:
            errors.append({"id": student_id, "name": student_id, "error": "학생을 찾을 수 없습니다."})
            job.processed = index
            save_job(job)
            continue

        job.current_label = student.display_name
        job.current_section = section
        job.processed = index - 1
        job.message = f"{student.display_name} · {section} 작성 중..."
        save_job(job)
        try:
            updated = generate_for_student(
                student,
                sections=[section],
                progress=lambda sec, message, s=student, sec_name=section: _update_job_progress(
                    job.id, message, s.display_name, sec_name
                ),
            )
            results_by_id[updated.id] = _batch_result_item(updated)
        except Exception as exc:
            errors.append({"id": student.id, "name": student.display_name, "error": friendly_api_error(exc)})
        job.processed = index
        save_job(job)

    job.status = "done"
    job.errors = errors
    job.result = {
        "mode": "batch",
        "all_targets": True,
        "processed": len(results_by_id),
        "errors": errors,
        "results": list(results_by_id.values()),
    }
    job.message = "완료"
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

