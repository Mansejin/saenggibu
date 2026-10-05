from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from .config import OUTPUTS_DIR, ensure_data_dirs
from .curriculum import find_relevant_standards, format_curriculum_context
from .api_errors import friendly_api_error
from .gemini_client import generate_text
from .subject_info import format_setuk_prompt_context
from .storage_policy import store_generated_on_server
from .models import StudentInput
from .secure_io import save_secure_json
from .pattern_analyzer import analyze_and_save, load_patterns
from .student_store import save_student
from .usage import check_generation_allowed, record_generation
from .write_sections import normalize_write_sections, student_sections_complete


ProgressCallback = Callable[[str, str], None]


def _default_progress(section: str, message: str) -> None:
    print(f"[{section}] {message}")


def _load_style_guide() -> str:
    patterns = load_patterns()
    if patterns and patterns.get("style_guide"):
        return str(patterns["style_guide"])
    saved = analyze_and_save(use_gemini=False)
    return str(saved["style_guide"])


def _system_prompt() -> str:
    return (
        "당신은 대한민국 고등학교 담임·교과 교사로서 생활기록부를 작성합니다.\n"
        "반드시 사실에 근거하고, 관찰 가능한 행동·활동·태도만 기술합니다.\n"
        "학생 실명은 쓰지 말고 '학생' 또는 'OO'로 표기합니다.\n"
        "과장·허위·선입견·비교 표현을 피하고, 교육적이고 객관적인 문체를 유지합니다.\n"
        "출력은 요청한 본문만 작성하고, 제목·설명·따옴표 없이 바로 본문을 시작합니다."
    )


def _student_names(student: StudentInput) -> list[str]:
    return [student.name] if student.name.strip() else []


def _generate_haengbal(student: StudentInput, style_guide: str) -> str:
    keywords = student.notes.get("keywords") or []
    notes = student.notes.get("행발") or student.notes.get("행발_notes") or ""
    user = (
        f"## 스타일 가이드\n{style_guide}\n\n"
        f"## 학생 정보\n"
        f"- 학년/반/번호: {student.grade}-{student.class_num}-{student.number}\n"
        f"- 성별: {student.gender or '미기재'}\n"
        f"- 행발 메모: {notes}\n"
        f"- 핵심 키워드: {', '.join(keywords) if keywords else '없음'}\n\n"
        "위 정보를 바탕으로 **행동특성 및 종합의견** 한 편을 작성하세요."
    )
    return generate_text(
        system=_system_prompt(),
        user=user,
        student_names=_student_names(student),
        tier="pro",
    )


def _generate_setuk(
    student: StudentInput,
    subject: str,
    info: dict[str, Any],
    style_guide: str,
) -> str:
    context = format_setuk_prompt_context(subject, info)
    standards = find_relevant_standards(subject, info, limit=3)
    curriculum_block = format_curriculum_context(standards)
    curriculum_section = f"\n{curriculum_block}\n" if curriculum_block else ""
    user = (
        f"## 스타일 가이드\n{style_guide}\n\n"
        f"## 학생 정보\n"
        f"- 학년/반/번호: {student.grade}-{student.class_num}-{student.number}\n"
        f"{context}"
        f"{curriculum_section}\n"
        f"위 정보를 바탕으로 **{subject} 세부능력 및 특기사항**을 작성하세요. "
        "비어 있는 항목(진로·수행평가 형식·주제)은 언급하지 마세요."
    )
    return generate_text(
        system=_system_prompt(),
        user=user,
        student_names=_student_names(student),
        tier="pro",
    )


def _generate_changche(
    student: StudentInput,
    subsection: str,
    notes: str,
    style_guide: str,
) -> str:
    user = (
        f"## 스타일 가이드\n{style_guide}\n\n"
        f"## 학생 정보\n"
        f"- 학년/반/번호: {student.grade}-{student.class_num}-{student.number}\n"
        f"- 창체 영역: {subsection}\n"
        f"- 활동 메모: {notes or '없음'}\n\n"
        f"위 정보를 바탕으로 **창의적 체험활동({subsection})** 기록을 작성하세요."
    )
    return generate_text(
        system=_system_prompt(),
        user=user,
        student_names=_student_names(student),
        tier="pro",
    )


def generate_for_student(
    student: StudentInput,
    *,
    sections: list[str] | None = None,
    progress: ProgressCallback | None = None,
) -> StudentInput:
    notify = progress or _default_progress
    check_generation_allowed()
    target_sections = normalize_write_sections(sections)
    style_guide = _load_style_guide()

    student.status = "in_progress"
    student.error_message = ""
    save_student(student)

    generated: dict[str, Any] = dict(student.generated or {})

    try:
        section = target_sections[0]
        if section == "행발":
            if str(generated.get("행발") or "").strip():
                pass
            else:
                notify("행발", f"{student.display_name} 작성 중...")
                generated["행발"] = _generate_haengbal(student, style_guide)
        elif section == "세특":
            if not student.subjects:
                raise ValueError(f"{student.display_name}: 세특 작성에 필요한 과목 정보가 없습니다.")
            generated.setdefault("세특", {})
            for subject, info in student.subjects.items():
                existing = str((generated.get("세특") or {}).get(subject) or "").strip()
                if existing:
                    continue
                notify("세특", f"{student.display_name} · {subject}")
                generated["세특"][subject] = _generate_setuk(student, subject, info, style_guide)
        elif section in ("자율", "동아리", "봉사", "진로"):
            notes = str(student.changche.get(section) or "").strip()
            if not notes:
                raise ValueError(f"{student.display_name}: {section} 활동 메모가 없습니다.")
            generated.setdefault("창체", {})
            if str((generated.get("창체") or {}).get(section) or "").strip():
                pass
            else:
                notify("창체", f"{student.display_name} · {section}")
                generated["창체"][section] = _generate_changche(student, section, notes, style_guide)

        student.generated = generated
        student.status = "done" if student_sections_complete(student) else "partial"
        save_student(student)
        record_generation()
        if store_generated_on_server():
            _export_student_output(student)
        return student
    except Exception as exc:
        student.status = "error"
        student.error_message = friendly_api_error(exc)
        if store_generated_on_server():
            student.generated = generated
        else:
            student.generated = {}
        save_student(student)
        raise


def _export_student_output(student: StudentInput) -> Path:
    ensure_data_dirs()
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    path = OUTPUTS_DIR / student.id / f"{ts}.json"
    save_secure_json(
        path,
        {
            "student": student.to_dict(),
            "generated_at": ts,
        },
    )
    return path


def run_batch(
    students: list[StudentInput],
    *,
    sections: list[str] | None = None,
    continue_on_error: bool = True,
    progress: ProgressCallback | None = None,
) -> dict[str, Any]:
    results: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []

    for student in students:
        try:
            updated = generate_for_student(student, sections=sections, progress=progress)
            item: dict[str, Any] = {
                "id": updated.id,
                "name": updated.display_name,
                "status": updated.status,
            }
            if not store_generated_on_server():
                item["generated"] = updated.generated
            results.append(item)
        except Exception as exc:
            errors.append({"id": student.id, "name": student.display_name, "error": str(exc)})
            if not continue_on_error:
                break

    return {
        "processed": len(results),
        "errors": errors,
        "results": results,
    }
