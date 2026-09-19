from __future__ import annotations

from pathlib import Path

import pytest

from src.saenggibu.job_queue import RunJob, create_run_job, execute_run_job, get_job, save_job
from src.saenggibu.models import StudentInput


@pytest.fixture()
def jobs_dir(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    root = tmp_path / "data" / "saenggibu" / "jobs"
    root.mkdir(parents=True)
    monkeypatch.setattr("src.saenggibu.job_queue.JOBS_DIR", root)
    return root


def test_create_and_get_job(jobs_dir: Path) -> None:
    job = create_run_job(sections=["행발"])
    loaded = get_job(job.id)
    assert loaded is not None
    assert loaded.section == "행발"
    assert loaded.status == "pending"
    assert loaded.all_targets is False


def test_create_all_targets_job(jobs_dir: Path) -> None:
    job = create_run_job(all_targets=True)
    assert job.section == "전체"
    assert job.all_targets is True


def test_execute_run_job_empty_batch(jobs_dir: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("src.saenggibu.job_queue.list_students", lambda status=None: [])
    job = create_run_job(sections=["행발"])
    finished = execute_run_job(job.id)
    assert finished.status == "done"
    assert finished.processed == 0
    assert finished.result["mode"] == "batch"


def test_execute_all_targets_single_student(
    jobs_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    student = StudentInput(
        id="s1",
        name="김민수",
        grade=2,
        class_num=1,
        number=1,
        notes={"행발": "메모", "write_targets": ["행발", "세특"]},
        subjects={"윤사": {"activities": ["토론"], "notes": ""}},
    )
    calls: list[list[str]] = []

    def fake_generate(current: StudentInput, *, sections, progress=None):
        calls.append(list(sections))
        current.generated = dict(current.generated or {})
        section = sections[0]
        if section == "행발":
            current.generated["행발"] = "행발 본문"
        elif section == "세특":
            current.generated["세특"] = {"윤사": "세특 본문"}
        current.status = "done"
        return current

    monkeypatch.setattr("src.saenggibu.job_queue.get_student", lambda student_id: student if student_id == "s1" else None)
    monkeypatch.setattr("src.saenggibu.job_queue.generate_for_student", fake_generate)

    job = create_run_job(all_targets=True, student_id="s1")
    finished = execute_run_job(job.id)
    assert finished.status == "done"
    assert finished.total == 2
    assert finished.processed == 2
    assert calls == [["행발"], ["세특"]]
    assert finished.result["all_targets"] is True
    assert finished.result["sections_done"] == ["행발", "세특"]


def test_execute_single_student_skips_unneeded_section(
    jobs_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    student = StudentInput(
        id="s1",
        name="김민수",
        grade=2,
        class_num=1,
        number=1,
        notes={"행발": "메모", "write_targets": ["세특"]},
        subjects={"윤사": {"activities": ["토론"], "notes": ""}},
    )
    calls: list[list[str]] = []

    def fake_generate(current: StudentInput, *, sections, progress=None):
        calls.append(list(sections))
        current.generated = {"행발": "잘못된 작성본"}
        return current

    monkeypatch.setattr("src.saenggibu.job_queue.get_student", lambda student_id: student if student_id == "s1" else None)
    monkeypatch.setattr("src.saenggibu.job_queue.generate_for_student", fake_generate)

    job = create_run_job(sections=["행발"], student_id="s1")
    finished = execute_run_job(job.id)

    assert finished.status == "done"
    assert finished.processed == 0
    assert finished.result["skipped"] is True
    assert calls == []
    assert student.generated == {}
