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
    assert finished.result["student"]["generated"] == {"행발": "행발 본문", "세특": {"윤사": "세특 본문"}}


def test_job_resumes_after_budget(jobs_dir: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from src.saenggibu import job_queue

    students = [
        StudentInput(id=f"s{i}", name=f"학생{i}", grade=2, class_num=1, number=i, notes={"행발": "메모"})
        for i in range(1, 4)
    ]
    by_id = {s.id: s for s in students}
    calls: list[str] = []

    def fake_generate(current: StudentInput, *, sections, progress=None):
        calls.append(current.id)
        current.generated = {"행발": f"{current.id} 본문"}
        current.status = "done"
        return current

    clock = iter(range(0, 1000, 100))
    monkeypatch.setattr(job_queue.time, "monotonic", lambda: next(clock))
    monkeypatch.setenv("SGB_JOB_BUDGET_SEC", "150")
    monkeypatch.setattr("src.saenggibu.job_queue.list_students", lambda status=None: list(students))
    monkeypatch.setattr("src.saenggibu.job_queue.get_student", lambda sid: by_id.get(sid))
    monkeypatch.setattr("src.saenggibu.job_queue.generate_for_student", fake_generate)

    job = create_run_job(sections=["행발"])
    first = execute_run_job(job.id, job.lease_token)
    assert first.status == "running"
    assert 0 < first.cursor < 3
    assert job_queue.claim_stalled_job("missing") is None

    token = job_queue.claim_stalled_job(job.id)
    assert token
    assert execute_run_job(job.id, "stale-token").cursor == first.cursor

    while True:
        current = execute_run_job(job.id, token)
        if current.status != "running":
            break
        token = job_queue.claim_stalled_job(job.id)

    assert current.status == "done"
    assert calls == ["s1", "s2", "s3"]
    assert current.result["processed"] == 3
    assert [item["id"] for item in current.result["results"]] == ["s1", "s2", "s3"]
