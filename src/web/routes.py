from __future__ import annotations

import json
import logging
import tempfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from src.saenggibu.config import gemini_models_for_api
from src.saenggibu.data_crypto import encrypt_data_enabled
from src.saenggibu.storage_policy import draft_map_from_items, store_generated_on_server
from src.saenggibu.curriculum import find_relevant_standards, resolve_subject_entry
from src.saenggibu.pii_mask import mask_pii_enabled, mask_student_names_enabled
from src.saenggibu.writing_guides import get_writing_guide
from src.saenggibu.job_queue import claim_stalled_job, create_run_job, execute_run_job, get_job
from src.saenggibu.inspector.issues import report_to_dict
from src.saenggibu.inspector.runner import inspect_batch, inspect_student_by_id
from src.saenggibu.neis_format import parse_neis_paste
from src.saenggibu.models import StudentInput
from src.saenggibu.pattern_analyzer import analyze_and_save, load_patterns, update_style_guide
from src.saenggibu.sample_store import (
    delete_all_samples,
    delete_sample,
    delete_samples,
    import_path,
    list_samples,
)
from src.saenggibu.student_parser import parse_and_save, parse_file_to_student, parse_text_to_student
from src.saenggibu.upload_formats import SAMPLE_EXTENSIONS, STUDENT_EXTENSIONS, check_upload_extension
from src.saenggibu.usage import usage_summary
from src.saenggibu.write_sections import normalize_write_sections
from src.saenggibu.student_store import (
    add_student,
    delete_all_students,
    delete_student,
    delete_students,
    export_students_registry_tsv,
    export_students_registry_xlsx,
    export_students_xlsx,
    get_student,
    import_students_registry,
    list_students,
    preview_students_import,
    reset_all_generated,
    reset_generated_for_students,
    reset_student_generated,
    save_student,
)
from src.web.auth import (
    AdminSession,
    SESSION_COOKIE,
    SESSION_MAX_AGE,
    admin_auth_configured,
    create_session_token,
    session_cookie_secure,
    verify_password,
    verify_session_token,
)

router = APIRouter(prefix="/api")
logger = logging.getLogger("sgb.web")


class LoginRequest(BaseModel):
    password: str


class StudentCreateRequest(BaseModel):
    name: str
    grade: int
    class_num: int
    number: int
    gender: str = ""
    haengbal_notes: str = ""
    keywords: list[str] = Field(default_factory=list)
    subjects: dict[str, dict[str, Any]] = Field(default_factory=dict)
    changche: dict[str, str] = Field(default_factory=dict)
    write_targets: list[str] = Field(default_factory=list)


class RunDraftItem(BaseModel):
    student_id: str
    generated: dict[str, Any] = Field(default_factory=dict)


class RunRequest(BaseModel):
    student_id: str | None = None
    status: str = "pending"
    sections: list[str] | None = None
    all_targets: bool = False
    limit: int | None = None
    drafts: list[RunDraftItem] = Field(default_factory=list)


class ParseStudentRequest(BaseModel):
    text: str


class NeisPasteRequest(BaseModel):
    text: str


class StyleGuideUpdate(BaseModel):
    style_guide: str


class BulkDeleteSamplesRequest(BaseModel):
    ids: list[str] = Field(default_factory=list)


class BulkStudentIdsRequest(BaseModel):
    ids: list[str] = Field(default_factory=list)


class StudentUpdateRequest(BaseModel):
    generated: dict[str, Any] | None = None
    notes: dict[str, Any] | None = None
    subjects: dict[str, dict[str, Any]] | None = None
    changche: dict[str, str] | None = None
    status: str | None = None


class StudentExportItem(BaseModel):
    id: str = ""
    name: str = ""
    grade: int = 1
    class_num: int = 1
    number: int = 1
    status: str = "pending"
    generated: dict[str, Any] = Field(default_factory=dict)


class StudentExportRequest(BaseModel):
    students: list[StudentExportItem] = Field(default_factory=list)


class InspectBatchItem(BaseModel):
    id: str
    generated: dict[str, Any] = Field(default_factory=dict)
    name: str = ""
    label: str = ""


class InspectBatchRequest(BaseModel):
    ids: list[str] = Field(default_factory=list)
    items: list[InspectBatchItem] = Field(default_factory=list)
    skip_ok_ids: list[str] = Field(default_factory=list)


class StudentInspectRequest(BaseModel):
    generated: dict[str, Any] | None = None


def _extract_token(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    bearer = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
    cookie = request.cookies.get(SESSION_COOKIE, "")
    if bearer and verify_session_token(bearer):
        return bearer
    if cookie and verify_session_token(cookie):
        return cookie
    return bearer or cookie


def require_admin(request: Request) -> AdminSession:
    token = _extract_token(request)
    if not verify_session_token(token):
        raise HTTPException(status_code=401, detail="관리자 로그인이 필요합니다.")
    return AdminSession(token=token)


@router.post("/auth/login")
def login(payload: LoginRequest) -> JSONResponse:
    if not admin_auth_configured():
        raise HTTPException(
            status_code=503,
            detail="서버 설정이 완료되지 않았습니다. .env 에 ADMIN_PASSWORD 와 ADMIN_SESSION_SECRET 을 설정하세요.",
        )
    try:
        if not verify_password(payload.password):
            raise HTTPException(status_code=401, detail="비밀번호가 올바르지 않습니다.")
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    try:
        token = create_session_token()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    response = JSONResponse({"token": token})
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        max_age=SESSION_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=session_cookie_secure(),
        path="/",
    )
    return response


@router.post("/auth/logout")
def logout() -> JSONResponse:
    response = JSONResponse({"ok": True})
    response.delete_cookie(
        key=SESSION_COOKIE,
        path="/",
        secure=session_cookie_secure(),
        samesite="lax",
    )
    return response


@router.get("/auth/me")
def auth_me(session: AdminSession = Depends(require_admin)) -> dict[str, Any]:
    try:
        usage = usage_summary()
    except Exception as exc:
        logger.exception("usage summary failed")
        usage = {
            "plan": "free",
            "month": "",
            "generations_used": 0,
            "generations_limit": 10,
            "generations_remaining": 10,
            "unlimited": False,
        }
    return {
        "ok": True,
        "admin": True,
        "usage": usage,
        **gemini_models_for_api(),
        "privacy": {
            "store_generated": store_generated_on_server(),
            "encrypt_data": encrypt_data_enabled(),
            "mask_pii": mask_pii_enabled(),
            "mask_student_names": mask_student_names_enabled(),
        },
    }


@router.get("/usage")
def api_usage(_: AdminSession = Depends(require_admin)) -> dict[str, Any]:
    return usage_summary()


@router.get("/curriculum/standards")
def api_curriculum_standards(
    subject: str,
    career: str = "",
    assessment_type: str = "",
    topic: str = "",
    content: str = "",
    limit: int = 5,
    _: AdminSession = Depends(require_admin),
) -> dict[str, Any]:
    name = subject.strip()
    if not name:
        raise HTTPException(status_code=400, detail="과목명을 입력하세요.")
    entry = resolve_subject_entry(name)
    if not entry:
        return {
            "subject": name,
            "resolved": False,
            "standards": [],
            "message": "등록된 교육과정 데이터에 없는 과목입니다.",
        }
    info = {
        "career": career,
        "assessment_type": assessment_type,
        "topic": topic,
        "content": content,
    }
    standards = find_relevant_standards(name, info, limit=min(max(limit, 1), 10))
    return {
        "subject": name,
        "resolved": True,
        "standards": standards,
        "count": len(standards),
    }


@router.get("/guides/writing")
def api_writing_guides(
    section: str | None = None,
    _: AdminSession = Depends(require_admin),
) -> dict[str, Any]:
    return get_writing_guide(section)


@router.get("/samples")
def api_samples_list(_: AdminSession = Depends(require_admin)) -> dict[str, Any]:
    try:
        samples = list_samples()
    except Exception as exc:
        logger.exception("samples list failed")
        raise HTTPException(
            status_code=500,
            detail=f"샘플 목록을 읽지 못했습니다. SGB_DATA_KEY 설정을 확인하세요. ({exc})",
        ) from exc
    return {"samples": [s.to_dict() for s in samples], "count": len(samples)}


@router.post("/samples/import")
async def api_samples_import(
    file: UploadFile = File(...),
    _: AdminSession = Depends(require_admin),
) -> dict[str, Any]:
    try:
        check_upload_extension(file.filename, SAMPLE_EXTENSIONS)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    suffix = Path(file.filename or "upload").suffix.lower() or ".json"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = Path(tmp.name)
    try:
        imported = import_path(tmp_path)
        return {"imported": len(imported), "samples": [s.to_dict() for s in imported]}
    except ValueError as exc:
        logger.warning("samples import failed: %s (%s)", file.filename, exc)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("samples import error: %s", file.filename)
        raise HTTPException(status_code=500, detail=f"서버 오류: {exc}") from exc
    finally:
        tmp_path.unlink(missing_ok=True)


@router.delete("/samples/{sample_id}")
def api_samples_delete(sample_id: str, _: AdminSession = Depends(require_admin)) -> dict[str, Any]:
    if not delete_sample(sample_id):
        raise HTTPException(status_code=404, detail="샘플을 찾을 수 없습니다.")
    return {"deleted": True, "id": sample_id}


@router.delete("/samples")
def api_samples_delete_all(_: AdminSession = Depends(require_admin)) -> dict[str, Any]:
    count = delete_all_samples()
    return {"deleted": True, "count": count}


@router.post("/samples/bulk-delete")
def api_samples_bulk_delete(
    payload: BulkDeleteSamplesRequest,
    _: AdminSession = Depends(require_admin),
) -> dict[str, Any]:
    if not payload.ids:
        raise HTTPException(status_code=400, detail="삭제할 샘플을 선택하세요.")
    return delete_samples(payload.ids)


@router.post("/analyze")
def api_analyze(use_gemini: bool = False, _: AdminSession = Depends(require_admin)) -> dict[str, Any]:
    return analyze_and_save(use_gemini=use_gemini)


@router.get("/patterns")
def api_patterns(_: AdminSession = Depends(require_admin)) -> dict[str, Any]:
    patterns = load_patterns()
    if not patterns:
        return {"style_guide": "", "sections": {}, "sample_count": 0}
    return patterns


@router.put("/patterns/style-guide")
def api_patterns_update(payload: StyleGuideUpdate, _: AdminSession = Depends(require_admin)) -> dict[str, Any]:
    try:
        return update_style_guide(payload.style_guide)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/students")
def api_students_list(status: str | None = None, _: AdminSession = Depends(require_admin)) -> dict[str, Any]:
    try:
        students = list_students(status=status)
    except Exception as exc:
        logger.exception("students list failed")
        raise HTTPException(
            status_code=500,
            detail=f"학생 목록을 읽지 못했습니다. ({exc})",
        ) from exc
    return {"students": [s.to_dict() for s in students], "count": len(students)}


@router.get("/students/export/xlsx")
def api_students_export_xlsx_get(_: AdminSession = Depends(require_admin)) -> Response:
    students = list_students()
    if not students:
        raise HTTPException(status_code=404, detail="보낼 학생이 없습니다.")
    if not any(s.generated for s in students):
        raise HTTPException(
            status_code=404,
            detail="서버에 저장된 작성본이 없습니다. 브라우저에 있는 초안으로내려면 POST를 사용하세요.",
        )
    return _build_xlsx_response(students)


@router.post("/students/export/xlsx")
def api_students_export_xlsx_post(
    payload: StudentExportRequest,
    _: AdminSession = Depends(require_admin),
) -> Response:
    if not payload.students:
        raise HTTPException(status_code=400, detail="보낼 학생 데이터가 없습니다.")
    students: list[StudentInput] = []
    for item in payload.students:
        if not item.generated:
            continue
        students.append(
            StudentInput(
                id=item.id or "export",
                name=item.name,
                grade=item.grade,
                class_num=item.class_num,
                number=item.number,
                status=item.status,
                generated=item.generated,
            )
        )
    if not students:
        raise HTTPException(status_code=404, detail="작성된 생기부가 없습니다.")
    return _build_xlsx_response(students)


def _build_xlsx_response(students: list[StudentInput]) -> Response:
    from datetime import datetime, timezone

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    content = export_students_xlsx(students)
    filename = f"saenggibu_{stamp}.xlsx"
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _build_registry_tsv_response(students: list[StudentInput]) -> Response:
    from datetime import datetime, timezone

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    content = export_students_registry_tsv(students)
    filename = f"students_{stamp}.tsv"
    return Response(
        content=content,
        media_type="text/tab-separated-values; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _build_registry_xlsx_response(students: list[StudentInput]) -> Response:
    from datetime import datetime, timezone

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    content = export_students_registry_xlsx(students)
    filename = f"students_{stamp}.xlsx"
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/students/export/registry.tsv")
def api_students_export_registry_tsv(_: AdminSession = Depends(require_admin)) -> Response:
    students = list_students()
    if not students:
        raise HTTPException(status_code=404, detail="보낼 학생이 없습니다.")
    return _build_registry_tsv_response(students)


@router.get("/students/export/registry.xlsx")
def api_students_export_registry_xlsx(_: AdminSession = Depends(require_admin)) -> Response:
    students = list_students()
    if not students:
        raise HTTPException(status_code=404, detail="보낼 학생이 없습니다.")
    return _build_registry_xlsx_response(students)


@router.post("/students/{student_id}/inspect")
def api_student_inspect_post(
    student_id: str,
    payload: StudentInspectRequest,
    _: AdminSession = Depends(require_admin),
) -> dict[str, Any]:
    generated = payload.generated
    if generated is not None:
        report = inspect_student_by_id(student_id, generated=generated)
    else:
        report = inspect_student_by_id(student_id)
    if report is None:
        raise HTTPException(status_code=404, detail="학생을 찾을 수 없습니다.")
    return report_to_dict(report)


@router.post("/inspect/batch")
def api_inspect_batch(
    payload: InspectBatchRequest,
    _: AdminSession = Depends(require_admin),
) -> dict[str, Any]:
    items = None
    if payload.items:
        items = [
            {
                "id": item.id,
                "generated": item.generated,
                "name": item.name,
                "label": item.label,
            }
            for item in payload.items
        ]
    result = inspect_batch(
        student_ids=payload.ids or None,
        items=items,
        skip_ok_ids=set(payload.skip_ok_ids),
    )
    return {
        "summary": result["summary"],
        "not_found": result["not_found"],
        "reports": [report_to_dict(report) for report in result["reports"]],
    }


@router.get("/students/{student_id}")
def api_student_show(student_id: str, _: AdminSession = Depends(require_admin)) -> dict[str, Any]:
    student = get_student(student_id)
    if not student:
        raise HTTPException(status_code=404, detail="학생을 찾을 수 없습니다.")
    return student.to_dict()


@router.post("/students")
def api_student_create(payload: StudentCreateRequest, _: AdminSession = Depends(require_admin)) -> dict[str, Any]:
    try:
        student = StudentInput(
            id="",
            name=payload.name,
            grade=payload.grade,
            class_num=payload.class_num,
            number=payload.number,
            gender=payload.gender,
            notes={
                "행발": payload.haengbal_notes,
                "keywords": payload.keywords,
                "write_targets": payload.write_targets,
            },
            subjects=payload.subjects,
            changche=payload.changche,
        )
        return add_student(student).to_dict()
    except OSError as exc:
        logger.exception("student create failed: disk")
        raise HTTPException(status_code=500, detail=f"학생 파일을 저장하지 못했습니다. ({exc})") from exc
    except RuntimeError as exc:
        logger.exception("student create failed: runtime")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/students/parse")
def api_students_parse(payload: ParseStudentRequest, _: AdminSession = Depends(require_admin)) -> dict[str, Any]:
    try:
        preview = parse_text_to_student(payload.text)
        return {"preview": preview.to_dict(), "saved": False}
    except (ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/students/parse-save")
def api_students_parse_save(payload: ParseStudentRequest, _: AdminSession = Depends(require_admin)) -> dict[str, Any]:
    try:
        student = parse_and_save(payload.text)
        return student.to_dict()
    except (ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/students/parse-file")
async def api_students_parse_file(
    file: UploadFile = File(...),
    save: bool = False,
    _: AdminSession = Depends(require_admin),
) -> dict[str, Any]:
    suffix = Path(file.filename or "upload").suffix.lower() or ".txt"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = Path(tmp.name)
    try:
        student = parse_file_to_student(tmp_path)
        if save:
            return add_student(student).to_dict()
        return {"preview": student.to_dict(), "saved": False}
    except (ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        tmp_path.unlink(missing_ok=True)


@router.patch("/students/{student_id}")
def api_student_update(
    student_id: str,
    payload: StudentUpdateRequest,
    _: AdminSession = Depends(require_admin),
) -> dict[str, Any]:
    student = get_student(student_id)
    if not student:
        raise HTTPException(status_code=404, detail="학생을 찾을 수 없습니다.")
    response_generated = student.generated
    if payload.generated is not None:
        if store_generated_on_server():
            student.generated = payload.generated
        response_generated = payload.generated
    if payload.notes is not None:
        student.notes = payload.notes
    if payload.subjects is not None:
        student.subjects = payload.subjects
    if payload.changche is not None:
        student.changche = payload.changche
    if payload.status is not None and store_generated_on_server():
        student.status = payload.status
    saved = save_student(student)
    data = saved.to_dict()
    if not store_generated_on_server():
        data["generated"] = response_generated
        if response_generated:
            data["status"] = payload.status or ("done" if response_generated else saved.status)
    return data


@router.post("/neis/parse")
def api_neis_parse(payload: NeisPasteRequest, _: AdminSession = Depends(require_admin)) -> dict[str, Any]:
    try:
        return parse_neis_paste(payload.text)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/students/import/preview")
async def api_students_import_preview(
    file: UploadFile = File(...),
    _: AdminSession = Depends(require_admin),
) -> dict[str, Any]:
    try:
        check_upload_extension(file.filename, STUDENT_EXTENSIONS)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    suffix = Path(file.filename or "upload").suffix.lower() or ".tsv"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = Path(tmp.name)
    try:
        return preview_students_import(tmp_path)
    except ValueError as exc:
        logger.warning("students import preview failed: %s (%s)", file.filename, exc)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("students import preview error: %s", file.filename)
        raise HTTPException(status_code=500, detail=f"서버 오류: {exc}") from exc
    finally:
        tmp_path.unlink(missing_ok=True)


@router.post("/students/import")
async def api_students_import(
    file: UploadFile = File(...),
    mode: str = "add",
    _: AdminSession = Depends(require_admin),
) -> dict[str, Any]:
    try:
        check_upload_extension(file.filename, STUDENT_EXTENSIONS)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if mode not in {"add", "skip", "update"}:
        raise HTTPException(status_code=400, detail="mode는 add, skip, update 중 하나여야 합니다.")

    suffix = Path(file.filename or "upload").suffix.lower() or ".tsv"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = Path(tmp.name)
    try:
        return import_students_registry(tmp_path, mode=mode)
    except ValueError as exc:
        logger.warning("students import failed: %s (%s)", file.filename, exc)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("students import error: %s", file.filename)
        raise HTTPException(status_code=500, detail=f"서버 오류: {exc}") from exc
    finally:
        tmp_path.unlink(missing_ok=True)


@router.post("/students/{student_id}/reset")
def api_student_reset(student_id: str, _: AdminSession = Depends(require_admin)) -> dict[str, Any]:
    student = get_student(student_id)
    if not student:
        raise HTTPException(status_code=404, detail="학생을 찾을 수 없습니다.")
    reset_student_generated(student)
    return {"id": student.id, "status": student.status}


@router.delete("/students/{student_id}")
def api_student_delete(student_id: str, _: AdminSession = Depends(require_admin)) -> dict[str, Any]:
    if not delete_student(student_id):
        raise HTTPException(status_code=404, detail="학생을 찾을 수 없습니다.")
    return {"deleted": True, "id": student_id}


@router.delete("/students")
def api_students_delete_all(_: AdminSession = Depends(require_admin)) -> dict[str, Any]:
    count = delete_all_students()
    return {"deleted": True, "count": count}


@router.post("/students/bulk-delete")
def api_students_bulk_delete(
    payload: BulkStudentIdsRequest,
    _: AdminSession = Depends(require_admin),
) -> dict[str, Any]:
    if not payload.ids:
        raise HTTPException(status_code=400, detail="삭제할 학생을 선택하세요.")
    return delete_students(payload.ids)


@router.post("/students/bulk-reset-generated")
def api_students_bulk_reset_generated(
    payload: BulkStudentIdsRequest,
    _: AdminSession = Depends(require_admin),
) -> dict[str, Any]:
    if not payload.ids:
        raise HTTPException(status_code=400, detail="초기화할 학생을 선택하세요.")
    return reset_generated_for_students(payload.ids)


@router.delete("/students/generated/all")
def api_students_reset_all_generated(_: AdminSession = Depends(require_admin)) -> dict[str, Any]:
    count = reset_all_generated()
    return {"reset": True, "count": count}


def _run_draft_payload(drafts: list[RunDraftItem]) -> list[dict[str, Any]]:
    return [
        {"student_id": item.student_id, "generated": item.generated}
        for item in drafts
    ]


@router.post("/run/async")
def api_run_async(
    payload: RunRequest,
    background_tasks: BackgroundTasks,
    _: AdminSession = Depends(require_admin),
) -> dict[str, Any]:
    if payload.all_targets:
        job = create_run_job(
            all_targets=True,
            student_id=payload.student_id,
            limit=payload.limit,
            drafts=_run_draft_payload(payload.drafts),
        )
    else:
        try:
            normalize_write_sections(payload.sections)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        job = create_run_job(
            sections=payload.sections or ["행발"],
            student_id=payload.student_id,
            limit=payload.limit,
            drafts=_run_draft_payload(payload.drafts),
        )
    background_tasks.add_task(execute_run_job, job.id, job.lease_token)
    return {
        "job_id": job.id,
        "status": job.status,
        "section": job.section,
        "all_targets": job.all_targets,
        **gemini_models_for_api(),
    }


_JOB_INTERNAL_FIELDS = ("tasks", "drafts", "results", "last_student", "lease_token", "lease_until")


@router.get("/jobs/{job_id}")
def api_job_show(
    job_id: str,
    background_tasks: BackgroundTasks,
    _: AdminSession = Depends(require_admin),
) -> dict[str, Any]:
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="작업을 찾을 수 없습니다.")
    token = claim_stalled_job(job_id)
    if token:
        background_tasks.add_task(execute_run_job, job_id, token)
    data = {key: value for key, value in job.to_dict().items() if key not in _JOB_INTERNAL_FIELDS}
    data.update(gemini_models_for_api())
    return data
