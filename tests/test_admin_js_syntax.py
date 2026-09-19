from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path


ADMIN_JS = Path(__file__).resolve().parents[1] / "web" / "admin" / "js" / "admin.js"


def test_admin_js_has_valid_syntax() -> None:
    node = shutil.which("node")
    if not node:
        return
    result = subprocess.run([node, "--check", str(ADMIN_JS)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr or result.stdout


def test_detail_view_clears_and_guards_inspection_state() -> None:
    source = ADMIN_JS.read_text(encoding="utf-8")

    show_student_match = re.search(r"async function showStudent\(id, fromTab = \"review\"\) \{(?P<body>.*?)\n  \}", source, re.S)
    assert show_student_match, "showStudent function not found"
    show_student = show_student_match.group("body")

    assert "const loadSeq = ++detailLoadSeq;" in show_student
    assert "if (loadSeq !== detailLoadSeq || currentStudentId !== id) return;" in show_student
    assert show_student.index("currentInspectReport = null;") < show_student.index("buildDetailEditor(student.generated || {});")
    assert "renderFieldIssues(null);" in show_student
    assert "updateDetailCharCounts(null);" in show_student

    inspect_match = re.search(r"async function inspectCurrentStudent\(\{ generated = null \} = \{\}\) \{(?P<body>.*?)\n  \}", source, re.S)
    assert inspect_match, "inspectCurrentStudent function not found"
    inspect_student = inspect_match.group("body")

    assert "const studentId = currentStudentId;" in inspect_student
    assert "api(`/api/students/${studentId}/inspect`" in inspect_student
    assert "inspectReportCache.set(studentId, report);" in inspect_student
    assert "if (currentStudentId === studentId) currentInspectReport = report;" in inspect_student
