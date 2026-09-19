from __future__ import annotations

from io import BytesIO
from pathlib import Path

import pytest
from openpyxl import Workbook, load_workbook

from src.saenggibu.models import StudentInput
from src.saenggibu.student_store import (
    add_student,
    export_students_registry_tsv,
    export_students_registry_xlsx,
    find_existing_for_row,
    import_students_registry,
    list_students,
    preview_students_import,
    read_registry_table,
)


@pytest.fixture()
def students_dir(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    root = tmp_path / "data" / "saenggibu" / "students"
    outputs = tmp_path / "data" / "saenggibu" / "outputs"
    root.mkdir(parents=True)
    outputs.mkdir(parents=True)
    monkeypatch.setattr("src.saenggibu.student_store.STUDENTS_DIR", root)
    monkeypatch.setattr("src.saenggibu.student_store.OUTPUTS_DIR", outputs)
    monkeypatch.setenv("SGB_STORE_GENERATED", "1")
    monkeypatch.setenv("SGB_ENCRYPT_DATA", "0")
    return root


def test_export_and_import_registry_roundtrip(students_dir: Path) -> None:
    add_student(
        StudentInput(
            id="sround01",
            name="김민수",
            grade=2,
            class_num=3,
            number=5,
            notes={"행발": "행발 메모", "keywords": ["책임감", "성실"], "write_targets": ["행발", "세특"]},
            subjects={
                "국어": {
                    "career": "인문",
                    "assessment_type": "보고서",
                    "topic": "토론",
                    "content": "토론 수업 참여",
                    "activities": ["토론 수업 참여"],
                    "notes": "토론 수업 참여",
                }
            },
            changche={"자율": "학급 환경 미화", "동아리": "과학 동아리", "진로": "공학 탐색"},
            generated={"행발": "작성본"},
            status="done",
        )
    )

    tsv_path = students_dir / "export.tsv"
    tsv_path.write_bytes(export_students_registry_tsv())
    rows = read_registry_table(tsv_path)
    assert rows[0]["name"] == "김민수"
    assert rows[0]["행발_notes"] == "행발 메모"
    assert rows[0]["write_targets"] == "행발|세특"
    assert rows[0]["세특_국어_활동"] == "토론 수업 참여"
    assert "창체_봉사" not in rows[0]

    preview = preview_students_import(tsv_path)
    assert preview["duplicate_count"] == 1
    assert preview["new_count"] == 0

    result = import_students_registry(tsv_path, mode="update")
    assert result["updated"] == 1
    updated = list_students()[0]
    assert updated.generated.get("행발") == "작성본"
    assert updated.status == "done"
    assert updated.notes["행발"] == "행발 메모"
    assert updated.notes["write_targets"] == ["행발", "세특"]
    assert updated.subjects["국어"]["content"] == "토론 수업 참여"
    assert updated.changche["자율"] == "학급 환경 미화"


def test_update_import_preserves_omitted_registry_columns(students_dir: Path) -> None:
    original = add_student(
        StudentInput(
            id="spreserve1",
            name="김민수",
            grade=2,
            class_num=3,
            number=5,
            gender="남",
            notes={"행발": "기존 행발", "keywords": ["기존"], "write_targets": ["세특"]},
            subjects={"국어": {"content": "기존 세특", "activities": ["기존 세특"], "notes": "기존 세특"}},
            changche={"자율": "기존 자율", "동아리": "기존 동아리", "진로": "기존 진로"},
            generated={"세특": {"국어": "작성본"}},
            status="partial",
        )
    )
    tsv_path = students_dir / "partial_update.tsv"
    tsv_path.write_text(
        "id\tname\t행발_notes\n"
        f"{original.id}\t김민수\t새 행발\n",
        encoding="utf-8",
    )

    result = import_students_registry(tsv_path, mode="update")

    assert result["updated"] == 1
    updated = list_students()[0]
    assert updated.grade == 2
    assert updated.class_num == 3
    assert updated.number == 5
    assert updated.gender == "남"
    assert updated.notes["행발"] == "새 행발"
    assert updated.notes["keywords"] == ["기존"]
    assert updated.notes["write_targets"] == ["세특"]
    assert updated.subjects == original.subjects
    assert updated.changche == original.changche
    assert updated.generated == original.generated
    assert updated.status == "partial"


def test_update_import_can_clear_present_registry_fields(students_dir: Path) -> None:
    original = add_student(
        StudentInput(
            id="sclear01",
            name="이서연",
            grade=2,
            class_num=1,
            number=1,
            notes={"행발": "기존 행발", "keywords": ["기존"], "write_targets": ["행발", "세특"]},
            subjects={"국어": {"content": "기존 세특", "activities": ["기존 세특"], "notes": "기존 세특"}},
            changche={"자율": "기존 자율", "동아리": "", "진로": ""},
        )
    )
    tsv_path = students_dir / "clear_update.tsv"
    tsv_path.write_text(
        "id\tname\t행발_notes\t행발_keywords\twrite_targets\t세특_국어_활동\t창체_자율\n"
        f"{original.id}\t이서연\t\t\t행발\t\t\n",
        encoding="utf-8",
    )

    result = import_students_registry(tsv_path, mode="update")

    assert result["updated"] == 1
    updated = list_students()[0]
    assert updated.notes["행발"] == ""
    assert updated.notes["keywords"] == []
    assert updated.notes["write_targets"] == ["행발"]
    assert "국어" not in updated.subjects
    assert updated.changche["자율"] == ""


def test_import_skip_duplicate(students_dir: Path) -> None:
    add_student(StudentInput(id="", name="이서연", grade=2, class_num=1, number=1))
    tsv_path = students_dir / "dup.tsv"
    tsv_path.write_text(
        "name\tgrade\tclass_num\tnumber\t행발_notes\n이서연\t2\t1\t1\t새 메모\n",
        encoding="utf-8",
    )
    result = import_students_registry(tsv_path, mode="skip")
    assert result["skipped"] == 1
    assert list_students()[0].notes.get("행발") != "새 메모"


def test_export_registry_xlsx(students_dir: Path) -> None:
    add_student(
        StudentInput(
            id="",
            name="박지훈",
            grade=1,
            class_num=2,
            number=7,
            notes={"행발": "메모"},
        )
    )
    workbook = load_workbook(BytesIO(export_students_registry_xlsx()))
    worksheet = workbook.active
    headers = [cell.value for cell in worksheet[1]]
    assert "행발_notes" in headers
    assert "write_targets" in headers
    assert "창체_봉사" not in headers


def test_read_registry_xlsx_pads_short_rows(students_dir: Path) -> None:
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.append(["name", "grade", "class_num", "number", "행발_notes"])
    worksheet.append(["박지훈", 1])
    worksheet.append(["", "", "", "", ""])
    path = students_dir / "short.xlsx"
    workbook.save(path)

    rows = read_registry_table(path)

    assert rows == [
        {
            "name": "박지훈",
            "grade": "1",
            "class_num": "",
            "number": "",
            "행발_notes": "",
        }
    ]


def test_find_existing_for_row_by_identity(students_dir: Path) -> None:
    student = add_student(StudentInput(id="keep-id", name="최유진", grade=2, class_num=4, number=8))
    row = {"name": "최유진", "grade": "2", "class_num": "4", "number": "8"}
    existing = find_existing_for_row(row)
    assert existing is not None
    assert existing.id == student.id
