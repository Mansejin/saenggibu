(() => {
  "use strict";

  const TOKEN_KEY = "sgb_admin_token";
  const DRAFTS_KEY = "sgb_generated_drafts";
  const configuredBase = (document.body.dataset.apiBase || "").replace(/\/$/, "");
  const API_BASE = configuredBase || window.location.origin;
  const ASSETS_BASE = (document.body.dataset.assetsBase || "").replace(/\/$/, "");

  const FILE_RULES = {
    samplesFile: {
      exts: [".json", ".tsv", ".csv", ".xlsx", ".docx"],
      label: "xlsx, docx, tsv, csv, json",
    },
    studentsFile: {
      exts: [".tsv", ".csv", ".txt", ".xlsx"],
      label: "tsv, csv, xlsx",
    },
    aiStudentFile: {
      exts: [".txt", ".tsv", ".csv", ".docx", ".xlsx", ".pdf", ".hwp"],
      label: "txt, tsv, csv, docx, xlsx 등",
    },
  };

  function fileExtension(name) {
    const dot = name.lastIndexOf(".");
    return dot >= 0 ? name.slice(dot).toLowerCase() : "";
  }

  function validateFiles(files, inputId) {
    const rule = FILE_RULES[inputId];
    if (!rule) return { ok: true, valid: [...files], rejected: [] };

    const valid = [];
    const rejected = [];
    for (const file of files) {
      const ext = fileExtension(file.name);
      if (rule.exts.includes(ext)) valid.push(file);
      else rejected.push(file);
    }
    return { ok: rejected.length === 0, valid, rejected, rule };
  }

  function formatRejectedNames(files) {
    return files.map((f) => f.name).join(", ");
  }

  function isLocalAdminHost() {
    const host = window.location.hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  }

  function initDevOnlyUi() {
    const show = isLocalAdminHost();
    document.querySelectorAll(".admin-dev-only").forEach((el) => {
      el.hidden = !show;
    });
  }

  function assetUrl(path) {
    const clean = path.replace(/^\//, "");
    return ASSETS_BASE ? `${ASSETS_BASE}/${clean}` : clean;
  }

  function filePickerEmptyLabel(inputId) {
    if (inputId === "samplesFile") return "xlsx, docx, tsv · 여러 파일 선택 가능";
    if (inputId === "studentsFile") return "tsv, csv, xlsx";
    const rule = FILE_RULES[inputId];
    return rule ? `${rule.label} · 파일 선택` : "선택된 파일 없음";
  }

  function setupFilePickers() {
    document.querySelectorAll("[data-file-trigger]").forEach((btn) => {
      const inputId = btn.getAttribute("data-file-trigger");
      const input = document.getElementById(inputId);
      const nameEl = document.getElementById(`${inputId}Name`);
      if (!input) return;

      btn.addEventListener("click", () => input.click());

      input.addEventListener("change", () => {
        const files = input.files ? [...input.files] : [];
        if (!nameEl) return;

        if (!files.length) {
          nameEl.textContent = filePickerEmptyLabel(inputId);
          nameEl.classList.remove("has-file", "is-invalid");
          return;
        }

        const check = validateFiles(files, inputId);
        if (check.rejected.length) {
          nameEl.textContent = `지원 안 함: ${formatRejectedNames(check.rejected)}`;
          nameEl.classList.add("is-invalid");
          nameEl.classList.remove("has-file");
          showToast(`지원하지 않는 형식입니다. (${check.rule.label})`);
          input.value = "";
          return;
        }

        nameEl.classList.remove("is-invalid");
        nameEl.classList.add("has-file");
        if (files.length === 1) {
          nameEl.textContent = files[0].name;
        } else {
          nameEl.textContent = `${files.length}개 파일 선택됨`;
        }
      });
    });

    document.querySelectorAll(".admin-sample-links a[href^='samples/']").forEach((link) => {
      const href = link.getAttribute("href");
      if (href) link.setAttribute("href", assetUrl(href));
    });
  }

  const gate = document.getElementById("adminGate");
  const app = document.getElementById("adminApp");
  const loginForm = document.getElementById("loginForm");
  const loginError = document.getElementById("loginError");
  const logoutBtn = document.getElementById("logoutBtn");
  const toast = document.getElementById("toast");

  let currentStudentId = null;
  let currentStudentData = null;
  let lastTabBeforeDetail = "review";
  let selectedSampleIds = new Set();
  let selectedStudentIds = new Set();
  let selectedReviewIds = new Set();
  let inspectReportCache = new Map();
  let currentInspectReport = null;
  const INSPECT_STATUS_LABEL = {
    fail: "확인 필요",
    warn: "주의",
    ok: "통과",
    pending: "미검사",
  };

  const NEIS_BYTE_LIMITS = {
    행발: { hardMax: 900, warnMax: 850 },
    세특: { hardMax: 1500, warnMax: 1400 },
    창체: { hardMax: 1500, warnMax: 1400 },
  };

  const NEIS_MATH_SYMBOLS = /[\+\-\*\/=<>∞∑∏∫√∂∆πθΩαβγδεζηλμνξοπρστυφχψω·]/g;
  const NEIS_OTHER_SYMBOLS = /[‘’“”]/g;
  const NEIS_GENERAL_SPECIAL = /[\{\}\[\]\/?.,;:|\)*~`!^\-_+<>@\#$%&\\\=\(\'\"]/g;
  const NEIS_HANGUL = /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/g;

  function neisCounterNormalize(text) {
    let content = String(text ?? "");
    if (content === "\n" && content.startsWith("\n")) {
      content = content.slice(1);
    }
    if (content !== "\n" && content.endsWith("\n")) {
      content = content.slice(0, -1);
    }
    return content;
  }

  function neisCounterByteLen(text) {
    const content = neisCounterNormalize(text);
    const english = content
      .replace(NEIS_HANGUL, "")
      .replace(/[0-9]/g, "")
      .replace(NEIS_MATH_SYMBOLS, "")
      .replace(NEIS_GENERAL_SPECIAL, "")
      .replace(/\s/g, "")
      .replace(NEIS_OTHER_SYMBOLS, "");

    const korean = content
      .replace(/[a-zA-Z]/g, "")
      .replace(/[0-9]/g, "")
      .replace(NEIS_MATH_SYMBOLS, "")
      .replace(NEIS_GENERAL_SPECIAL, "")
      .replace(/\s/g, "")
      .replace(NEIS_OTHER_SYMBOLS, "");

    const number = content
      .replace(/[a-zA-Z]/g, "")
      .replace(NEIS_HANGUL, "")
      .replace(NEIS_MATH_SYMBOLS, "")
      .replace(NEIS_GENERAL_SPECIAL, "")
      .replace(/\s/g, "")
      .replace(NEIS_OTHER_SYMBOLS, "");

    const onebyteSpecial = content
      .replace(/[a-zA-Z]/g, "")
      .replace(NEIS_HANGUL, "")
      .replace(/[0-9]/g, "")
      .replace(/[\n\t\r\s]/g, "");

    const threebyteSpecial = content
      .replace(/[a-zA-Z]/g, "")
      .replace(NEIS_HANGUL, "")
      .replace(/[0-9]/g, "")
      .replace(NEIS_MATH_SYMBOLS, "")
      .replace(NEIS_GENERAL_SPECIAL, "")
      .replace(/[\n\t\r\s]/g, "")
      .replace(NEIS_OTHER_SYMBOLS, "");

    const space = content
      .replace(/[a-zA-Z]/g, "")
      .replace(NEIS_HANGUL, "")
      .replace(/[0-9]/g, "")
      .replace(NEIS_MATH_SYMBOLS, "")
      .replace(NEIS_GENERAL_SPECIAL, "")
      .replace(NEIS_OTHER_SYMBOLS, "")
      .replace(/[^\s]/g, "")
      .replace(/[\n\r]/g, "");

    const line = content
      .replace(/[a-zA-Z]/g, "")
      .replace(NEIS_HANGUL, "")
      .replace(NEIS_GENERAL_SPECIAL, "")
      .replace(/[0-9]/g, "")
      .replace(NEIS_MATH_SYMBOLS, "")
      .replace(/[^\n]/g, "")
      .replace(NEIS_OTHER_SYMBOLS, "");

    return (
      english.length +
      korean.length * 3 +
      number.length +
      onebyteSpecial.length +
      threebyteSpecial.length * 3 +
      space.length +
      line.length * 2
    );
  }

  function neisCounterStats(text) {
    const content = neisCounterNormalize(text);
    return {
      withoutSpaces: content.replace(/(\r\n\t|\n|\r\t)/g, "").replace(/ /g, "").length,
      withSpaces: content.length,
      bytes: neisCounterByteLen(text),
    };
  }

  function fieldByteLimits(sectionKey) {
    if (sectionKey === "행발") return NEIS_BYTE_LIMITS.행발;
    if (sectionKey.startsWith("세특:")) return NEIS_BYTE_LIMITS.세특;
    if (sectionKey.startsWith("창체:")) return NEIS_BYTE_LIMITS.창체;
    return NEIS_BYTE_LIMITS.창체;
  }

  function measureFieldVolume(text, sectionKey) {
    void sectionKey;
    return neisCounterStats(text).bytes;
  }

  function formatFieldVolume(stats) {
    return `공백 제외 ${stats.withoutSpaces}자, 공백 포함 ${stats.withSpaces}자, ${stats.bytes}바이트`;
  }

  function inspectBadgeHtml(studentId, report = null) {
    const cached = report || inspectReportCache.get(studentId);
    if (!cached) {
      return `<span class="admin-inspect-badge pending">${INSPECT_STATUS_LABEL.pending}</span>`;
    }
    if (cached.status === "fail") {
      return `<span class="admin-inspect-badge fail">${INSPECT_STATUS_LABEL.fail} ${cached.error_count}</span>`;
    }
    if (cached.status === "warn") {
      return `<span class="admin-inspect-badge warn">${INSPECT_STATUS_LABEL.warn} ${cached.warning_count}</span>`;
    }
    return `<span class="admin-inspect-badge ok">${INSPECT_STATUS_LABEL.ok}</span>`;
  }

  function inspectIssueClass(severity) {
    if (severity === "error") return "issue-error";
    if (severity === "warning") return "issue-warning";
    return "issue-info";
  }

  function inspectChecklistIcon(status) {
    if (status === "pass") return "✓";
    if (status === "warn") return "!";
    if (status === "fail") return "✕";
    if (status === "skip") return "—";
    return "…";
  }

  function renderInspectChecklistHtml(checklist) {
    if (!checklist?.length) return "";
    const items = checklist
      .map((item) => {
        const title = item.issue_count > 0 ? `${item.label}: ${item.message}` : item.label;
        return `<li class="admin-inspect-pill status-${item.status}" title="${escapeAttr(title)}">
          <span class="admin-inspect-check-icon" aria-hidden="true">${inspectChecklistIcon(item.status)}</span>
          <span>${escapeHtml(item.label)}</span>
        </li>`;
      })
      .join("");
    return `<ul class="admin-inspect-pills" aria-label="검사 항목">${items}</ul>`;
  }

  const INSPECT_BUSY_LABELS = [
    "NEIS 용량(바이트)",
    "금지 표현",
    "과장·비교·단정",
    "실명 노출",
    "문장 반복",
  ];
  let inspectBusyTimer = null;

  function renderBusyInspectChecklist(activeIndex = -1) {
    const el = document.getElementById("busyChecklist");
    if (!el) return;
    el.hidden = false;
    el.innerHTML = INSPECT_BUSY_LABELS.map((label, index) => {
      let status = "pending";
      if (index < activeIndex) status = "pass";
      else if (index === activeIndex) status = "active";
      return `<li class="admin-busy-check-item status-${status}">
        <span class="admin-inspect-check-icon" aria-hidden="true">${inspectChecklistIcon(status === "pass" ? "pass" : status === "active" ? "pending" : "pending")}</span>
        <span>${escapeHtml(label)}</span>
      </li>`;
    }).join("");
  }

  function startInspectBusyAnimation() {
    if (inspectBusyTimer) clearInterval(inspectBusyTimer);
    let step = 0;
    renderBusyInspectChecklist(0);
    inspectBusyTimer = setInterval(() => {
      step = (step + 1) % (INSPECT_BUSY_LABELS.length + 1);
      renderBusyInspectChecklist(step >= INSPECT_BUSY_LABELS.length ? INSPECT_BUSY_LABELS.length : step);
    }, 520);
  }

  function stopInspectBusyAnimation() {
    if (inspectBusyTimer) {
      clearInterval(inspectBusyTimer);
      inspectBusyTimer = null;
    }
    const el = document.getElementById("busyChecklist");
    if (el) {
      el.hidden = true;
      el.innerHTML = "";
    }
  }

  function formatInspectSummaryToast(summary) {
    const parts = [];
    if (summary.total) {
      parts.push(`검사 ${summary.total}명`);
      parts.push(`통과 ${summary.ok}`);
      parts.push(`주의 ${summary.warn}`);
      parts.push(`${INSPECT_STATUS_LABEL.fail} ${summary.fail}`);
    } else {
      parts.push("새로 검사한 작성본 없음");
    }
    if (summary.skipped_ok) parts.push(`이미 통과 ${summary.skipped_ok}명 건너뜀`);
    if (summary.skipped_empty) parts.push(`작성본 없음 ${summary.skipped_empty}명`);
    return `검사 완료 · ${parts.join(" · ")}`;
  }

  function renderInspectSummary(report, containerId = "detailIssues") {
    const box = document.getElementById(containerId);
    if (!box) return;
    if (!report) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    box.hidden = false;
    const checklistHtml = renderInspectChecklistHtml(report.checklist);
    const issuesHtml = report.issues?.length
      ? `<ul class="admin-inspect-issues">${report.issues
          .map((issue) => {
            const detail = issue.detail ? ` <span class="admin-muted">(${escapeHtml(issue.detail)})</span>` : "";
            return `<li class="${inspectIssueClass(issue.severity)} inspect-issue-jump" role="button" tabindex="0" data-section="${escapeAttr(issue.section)}" data-offset="${issue.offset ?? ""}" data-detail="${escapeAttr(issue.detail || "")}">
          <span class="issue-section">${escapeHtml(issue.section)}</span>${escapeHtml(issue.message)}${detail}
        </li>`;
          })
          .join("")}</ul>`
      : `<p class="admin-muted admin-inspect-ok-note">세부 검토 사항이 없습니다. 위 항목을 모두 통과했습니다.</p>`;
    box.innerHTML = `
      <div class="admin-inspect-summary-bar">
        <h3>검사 결과 ${inspectBadgeHtml(report.student_id, report)}</h3>
        ${checklistHtml}
      </div>
      ${issuesHtml}`;
    box.querySelectorAll(".inspect-issue-jump").forEach((item) => {
      item.addEventListener("click", () => {
        const section = item.dataset.section;
        const issue = {
          offset: item.dataset.offset ? Number(item.dataset.offset) : null,
          detail: item.dataset.detail || "",
        };
        focusInspectField(section, issue);
      });
    });
  }

  function renderFieldIssues(report) {
    const bySection = new Map();
    for (const issue of report?.issues || []) {
      if (!bySection.has(issue.section)) bySection.set(issue.section, []);
      bySection.get(issue.section).push(issue);
    }
    document.querySelectorAll(".inspect-field-issues").forEach((list) => {
      const section = list.dataset.for;
      const issues = bySection.get(section) || [];
      if (!issues.length) {
        list.innerHTML = "";
        return;
      }
      list.innerHTML = issues
        .map(
          (issue) =>
            `<li class="${inspectIssueClass(issue.severity)} inspect-issue-clickable" role="button" tabindex="0" data-section="${escapeAttr(section)}" data-offset="${issue.offset ?? ""}" data-detail="${escapeAttr(issue.detail || "")}">${escapeHtml(issue.message)}</li>`
        )
        .join("");
      list.querySelectorAll(".inspect-issue-clickable").forEach((item) => {
        item.addEventListener("click", () => {
          const issue = {
            offset: item.dataset.offset ? Number(item.dataset.offset) : null,
            detail: item.dataset.detail || "",
          };
          focusInspectField(section, issue);
        });
      });
    });
  }

  function updateDetailCharCounts(report = currentInspectReport) {
    document.querySelectorAll("#detailEditor .detail-field").forEach((textarea) => {
      const section = textarea.dataset.key;
      if (!section) return;
      const counter = document.querySelector(`.inspect-char-count[data-for="${CSS.escape(section)}"]`);
      if (!counter) return;
      const stats = neisCounterStats(textarea.value);
      counter.textContent = formatFieldVolume(stats);
      counter.classList.remove("is-warn", "is-error");
      const sectionIssues = (report?.issues || []).filter((issue) => issue.section === section);
      if (sectionIssues.some((issue) => issue.severity === "error")) {
        counter.classList.add("is-error");
      } else if (sectionIssues.some((issue) => issue.severity === "warning")) {
        counter.classList.add("is-warn");
      } else {
        const limits = fieldByteLimits(section);
        if (stats.bytes > limits.hardMax) counter.classList.add("is-error");
        else if (stats.bytes > limits.warnMax) counter.classList.add("is-warn");
      }
    });
  }

  function bindDetailEditorInspectEvents() {
    document.querySelectorAll("#detailEditor .detail-field").forEach((textarea) => {
      textarea.addEventListener("input", () => updateDetailCharCounts());
    });
  }

  async function inspectStudents(ids = null) {
    const data = await api("/api/students");
    let students = mergeStudentsWithDrafts(data.students || []);
    if (ids?.length) {
      const idSet = new Set(ids);
      students = students.filter((student) => idSet.has(student.id));
    }
    const candidates = students.filter((student) => Object.keys(student.generated || {}).length);
    const skipOkIds = candidates
      .filter((student) => inspectReportCache.get(student.id)?.status === "ok")
      .map((student) => student.id);
    const items = candidates.map((student) => ({
      id: student.id,
      name: student.name || "",
      label: studentLabel(student),
      generated: student.generated || {},
    }));
    const body = { items, skip_ok_ids: skipOkIds };
    if (ids?.length) body.ids = ids;
    const result = await api("/api/inspect/batch", { method: "POST", body });
    for (const report of result.reports || []) {
      if (report.student_id) inspectReportCache.set(report.student_id, report);
    }
    return result;
  }

  async function inspectCurrentStudent({ generated = null } = {}) {
    if (!currentStudentId) return null;
    const body = {};
    const editorGenerated = generated ?? collectGeneratedFromEditor();
    if (Object.keys(editorGenerated || {}).length) {
      body.generated = editorGenerated;
    }
    const report = await api(`/api/students/${currentStudentId}/inspect`, {
      method: "POST",
      body,
    });
    inspectReportCache.set(currentStudentId, report);
    currentInspectReport = report;
    return report;
  }

  async function runInspectBatch(ids = null) {
    const stop = startBusy("생기부 검사", "작성본을 기재요령 기준으로 점검합니다.", "항목별로 순차 검사합니다.", {
      showModel: false,
      showInspectChecklist: true,
    });
    startInspectBusyAnimation();
    try {
      const data = await inspectStudents(ids);
      const { summary } = data;
      showToast(formatInspectSummaryToast(summary || {}));
      await loadReviewList();
      if (currentStudentId && inspectReportCache.has(currentStudentId)) {
        currentInspectReport = inspectReportCache.get(currentStudentId);
        renderInspectSummary(currentInspectReport);
        renderFieldIssues(currentInspectReport);
        updateDetailCharCounts(currentInspectReport);
      }
      return data;
    } catch (error) {
      showToast(error.message || "검사 실패");
      return null;
    } finally {
      stopInspectBusyAnimation();
      stop();
    }
  }

  function sectionSubjectFromKey(key) {
    const colon = key.indexOf(":");
    return colon >= 0 ? key.slice(colon + 1) : key;
  }

  function focusInspectField(sectionKey, issue = null) {
    const field = document.querySelector(`#detailEditor .inspect-field[data-field-key="${CSS.escape(sectionKey)}"]`);
    const textarea = field?.querySelector(".detail-field");
    if (!field || !textarea) return;
    document.querySelectorAll("#detailEditor .inspect-field").forEach((el) => el.classList.remove("inspect-field-active"));
    field.classList.add("inspect-field-active", "inspect-field-highlight");
    field.scrollIntoView({ behavior: "smooth", block: "center" });
    textarea.focus();
    if (issue?.offset != null && issue.detail) {
      const start = Number(issue.offset);
      const len = String(issue.detail).length || 8;
      try {
        textarea.setSelectionRange(start, start + len);
      } catch {
        /* ignore */
      }
    }
    window.setTimeout(() => field.classList.remove("inspect-field-highlight"), 1400);
  }

  let busyTimer = null;
  let busyStartedAt = 0;
  let systemInfo = {
    gemini_model: "",
    gemini_model_pro: "",
  };
  let privacySettings = { store_generated: false, encrypt_data: true, mask_pii: true };
  let usageLine = "";
  const writingTipsCache = new Map();
  let curriculumTimer = null;

  const busyOverlay = document.getElementById("busyOverlay");
  const busyTitle = document.getElementById("busyTitle");
  const busyMessage = document.getElementById("busyMessage");
  const busyModel = document.getElementById("busyModel");
  const busyHint = document.getElementById("busyHint");
  const busyElapsed = document.getElementById("busyElapsed");

  function formatUserError(error) {
    const raw = String(error?.message || error || "").trim();
    if (!raw) return "요청 처리 중 오류가 발생했습니다.";

    const lowered = raw.toLowerCase();
    if (lowered.includes("high demand") || lowered.includes("과부하")) {
      return "AI 모델이 일시적으로 과부하 상태입니다. 1~2분 후 다시 시도해 주세요.";
    }
    if (lowered.includes("분당") || lowered.includes("per minute") || lowered.includes("too many requests")) {
      return "요청이 너무 빠릅니다 (분당 호출 제한). 1~2분 후 다시 시도해 주세요.";
    }
    if (lowered.includes("resource_exhausted") || lowered.includes("resource has been exhausted")) {
      return "Gemini API 일시 제한입니다. 대시보드 한도와 무관할 수 있습니다. 잠시 후 다시 시도해 주세요.";
    }
    if (lowered.includes("quota") && (lowered.includes("월간") || lowered.includes("monthly"))) {
      return "Gemini 월간·일일 한도에 도달했을 수 있습니다. AI Studio 사용량을 확인해 주세요.";
    }
    if (lowered.includes("이번 달 무료 작성 한도")) {
      return raw;
    }
    if (lowered.includes("503") || lowered.includes("unavailable")) {
      return "AI 서비스를 일시적으로 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.";
    }
    if (lowered.includes("429") || lowered.includes("too many requests")) {
      return "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.";
    }
    if (lowered.includes("timeout") || lowered.includes("timed out") || lowered.includes("초과")) {
      return "AI 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.";
    }
    if (lowered.includes("연결할 수 없습니다") || lowered.includes("failed to fetch")) {
      return raw;
    }
    if (raw.length > 120 || raw.includes("{") || raw.includes("error")) {
      console.warn("[sgb] API error:", raw);
      return "작성 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
    }
    return raw;
  }

  let toastTimer = null;

  function showToast(message) {
    if (!toast) return;
    const text = formatUserError(message);
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    toast.textContent = text;
    toast.classList.add("show");
    toastTimer = setTimeout(() => {
      toast.classList.remove("show");
      toastTimer = setTimeout(() => {
        toast.textContent = "";
        toastTimer = null;
      }, 400);
    }, 4500);
  }

  function applyGeminiModels(data) {
    if (typeof data === "string") {
      if (data && data !== "—") systemInfo.gemini_model = data;
    } else if (data && typeof data === "object") {
      if (data.gemini_model_pro) systemInfo.gemini_model_pro = data.gemini_model_pro;
      if (data.gemini_model) systemInfo.gemini_model = data.gemini_model;
    }
    systemInfo.gemini_model = systemInfo.gemini_model || systemInfo.gemini_model_pro;
    refreshBusyModelDisplay();
  }

  function modelLineText() {
    const pro = systemInfo.gemini_model_pro || systemInfo.gemini_model;
    if (pro) return `작성 · ${pro}`;
    return "사용 모델 · 확인 중…";
  }

  function refreshBusyModelDisplay() {
    if (!busyModel || busyModel.hidden) return;
    busyModel.textContent = modelLineText();
  }

  async function ensureModelInfo() {
    if (systemInfo.gemini_model_pro) {
      return systemInfo.gemini_model_pro;
    }
    await loadSystemInfo().catch(() => null);
    return systemInfo.gemini_model_pro;
  }

  function setBusy(active, title = "AI 처리 중", message = "잠시만 기다려 주세요", hint = "", options = {}) {
    const { showModel = true, showInspectChecklist = false } = options;
    if (active) {
      document.body.classList.add("admin-is-busy");
      if (busyOverlay) busyOverlay.hidden = false;
      if (busyTitle) busyTitle.textContent = title;
      if (busyMessage) busyMessage.textContent = message;
      if (busyHint) busyHint.textContent = hint;
      if (busyModel) {
        busyModel.hidden = !showModel;
        refreshBusyModelDisplay();
        if (showModel && !systemInfo.gemini_model_pro) {
          ensureModelInfo();
        }
      }
      const busyChecklist = document.getElementById("busyChecklist");
      if (busyChecklist && !showInspectChecklist) {
        busyChecklist.hidden = true;
        busyChecklist.innerHTML = "";
      }
      if (busyElapsed) busyElapsed.textContent = "0초 경과";
      return;
    }
    if (busyTimer) {
      clearInterval(busyTimer);
      busyTimer = null;
    }
    stopInspectBusyAnimation();
    document.body.classList.remove("admin-is-busy");
    if (busyOverlay) busyOverlay.hidden = true;
  }

  function startBusy(title, message, hint = "응답을 기다리는 중입니다. 창을 닫지 마세요.", options = {}) {
    const { showModel = true } = options;
    busyStartedAt = Date.now();
    setBusy(true, title, message, hint, options);
    if (busyTimer) clearInterval(busyTimer);
    busyTimer = setInterval(() => {
      const sec = Math.floor((Date.now() - busyStartedAt) / 1000);
      if (busyElapsed) busyElapsed.textContent = `${sec}초 경과`;
    }, 1000);
    return () => setBusy(false);
  }

  async function withBusy(title, message, hint, fn, options = {}) {
    const stop = startBusy(title, message, hint, options);
    try {
      return await fn();
    } finally {
      stop();
    }
  }

  function buildRunDraftsPayload() {
    if (privacySettings.store_generated) return [];
    const drafts = loadDrafts();
    return Object.entries(drafts).map(([studentId, draft]) => ({
      student_id: studentId,
      generated: draft?.generated || {},
    }));
  }

  function buildRunPayload({ studentId = null, limit = null } = {}) {
    const section = getSelectedWriteSection();
    const payload = {};
    if (studentId) payload.student_id = studentId;
    if (limit) payload.limit = limit;
    const drafts = buildRunDraftsPayload();
    if (drafts.length) payload.drafts = drafts;
    if (section === "전체") {
      payload.all_targets = true;
      return payload;
    }
    payload.all_targets = false;
    payload.sections = [section];
    return payload;
  }

  function parseJobMessage(message = "") {
    return { phase: "write", detail: message };
  }

  function formatJobProgress(job) {
    const parts = [];
    if (job.total) parts.push(`${job.processed || 0}/${job.total}`);
    if (job.current_section) parts.push(job.current_section);
    const label = job.current_label || "";
    const { detail } = parseJobMessage(job.message || "");
    const message = detail;
    if (message && message !== "완료" && message !== "작성을 시작합니다.") {
      if (label && message.includes(label)) {
        parts.push(message);
      } else {
        if (label) parts.push(label);
        parts.push(message);
      }
    } else if (label) {
      parts.push(label);
    } else if (message) {
      parts.push(message);
    }
    return parts.join(" · ") || "작성 중...";
  }

  function updateBusyFromJob(job) {
    const message = formatJobProgress(job);
    if (busyMessage) busyMessage.textContent = message;
    if (job.gemini_model_pro || job.gemini_model) {
      applyGeminiModels(job);
    }
    const { phase: _phase } = parseJobMessage(job.message || "");
    refreshBusyModelDisplay();
    if (busyTitle) {
      busyTitle.textContent = "AI 작성 중";
    }
    if (busyHint) {
      busyHint.textContent = "응답을 기다리는 중입니다. 창을 닫지 마세요.";
    }
  }

  async function pollRunJob(jobId) {
    const intervalMs = 1200;
    while (true) {
      const job = await api(`/api/jobs/${jobId}`);
      updateBusyFromJob(job);
      if (job.status === "done" || job.status === "error") return job;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  async function withAsyncRun(title, message, hint, payload) {
    await ensureModelInfo();
    const stop = startBusy(title || "AI 작성 중", message, hint, { showModel: true });
    try {
      const started = await api("/api/run/async", { method: "POST", body: payload });
      if (started.gemini_model_pro || started.gemini_model) {
        applyGeminiModels(started);
      }
      const job = await pollRunJob(started.job_id);
      if (job.status === "error") {
        throw new Error(job.message || "작성 중 오류가 발생했습니다.");
      }
      const result = job.result || {};
      persistRunResponse(result);
      const errors = job.errors?.length ? job.errors : result.errors || [];
      if (errors.length) {
        const first = formatUserError(errors[0]?.error || errors[0]?.message || "");
        const suffix = errors.length > 1 ? ` 외 ${errors.length - 1}건` : "";
        return { ...result, message: job.message, partialErrors: `${first}${suffix}` };
      }
      return { ...result, message: job.message };
    } finally {
      stop();
    }
  }

  async function loadSystemInfo() {
    try {
      const data = await api("/api/auth/me");
      applyGeminiModels(data);
      if (data.privacy) {
        privacySettings = {
          store_generated: Boolean(data.privacy.store_generated),
          encrypt_data: Boolean(data.privacy.encrypt_data),
          mask_pii: data.privacy.mask_pii !== false,
        };
      }
      updatePrivacyHint();
      return data;
    } catch {
      return null;
    }
  }

  function loadDrafts() {
    try {
      return JSON.parse(sessionStorage.getItem(DRAFTS_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function saveDrafts(drafts) {
    sessionStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
  }

  function getDraft(studentId) {
    return loadDrafts()[studentId] || null;
  }

  function setDraft(studentId, generated, status) {
    const drafts = loadDrafts();
    if (!generated || !Object.keys(generated).length) {
      delete drafts[studentId];
    } else {
      drafts[studentId] = { generated, status: status || "done" };
    }
    saveDrafts(drafts);
  }

  function removeDrafts(studentIds) {
    const drafts = loadDrafts();
    let changed = false;
    for (const id of studentIds) {
      if (drafts[id]) {
        delete drafts[id];
        changed = true;
      }
    }
    if (changed) saveDrafts(drafts);
  }

  function clearAllDrafts() {
    sessionStorage.removeItem(DRAFTS_KEY);
  }

  function mergeStudentWithDraft(student) {
    if (privacySettings.store_generated) return student;
    const draft = getDraft(student.id);
    if (!draft?.generated || !Object.keys(draft.generated).length) return student;
    return {
      ...student,
      generated: draft.generated,
      status: draft.status || student.status,
    };
  }

  function mergeStudentsWithDrafts(students) {
    return students.map(mergeStudentWithDraft);
  }

  function persistRunResponse(data) {
    if (privacySettings.store_generated || !data) return;
    if (data.mode === "single" && data.student) {
      setDraft(data.student.id, data.student.generated, data.student.status);
      return;
    }
    if (data.mode === "batch" && Array.isArray(data.results)) {
      for (const item of data.results) {
        if (item.generated) setDraft(item.id, item.generated, item.status);
      }
    }
  }

  function updatePrivacyHint() {
    const note = document.getElementById("storageNote");
    if (!note) return;
    if (!privacySettings.store_generated) {
      note.hidden = false;
      const parts = ["작성본은 이 브라우저에만 보관됩니다. 탭을 닫기 전에 엑셀로 백업하세요."];
      if (privacySettings.encrypt_data) parts.push("학생 메모는 서버에 암호화 저장됩니다.");
      note.textContent = parts.join(" ");
    } else {
      note.hidden = true;
      note.textContent = "";
    }
  }

  function renderWritingTips(el, data) {
    if (!el || !data) return;
    const section = data.section;
    const items = section?.checklist || data.common?.checklist || [];
    if (!items.length) return;
    const title = section?.title || "작성 체크리스트";
    el.innerHTML = `<details>
      <summary>${escapeHtml(title)} 체크리스트</summary>
      <ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </details>`;
  }

  async function loadWritingTipsPanel(section, el) {
    if (!el) return;
    if (writingTipsCache.has(section)) {
      renderWritingTips(el, writingTipsCache.get(section));
      return;
    }
    try {
      const data = await api(`/api/guides/writing?section=${encodeURIComponent(section)}`);
      writingTipsCache.set(section, data);
      renderWritingTips(el, data);
    } catch {
      /* optional UI */
    }
  }

  async function initWritingTips() {
    const panels = document.querySelectorAll(".admin-writing-tips[data-tips-section]");
    await Promise.all(
      [...panels].map((el) => loadWritingTipsPanel(el.dataset.tipsSection, el))
    );
  }

  function scheduleCurriculumLookup() {
    if (curriculumTimer) clearTimeout(curriculumTimer);
    curriculumTimer = setTimeout(() => {
      refreshCurriculumStandards().catch(() => {});
    }, 450);
  }

  async function refreshCurriculumStandards() {
    const box = document.getElementById("curriculumStandards");
    const list = document.getElementById("curriculumStandardsList");
    const subject = document.getElementById("simpleSubject")?.value.trim();
    if (!box || !list || !subject) {
      if (box) box.hidden = true;
      return;
    }
    const params = new URLSearchParams({
      subject,
      career: document.getElementById("simpleSetukCareer")?.value.trim() || "",
      assessment_type: document.getElementById("simpleSetukAssessment")?.value.trim() || "",
      topic: document.getElementById("simpleSetukTopic")?.value.trim() || "",
      content: document.getElementById("simpleSetukContent")?.value.trim() || "",
      limit: "4",
    });
    const data = await api(`/api/curriculum/standards?${params}`);
    if (!data.resolved || !data.standards?.length) {
      box.hidden = true;
      list.innerHTML = "";
      return;
    }
    list.innerHTML = data.standards
      .map(
        (item) =>
          `<li><span class="std-code">${escapeHtml(item.code)}</span>${escapeHtml(item.text)}${
            item.unit ? ` <span class="admin-muted">(${escapeHtml(item.unit)})</span>` : ""
          }</li>`
      )
      .join("");
    box.hidden = false;
  }

  function bindCurriculumInputs() {
    for (const id of [
      "simpleSubject",
      "simpleSetukCareer",
      "simpleSetukAssessment",
      "simpleSetukTopic",
      "simpleSetukContent",
    ]) {
      document.getElementById(id)?.addEventListener("input", scheduleCurriculumLookup);
    }
  }

  function showUploadLog(elementId, lines) {
    const el = document.getElementById(elementId);
    if (!el) return;
    if (!lines.length) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = lines.join("\n");
  }

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || "";
  }

  function setToken(token) {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
      sessionStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
    }
  }

  function isEditableTarget(target) {
    if (!target) return false;
    const tag = target.tagName?.toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
  }

  async function api(path, options = {}, allowRetry = true) {
    const headers = { ...(options.headers || {}) };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const isForm = options.body instanceof FormData;
    if (!isForm && options.body && typeof options.body === "object") {
      headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(options.body);
    }

    let response;
    try {
      response = await fetch(`${API_BASE}${path}`, { ...options, headers, credentials: "include" });
    } catch {
      const hint = configuredBase
        ? `API 서버(${configuredBase})에 연결할 수 없습니다. NAS·터널이 실행 중인지 확인하세요.`
        : "API 서버에 연결할 수 없습니다.";
      throw new Error(hint);
    }
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { detail: text };
    }

    if (!response.ok) {
      if (response.status === 401 && token && allowRetry) {
        setToken("");
        return api(path, options, false);
      }
      const message = data?.detail || data?.message || `요청 실패 (${response.status})`;
      const rawMessage = typeof message === "string" ? message : JSON.stringify(message);
      const error = new Error(options.rawError ? rawMessage : formatUserError(rawMessage));
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function showGate() {
    gate.hidden = false;
    app.hidden = true;
    const footer = document.getElementById("adminFooter");
    if (footer) footer.hidden = true;
  }

  function showApp() {
    gate.hidden = true;
    app.hidden = false;
    const footer = document.getElementById("adminFooter");
    if (footer) footer.hidden = false;
  }

  function switchTab(name) {
    document.querySelectorAll(".admin-tab").forEach((btn) => {
      const tabName = btn.dataset.tab;
      if (tabName === "detail") {
        btn.hidden = name !== "detail";
      }
      btn.classList.toggle("active", tabName === name);
    });
    document.querySelectorAll(".admin-panel").forEach((panel) => {
      const key = panel.id.replace(/^panel/, "").toLowerCase();
      panel.hidden = key !== name;
    });
  }

  function statusPill(status) {
    const labels = {
      pending: "대기",
      done: "완료",
      partial: "일부 완료",
      error: "오류",
      in_progress: "작성 중",
    };
    return `<span class="status-pill status-${status}">${labels[status] || status}</span>`;
  }

  const WRITE_SECTION_LABELS = {
    행발: "행동특성 및 종합의견",
    세특: "세부능력 및 특기사항",
    자율: "자율활동",
    동아리: "동아리활동",
    봉사: "봉사활동",
    진로: "진로활동",
    창체: "창의적 체험활동",
    전체: "등록된 전체 항목",
  };

  const MEMO_TARGET_OPTIONS = ["행발", "세특", "자율", "동아리", "진로"];
  const UI_WRITE_SECTIONS = ["행발", "세특", "자율", "동아리", "진로"];
  let memoEditStudentId = null;
  let memoEditStudentData = null;
  let samplesCache = [];
  let samplesPage = 1;
  let samplesPageSize = 10;

  function buildTargetSegmentMarkup(options, inputClass, selectedSet) {
    return options
      .map(
        (target) => `
        <label class="admin-write-seg">
          <input type="checkbox" class="${inputClass}" value="${target}" ${
            selectedSet.has(target) ? "checked" : ""
          }>
          <span class="admin-write-seg-label">${target}</span>
        </label>`
      )
      .join("");
  }

  function getSelectedWriteTargets() {
    return [...document.querySelectorAll(".write-target:checked")].map((el) => el.value);
  }

  function updateStudentMemoPanels() {
    const selected = new Set(getSelectedWriteTargets());
    let firstVisible = null;
    document.querySelectorAll(".admin-memo-panel").forEach((panel) => {
      const target = panel.dataset.target;
      const visible = selected.has(target);
      panel.hidden = !visible;
      if (visible && !firstVisible) firstVisible = panel;
    });
    if (firstVisible && !document.querySelector(".admin-memo-panel:not([hidden])[open]")) {
      firstVisible.open = true;
    }
  }

  const META_DROPDOWNS = [
    {
      dropdownId: "simpleClassDropdown",
      pickId: "simpleClassPick",
      triggerId: "simpleClassTrigger",
      triggerWrapId: "simpleClassTriggerWrap",
      triggerTextId: "simpleClassTriggerText",
      hiddenId: "simpleClass",
      max: 15,
      suffix: "반",
      placeholder: "반 선택",
    },
    {
      dropdownId: "simpleNumberDropdown",
      pickId: "simpleNumberPick",
      triggerId: "simpleNumberTrigger",
      triggerWrapId: "simpleNumberTriggerWrap",
      triggerTextId: "simpleNumberTriggerText",
      hiddenId: "simpleNumber",
      max: 30,
      suffix: "번",
      placeholder: "번호 선택",
    },
  ];

  function getMetaDropdownConfig(pickId) {
    return META_DROPDOWNS.find((item) => item.pickId === pickId);
  }

  function formatMetaDisplay(value, suffix) {
    return `${value}${suffix}`;
  }

  function closeMetaDropdown(config) {
    const pick = document.getElementById(config.pickId);
    const trigger = document.getElementById(config.triggerId);
    if (pick) pick.hidden = true;
    if (trigger) trigger.setAttribute("aria-expanded", "false");
  }

  function closeAllMetaDropdowns(exceptPickId = "") {
    META_DROPDOWNS.forEach((config) => {
      if (config.pickId !== exceptPickId) closeMetaDropdown(config);
    });
  }

  function buildMetaDropdown(config) {
    const pick = document.getElementById(config.pickId);
    if (!pick || pick.dataset.ready) return;
    pick.dataset.ready = "1";
    pick.innerHTML = "";
    for (let i = 1; i <= config.max; i += 1) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "admin-meta-btn";
      btn.dataset.value = String(i);
      btn.setAttribute("role", "option");
      btn.textContent = String(i);
      if (i === 1) btn.classList.add("active");
      pick.appendChild(btn);
    }
    const customBtn = document.createElement("button");
    customBtn.type = "button";
    customBtn.className = "admin-meta-btn admin-meta-btn-custom";
    customBtn.dataset.custom = "1";
    customBtn.setAttribute("role", "option");
    customBtn.textContent = "직접 입력";
    pick.appendChild(customBtn);
  }

  function setMetaDropdownValue(pickId, value, { showPlaceholder = false } = {}) {
    const config = getMetaDropdownConfig(pickId);
    if (!config) return;
    const hidden = document.getElementById(config.hiddenId);
    const triggerText = document.getElementById(config.triggerTextId);
    const pick = document.getElementById(config.pickId);
    const val = String(value);
    if (hidden) hidden.value = val;
    if (triggerText) {
      triggerText.textContent = showPlaceholder ? config.placeholder : formatMetaDisplay(val, config.suffix);
    }
    if (!pick) return;
    let matchedPreset = false;
    pick.querySelectorAll(".admin-meta-btn:not(.admin-meta-btn-custom)").forEach((btn) => {
      const active = btn.dataset.value === val;
      btn.classList.toggle("active", active);
      if (active) matchedPreset = true;
    });
    pick.querySelector(".admin-meta-btn-custom")?.classList.toggle("active", !matchedPreset);
    exitMetaCustomMode(config, { keepValue: true });
  }

  function enterMetaCustomMode(config) {
    const wrap = document.getElementById(config.triggerWrapId);
    const trigger = document.getElementById(config.triggerId);
    const hidden = document.getElementById(config.hiddenId);
    if (!wrap || !trigger || wrap.dataset.customMode === "1") return;
    closeMetaDropdown(config);
    wrap.dataset.customMode = "1";
    trigger.hidden = true;
    const input = document.createElement("input");
    input.type = "number";
    input.min = "1";
    input.className = "admin-meta-trigger-input";
    input.inputMode = "numeric";
    input.value = hidden?.value || "";
    input.setAttribute("aria-label", config.placeholder);
    wrap.appendChild(input);
    input.focus();
    input.select();

    const applyCustom = () => {
      const raw = input.value.trim();
      const previous = hidden?.value || "1";
      if (!raw) {
        setMetaDropdownValue(config.pickId, previous);
        return;
      }
      const num = Number(raw);
      if (!Number.isFinite(num) || num < 1) {
        setMetaDropdownValue(config.pickId, previous);
        return;
      }
      setMetaDropdownValue(config.pickId, String(Math.floor(num)));
    };

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        applyCustom();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMetaDropdownValue(config.pickId, hidden?.value || "1");
      }
    });
    input.addEventListener("blur", applyCustom, { once: true });
  }

  function exitMetaCustomMode(config, { keepValue = false } = {}) {
    const wrap = document.getElementById(config.triggerWrapId);
    const trigger = document.getElementById(config.triggerId);
    if (!wrap || wrap.dataset.customMode !== "1") return;
    wrap.querySelector(".admin-meta-trigger-input")?.remove();
    if (trigger) trigger.hidden = false;
    wrap.dataset.customMode = "0";
    if (!keepValue) {
      const hidden = document.getElementById(config.hiddenId);
      const triggerText = document.getElementById(config.triggerTextId);
      const val = hidden?.value || "1";
      if (triggerText) triggerText.textContent = formatMetaDisplay(val, config.suffix);
    }
  }

  function wireMetaDropdown(config) {
    const pick = document.getElementById(config.pickId);
    const trigger = document.getElementById(config.triggerId);
    if (!pick || !trigger || pick.dataset.wired) return;
    pick.dataset.wired = "1";

    trigger.addEventListener("click", () => {
      const wrap = document.getElementById(config.triggerWrapId);
      if (wrap?.dataset.customMode === "1") return;
      const willOpen = pick.hidden;
      closeAllMetaDropdowns(config.pickId);
      pick.hidden = !willOpen;
      trigger.setAttribute("aria-expanded", willOpen ? "true" : "false");
    });

    pick.addEventListener("click", (event) => {
      const customBtn = event.target.closest(".admin-meta-btn-custom");
      if (customBtn) {
        enterMetaCustomMode(config);
        return;
      }
      const btn = event.target.closest(".admin-meta-btn");
      if (!btn) return;
      setMetaDropdownValue(config.pickId, btn.dataset.value);
      closeMetaDropdown(config);
    });
  }

  function initStudentFormControls() {
    META_DROPDOWNS.forEach((config) => {
      buildMetaDropdown(config);
      wireMetaDropdown(config);
      setMetaDropdownValue(config.pickId, 1, { showPlaceholder: true });
    });

    if (!document.body.dataset.metaDropdownBound) {
      document.body.dataset.metaDropdownBound = "1";
      document.addEventListener("click", (event) => {
        if (event.target.closest(".admin-meta-dropdown")) return;
        closeAllMetaDropdowns();
      });
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeAllMetaDropdowns();
      });
    }
  }

  function setStudentGrade(grade) {
    const value = String(grade);
    const hidden = document.getElementById("simpleGrade");
    if (hidden) hidden.value = value;
    document.querySelectorAll(".admin-grade-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.grade === value);
    });
  }

  function resetStudentFormDefaults() {
    setStudentGrade(2);
    setMetaDropdownValue("simpleClassPick", 1, { showPlaceholder: true });
    setMetaDropdownValue("simpleNumberPick", 1, { showPlaceholder: true });
    document.querySelectorAll(".write-target").forEach((box) => {
      box.checked = box.value === "행발";
    });
    updateStudentMemoPanels();
  }

  function formatWriteTargets(student) {
    const raw = student.notes?.write_targets;
    if (Array.isArray(raw) && raw.length) {
      return raw.join(", ");
    }
    const inferred = [];
    if (student.notes?.행발 || student.notes?.행발_notes) inferred.push("행발");
    if (student.subjects && Object.keys(student.subjects).length) inferred.push("세특");
    const changche = student.changche || {};
    for (const key of ["자율", "동아리", "진로"]) {
      if (changche[key]) inferred.push(key);
    }
    return inferred.length ? inferred.join(", ") : "-";
  }

  function getMemoEditTargets() {
    return [...document.querySelectorAll(".memo-edit-target:checked")].map((el) => el.value);
  }

  function updateMemoEditPanels() {
    const selected = new Set(getMemoEditTargets());
    document.querySelectorAll(".memo-edit-panel").forEach((panel) => {
      panel.hidden = !selected.has(panel.dataset.target);
    });
  }

  function buildMemoEditSubjectBlock(subject, info = {}) {
    const safeSubject = escapeAttr(subject || "");
    return `
      <div class="admin-field memo-edit-subject" data-subject="${safeSubject}">
        <div class="admin-field-head">
          <label>세특 · ${escapeHtml(subject || "과목")}</label>
          <button type="button" class="admin-btn danger admin-btn-sm memo-remove-subject">삭제</button>
        </div>
        <input class="memo-subject-name" value="${escapeHtml(subject || "")}" placeholder="과목명">
        <input class="memo-subject-career" value="${escapeHtml(info.career || "")}" placeholder="진로">
        <input class="memo-subject-assessment" value="${escapeHtml(info.assessment_type || "")}" placeholder="수행평가 형식">
        <input class="memo-subject-topic" value="${escapeHtml(info.topic || "")}" placeholder="주제">
        <textarea class="admin-textarea memo-subject-content" rows="4" placeholder="활동 내용">${escapeHtml(info.content || info.notes || (info.activities || [])[0] || "")}</textarea>
      </div>`;
  }

  function buildMemoEditForm(student) {
    const targetsEl = document.getElementById("memoEditTargets");
    const fieldsEl = document.getElementById("memoEditFields");
    if (!targetsEl || !fieldsEl) return;

    const selected = new Set(
      Array.isArray(student.notes?.write_targets) && student.notes.write_targets.length
        ? student.notes.write_targets
        : formatWriteTargets(student).split(", ").filter((item) => item !== "-")
    );

    targetsEl.innerHTML = buildTargetSegmentMarkup(MEMO_TARGET_OPTIONS, "memo-edit-target", selected);

    const subjects = student.subjects || {};
    const subjectBlocks = Object.keys(subjects).length
      ? Object.entries(subjects).map(([subject, info]) => buildMemoEditSubjectBlock(subject, info)).join("")
      : buildMemoEditSubjectBlock("", {});

    fieldsEl.innerHTML = `
      <details class="admin-memo-panel memo-edit-panel" data-target="행발" ${selected.has("행발") ? "open" : ""}>
        <summary>행발 메모</summary>
        <textarea id="memoEditHaengbal" class="admin-textarea" rows="4">${escapeHtml(
          student.notes?.행발 || student.notes?.행발_notes || ""
        )}</textarea>
      </details>
      <details class="admin-memo-panel memo-edit-panel" data-target="세특" ${selected.has("세특") ? "open" : ""}>
        <summary>세특 메모</summary>
        <div id="memoEditSubjects">${subjectBlocks}</div>
        <button type="button" id="memoAddSubjectBtn" class="admin-btn secondary admin-btn-sm" style="margin-top:8px">과목 추가</button>
      </details>
      ${["자율", "동아리", "진로"]
        .map(
          (key) => `
        <details class="admin-memo-panel memo-edit-panel" data-target="${key}" ${selected.has(key) ? "open" : ""}>
          <summary>${WRITE_SECTION_LABELS[key] || key} 메모</summary>
          <textarea class="admin-textarea memo-edit-changche" data-key="${key}" rows="3">${escapeHtml(
            (student.changche || {})[key] || ""
          )}</textarea>
        </details>`
        )
        .join("")}`;

    updateMemoEditPanels();
    targetsEl.querySelectorAll(".memo-edit-target").forEach((box) => {
      box.addEventListener("change", (event) => {
        const selectedTargets = getMemoEditTargets();
        if (!selectedTargets.length) {
          event.target.checked = true;
          showToast("최소 한 항목은 선택해야 합니다.");
          return;
        }
        updateMemoEditPanels();
      });
    });
    document.getElementById("memoAddSubjectBtn")?.addEventListener("click", () => {
      document.getElementById("memoEditSubjects")?.insertAdjacentHTML("beforeend", buildMemoEditSubjectBlock("", {}));
    });
    fieldsEl.querySelectorAll(".memo-remove-subject").forEach((btn) => {
      btn.addEventListener("click", () => btn.closest(".memo-edit-subject")?.remove());
    });
  }

  function collectMemoEditPayload() {
    const writeTargets = getMemoEditTargets();
    const notes = {
      ...(memoEditStudentData?.notes || {}),
      행발: document.getElementById("memoEditHaengbal")?.value.trim() || "",
      write_targets: writeTargets,
    };
    delete notes.행발_notes;

    const subjects = {};
    document.querySelectorAll(".memo-edit-subject").forEach((block) => {
      const subject = block.querySelector(".memo-subject-name")?.value.trim() || "";
      const content = block.querySelector(".memo-subject-content")?.value.trim() || "";
      if (!subject) return;
      subjects[subject] = {
        career: block.querySelector(".memo-subject-career")?.value.trim() || "",
        assessment_type: block.querySelector(".memo-subject-assessment")?.value.trim() || "",
        topic: block.querySelector(".memo-subject-topic")?.value.trim() || "",
        content,
        activities: content ? [content] : [],
        notes: content,
      };
    });

    const changche = { ...(memoEditStudentData?.changche || {}) };
    document.querySelectorAll(".memo-edit-changche").forEach((el) => {
      changche[el.dataset.key] = el.value.trim();
    });

    return { notes, subjects, changche };
  }

  async function openMemoEditModal(studentId) {
    const modal = document.getElementById("memoEditModal");
    if (!modal) return;
    const student = await api(`/api/students/${studentId}`);
    memoEditStudentId = studentId;
    memoEditStudentData = student;
    document.getElementById("memoEditTitle").textContent = "입력 메모 수정";
    document.getElementById("memoEditSubtitle").textContent = studentLabel(student);
    buildMemoEditForm(student);
    modal.hidden = false;
    document.body.classList.add("admin-guide-open");
  }

  function closeMemoEditModal() {
    const modal = document.getElementById("memoEditModal");
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove("admin-guide-open");
    memoEditStudentId = null;
    memoEditStudentData = null;
  }

  async function saveMemoEdit() {
    if (!memoEditStudentId) return;
    const payload = collectMemoEditPayload();
    if (!payload.notes.write_targets.length) {
      showToast("작성 항목을 하나 이상 선택하세요.");
      return;
    }
    const updated = await api(`/api/students/${memoEditStudentId}`, {
      method: "PATCH",
      body: payload,
    });
    const savedId = memoEditStudentId;
    memoEditStudentData = updated;
    showToast("메모 저장됨");
    closeMemoEditModal();
    await loadStudents();
    if (currentStudentId === savedId) {
      currentStudentData = mergeStudentWithDraft(updated);
    }
  }

  function openPrivacyModal() {
    const modal = document.getElementById("privacyModal");
    if (!modal) return;
    modal.hidden = false;
    document.body.classList.add("admin-guide-open");
    document.getElementById("privacyCloseBtn")?.focus();
  }

  function closePrivacyModal() {
    const modal = document.getElementById("privacyModal");
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove("admin-guide-open");
    document.getElementById("privacyBtn")?.focus();
  }

  function getSelectedWriteSection() {
    const checked = document.querySelector('input[name="writeSection"]:checked');
    if (!checked) {
      throw new Error("작성할 영역을 선택하세요.");
    }
    return checked.value;
  }

  function updateWriteSectionUi() {
    const section = document.querySelector('input[name="writeSection"]:checked')?.value || "행발";
    const btn = document.getElementById("runBatchBtn");
    if (btn) {
      btn.textContent = "AI 일괄 작성";
    }
    if (UI_WRITE_SECTIONS.includes(section)) {
      sessionStorage.setItem("sgb_write_section", section);
    }
  }

  function restoreWriteSectionChoice() {
    const saved = sessionStorage.getItem("sgb_write_section");
    if (!saved || !UI_WRITE_SECTIONS.includes(saved)) return;
    const input = document.querySelector(`input[name="writeSection"][value="${saved}"]`);
    if (input) input.checked = true;
    updateWriteSectionUi();
  }

  function studentLabel(s) {
    return `${s.grade}-${s.class_num} ${s.number}번 ${s.name}`;
  }

  function formatUsage(usage) {
    if (!usage) return "";
    if (usage.unlimited) {
      return `무제한 · 이번 달 ${usage.generations_used}건 작성`;
    }
    const left = usage.generations_remaining ?? 0;
    const limit = usage.generations_limit ?? 0;
    return `무료 플랜 · 이번 달 ${left}/${limit}건 남음`;
  }

  async function loadUsage() {
    try {
      const usage = await api("/api/usage");
      const text = document.getElementById("usageText");
      const line = formatUsage(usage);
      usageLine = line || "";
      if (text) text.textContent = line || text.textContent;
      updatePrivacyHint();
      return usage;
    } catch {
      return null;
    }
  }

  async function loadStudents() {
    const tbody = document.getElementById("studentsTableBody");
    const toolbar = document.getElementById("studentsBulkActions");
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="5">불러오는 중…</td></tr>`;
    if (toolbar) toolbar.hidden = true;
    try {
      const data = await api("/api/students");
      const students = mergeStudentsWithDrafts(data.students);
      if (!students.length) {
        tbody.innerHTML = `<tr><td colspan="5" class="admin-muted">등록된 학생이 없습니다.</td></tr>`;
        selectedStudentIds.clear();
        updateStudentSelectionUi(0);
        return;
      }
      tbody.innerHTML = students
      .map((s) => {
        const targets = formatWriteTargets(s);
        const checked = selectedStudentIds.has(s.id) ? "checked" : "";
        const actions =
          s.status === "done"
            ? `<button class="admin-btn secondary admin-btn-sm" data-action="review" data-id="${s.id}">검토</button>`
            : `<button class="admin-btn secondary admin-btn-sm" data-action="run-one" data-id="${s.id}">${
                s.status === "partial" ? "추가 작성" : "작성"
              }</button>`;
        return `<tr>
          <td class="sample-select-cell">
            <label class="admin-check admin-check-row" title="선택">
              <input class="student-select admin-check-input" type="checkbox" data-id="${s.id}" ${checked}>
              <span class="admin-check-box" aria-hidden="true"></span>
            </label>
          </td>
          <td>${studentLabel(s)}</td>
          <td>${statusPill(s.status)}</td>
          <td>${targets}</td>
          <td class="admin-row-actions">
            <button class="admin-btn secondary admin-btn-sm" type="button" data-action="edit-memo" data-id="${s.id}">메모</button>
            ${actions}
            <button class="admin-btn danger admin-btn-sm" type="button" data-action="delete-student" data-id="${s.id}" data-label="${escapeAttr(studentLabel(s))}">삭제</button>
          </td>
        </tr>`;
      })
      .join("");
      updateStudentSelectionUi(students.length);
    } catch (error) {
      tbody.innerHTML = `<tr><td colspan="5" class="admin-muted">학생 목록을 불러오지 못했습니다. ${escapeHtml(
        error.message || "오류"
      )}</td></tr>`;
    }
  }

  function updateStudentSelectionUi(totalCount = null) {
    const toolbar = document.getElementById("studentsBulkActions");
    const countBadge = document.getElementById("studentsCountBadge");
    const countEl = document.getElementById("studentsSelectedCount");
    const deleteSelectedBtn = document.getElementById("deleteSelectedStudentsBtn");
    const selectAll = document.getElementById("studentsSelectAll");
    const boxes = [...document.querySelectorAll(".student-select")];
    const checkedCount = boxes.filter((box) => box.checked).length;
    const total = totalCount ?? boxes.length;

    if (countBadge) countBadge.textContent = `${total}명`;
    if (countEl) countEl.textContent = checkedCount ? `${checkedCount}명 선택됨` : "";
    if (deleteSelectedBtn) deleteSelectedBtn.disabled = checkedCount === 0;
    if (selectAll && boxes.length) {
      selectAll.checked = checkedCount > 0 && checkedCount === boxes.length;
      selectAll.indeterminate = checkedCount > 0 && checkedCount < boxes.length;
    }
    if (toolbar) toolbar.hidden = total === 0;
  }

  function getSelectedStudentIds() {
    return [...document.querySelectorAll(".student-select:checked")].map((box) => box.dataset.id);
  }

  async function deleteStudentsByIds(ids, confirmMessage) {
    if (!ids.length) {
      showToast("삭제할 학생을 선택하세요.");
      return;
    }
    if (!confirm(confirmMessage)) return;

    const stop = startBusy("학생 삭제", "선택한 학생을 정리하고 있습니다.", "잠시만 기다려 주세요.", { showModel: false });
    try {
      if (ids.length === 1) {
        await api(`/api/students/${ids[0]}`, { method: "DELETE" });
      } else {
        await api("/api/students/bulk-delete", { method: "POST", body: { ids } });
      }
      ids.forEach((id) => {
        selectedStudentIds.delete(id);
        selectedReviewIds.delete(id);
      });
      removeDrafts(ids);
      showToast(`${ids.length}명 삭제됨`);
      await Promise.all([loadStudents(), loadReviewList()]);
    } catch (error) {
      showToast(error.message || "삭제 실패");
    } finally {
      stop();
    }
  }

  async function loadReviewList() {
    const tbody = document.getElementById("reviewTableBody");
    const toolbar = document.getElementById("reviewBulkActions");
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="5">불러오는 중…</td></tr>`;
    if (toolbar) toolbar.hidden = true;
    try {
      const data = await api("/api/students");
      const reviewable = mergeStudentsWithDrafts(data.students).filter(
        (s) => s.status === "done" || s.status === "partial" || Object.keys(s.generated || {}).length
      );
      if (!reviewable.length) {
        tbody.innerHTML = `<tr><td colspan="5" class="admin-muted">아직 작성된 생기부가 없습니다. ④에서 일괄 작성을 실행하세요.</td></tr>`;
        selectedReviewIds.clear();
        updateReviewSelectionUi(0);
        return;
      }
      tbody.innerHTML = reviewable
      .map((s) => {
        const checked = selectedReviewIds.has(s.id) ? "checked" : "";
        return `<tr>
          <td class="sample-select-cell">
            <label class="admin-check admin-check-row" title="선택">
              <input class="review-select admin-check-input" type="checkbox" data-id="${s.id}" ${checked}>
              <span class="admin-check-box" aria-hidden="true"></span>
            </label>
          </td>
          <td>${studentLabel(s)}</td>
          <td>${statusPill(s.status)}</td>
          <td>${inspectBadgeHtml(s.id)}</td>
          <td class="admin-row-actions">
            <button class="admin-btn secondary admin-btn-sm" data-action="review" data-id="${s.id}">열기</button>
            <button class="admin-btn danger admin-btn-sm" type="button" data-action="reset-generated" data-id="${s.id}" data-label="${escapeAttr(studentLabel(s))}">삭제</button>
          </td>
        </tr>`;
      })
      .join("");
      updateReviewSelectionUi(reviewable.length);
    } catch (error) {
      tbody.innerHTML = `<tr><td colspan="5" class="admin-muted">검토 목록을 불러오지 못했습니다. ${escapeHtml(
        error.message || "오류"
      )}</td></tr>`;
    }
  }

  function updateReviewSelectionUi(totalCount = null) {
    const toolbar = document.getElementById("reviewBulkActions");
    const countBadge = document.getElementById("reviewCountBadge");
    const countEl = document.getElementById("reviewSelectedCount");
    const resetSelectedBtn = document.getElementById("resetSelectedReviewBtn");
    const checkedCount = selectedReviewIds.size;
    const total = totalCount ?? document.querySelectorAll(".review-select").length;

    if (countBadge) countBadge.textContent = `${total}명`;
    if (countEl) countEl.textContent = checkedCount ? `${checkedCount}명 선택됨` : "";
    if (resetSelectedBtn) resetSelectedBtn.disabled = checkedCount === 0;
    if (toolbar) toolbar.hidden = total === 0;
  }

  function getSelectedReviewIds() {
    return [...selectedReviewIds];
  }

  async function resetGeneratedByIds(ids, confirmMessage) {
    if (!ids.length) {
      showToast("초기화할 학생을 선택하세요.");
      return;
    }
    if (!confirm(confirmMessage)) return;

    const stop = startBusy("작성본 삭제", "선택한 작성 결과를 지우고 있습니다.", "잠시만 기다려 주세요.", { showModel: false });
    try {
      if (ids.length === 1) {
        await api(`/api/students/${ids[0]}/reset`, { method: "POST" });
      } else {
        await api("/api/students/bulk-reset-generated", { method: "POST", body: { ids } });
      }
      ids.forEach((id) => selectedReviewIds.delete(id));
      removeDrafts(ids);
      showToast(`${ids.length}명 작성본 삭제됨`);
      await Promise.all([loadStudents(), loadReviewList()]);
    } catch (error) {
      showToast(error.message || "삭제 실패");
    } finally {
      stop();
    }
  }

  let pendingImportStudentFile = null;

  async function downloadRegistryFile(path, fallbackName) {
    const token = getToken();
    const response = await fetch(`${API_BASE}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: "include",
    });
    if (!response.ok) {
      const text = await response.text();
      let detail = "다운로드 실패";
      try {
        detail = JSON.parse(text).detail || detail;
      } catch {
        detail = text || detail;
      }
      throw new Error(detail);
    }
    const blob = await response.blob();
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const disposition = response.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename=\"?([^\";]+)/i);
    const filename = match?.[1] || `${fallbackName}_${stamp}`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function downloadStudentsRegistryTsv() {
    await downloadRegistryFile("/api/students/export/registry.tsv", "students.tsv");
  }

  async function downloadStudentsRegistryXlsx() {
    await downloadRegistryFile("/api/students/export/registry.xlsx", "students.xlsx");
  }

  function closeImportStudentsModal() {
    const modal = document.getElementById("importStudentsModal");
    if (modal) modal.hidden = true;
    document.body.classList.remove("admin-guide-open");
    pendingImportStudentFile = null;
  }

  function openImportStudentsModal(preview, file) {
    pendingImportStudentFile = file;
    const modal = document.getElementById("importStudentsModal");
    const summary = document.getElementById("importStudentsSummary");
    const duplicatesBox = document.getElementById("importStudentsDuplicates");
    if (!modal || !summary) return;

    const errorText = (preview.errors || []).length
      ? ` · 오류 ${preview.errors.length}행`
      : "";
    summary.textContent = `총 ${preview.total}행 · 신규 ${preview.new_count}명 · 중복 ${preview.duplicate_count}명${errorText}`;

    if (duplicatesBox) {
      const duplicates = preview.duplicates || [];
      if (duplicates.length) {
        duplicatesBox.hidden = false;
        duplicatesBox.innerHTML = duplicates
          .slice(0, 12)
          .map(
            (item) =>
              `${item.grade}-${item.class_num} ${item.number}번 ${escapeHtml(item.name)}`
          )
          .join("<br>");
        if (duplicates.length > 12) {
          duplicatesBox.innerHTML += `<br>외 ${duplicates.length - 12}명`;
        }
      } else {
        duplicatesBox.hidden = true;
        duplicatesBox.textContent = "";
      }
    }

    const defaultMode = preview.duplicate_count > 0 ? "skip" : "add";
    document
      .querySelectorAll('input[name="importStudentsMode"]')
      .forEach((input) => {
        input.checked = input.value === defaultMode;
      });

    modal.hidden = false;
    document.body.classList.add("admin-guide-open");
    document.getElementById("importStudentsConfirmBtn")?.focus();
  }

  async function confirmImportStudents() {
    if (!pendingImportStudentFile) {
      closeImportStudentsModal();
      return;
    }
    const mode =
      document.querySelector('input[name="importStudentsMode"]:checked')?.value || "skip";
    const form = new FormData();
    form.append("file", pendingImportStudentFile);
    closeImportStudentsModal();
    try {
      const data = await api(`/api/students/import?mode=${encodeURIComponent(mode)}`, {
        method: "POST",
        body: form,
      });
      const errors = data.errors || [];
      const parts = [];
      if (data.imported) parts.push(`신규 ${data.imported}명`);
      if (data.updated) parts.push(`갱신 ${data.updated}명`);
      if (data.skipped) parts.push(`건너뜀 ${data.skipped}명`);
      if (errors.length) {
        showUploadLog("studentsUploadLog", errors);
        showToast(`${parts.join(" · ") || "완료"} · 오류 ${errors.length}행`);
      } else {
        showUploadLog("studentsUploadLog", []);
        showToast(parts.join(" · ") || "가져오기 완료");
      }
      await loadStudents();
      const input = document.getElementById("studentsFile");
      const formEl = document.getElementById("importStudentsForm");
      if (formEl) formEl.reset();
      if (input) input.value = "";
      const nameEl = document.getElementById("studentsFileName");
      if (nameEl) {
        nameEl.textContent = filePickerEmptyLabel("studentsFile");
        nameEl.classList.remove("has-file");
      }
    } catch (error) {
      showToast(error.message);
    }
  }

  async function downloadStudentsExcel() {
    const token = getToken();
    let response;
    try {
      if (privacySettings.store_generated) {
        response = await fetch(`${API_BASE}/api/students/export/xlsx`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          credentials: "include",
        });
      } else {
        const data = await api("/api/students");
        const students = mergeStudentsWithDrafts(data.students)
          .filter((s) => Object.keys(s.generated || {}).length)
          .map((s) => ({
            id: s.id,
            name: s.name,
            grade: s.grade,
            class_num: s.class_num,
            number: s.number,
            status: s.status,
            generated: s.generated,
          }));
        if (!students.length) {
          throw new Error("보낼 작성본이 없습니다. ④에서 작성을 실행하세요.");
        }
        response = await fetch(`${API_BASE}/api/students/export/xlsx`, {
          method: "POST",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({ students }),
        });
      }
    } catch (error) {
      if (error instanceof Error && error.message) throw error;
      throw new Error("API 서버에 연결할 수 없습니다.");
    }
    if (!response.ok) {
      const text = await response.text();
      let detail = "다운로드 실패";
      try {
        detail = JSON.parse(text).detail || detail;
      } catch {
        detail = text || detail;
      }
      throw new Error(detail);
    }
    const blob = await response.blob();
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `saenggibu_${stamp}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function sampleDisplayLabel(s) {
    const label = String(s.label || "").trim();
    if (label && label !== "미명시") return label;
    const src = String(s.source_file || "");
    const file = src.split(/[/\\]/).pop();
    if (file) return `미명시 (${file})`;
    return `미명시 (${s.id})`;
  }

  function updateSampleSelectionUi(totalCount = null) {
    const toolbar = document.getElementById("samplesBulkActions");
    const countBadge = document.getElementById("samplesCountBadge");
    const countEl = document.getElementById("samplesSelectedCount");
    const deleteSelectedBtn = document.getElementById("deleteSelectedSamplesBtn");
    const selectAll = document.getElementById("samplesSelectAll");
    const checkedCount = selectedSampleIds.size;
    const total = totalCount ?? samplesCache.length;

    if (countBadge) countBadge.textContent = `${total}건`;
    if (countEl) {
      countEl.textContent = checkedCount ? `${checkedCount}건 선택됨` : "";
    }
    if (deleteSelectedBtn) {
      deleteSelectedBtn.disabled = checkedCount === 0;
    }
    if (selectAll && total) {
      selectAll.checked = checkedCount > 0 && checkedCount === total;
      selectAll.indeterminate = checkedCount > 0 && checkedCount < total;
    }
    if (toolbar) {
      toolbar.hidden = total === 0;
    }
  }

  function getSelectedSampleIds() {
    return [...selectedSampleIds];
  }

  function renderSamplesPageNav(totalPages) {
    const nav = document.getElementById("samplesPageNav");
    if (!nav) return;
    if (totalPages <= 1) {
      nav.innerHTML = "";
      return;
    }

    const items = [];
    const addPage = (page) => {
      items.push(
        `<button type="button" class="admin-page-btn${page === samplesPage ? " active" : ""}" data-page="${page}">${page}</button>`
      );
    };

    if (totalPages <= 7) {
      for (let page = 1; page <= totalPages; page += 1) addPage(page);
    } else {
      addPage(1);
      if (samplesPage > 3) items.push('<span class="admin-page-ellipsis">…</span>');
      const start = Math.max(2, samplesPage - 1);
      const end = Math.min(totalPages - 1, samplesPage + 1);
      for (let page = start; page <= end; page += 1) addPage(page);
      if (samplesPage < totalPages - 2) items.push('<span class="admin-page-ellipsis">…</span>');
      addPage(totalPages);
    }

    const prevDisabled = samplesPage <= 1 ? " disabled" : "";
    const nextDisabled = samplesPage >= totalPages ? " disabled" : "";
    nav.innerHTML = `
      <button type="button" class="admin-page-btn" data-page="${samplesPage - 1}"${prevDisabled} aria-label="이전 페이지">‹</button>
      ${items.join("")}
      <button type="button" class="admin-page-btn" data-page="${samplesPage + 1}"${nextDisabled} aria-label="다음 페이지">›</button>`;
  }

  function renderSamplesTable() {
    const list = document.getElementById("samplesList");
    const pagination = document.getElementById("samplesPagination");
    if (!list) return;

    const total = samplesCache.length;
    if (!total) {
      list.innerHTML = `<p class="admin-muted">아직 올린 샘플이 없습니다.</p>`;
      if (pagination) pagination.hidden = true;
      updateSampleSelectionUi(0);
      return;
    }

    const totalPages = Math.max(1, Math.ceil(total / samplesPageSize));
    if (samplesPage > totalPages) samplesPage = totalPages;
    const start = (samplesPage - 1) * samplesPageSize;
    const pageItems = samplesCache.slice(start, start + samplesPageSize);

    list.innerHTML = `
      <table class="admin-table admin-sample-table">
        <thead><tr>
          <th class="sample-select-cell" aria-label="선택"></th>
          <th>이름</th>
          <th>ID</th>
          <th></th>
        </tr></thead>
        <tbody>${pageItems
          .map((s) => {
            const label = sampleDisplayLabel(s);
            const checked = selectedSampleIds.has(s.id) ? "checked" : "";
            return `<tr>
              <td class="sample-select-cell">
                <label class="admin-check admin-check-row" title="선택">
                  <input class="sample-select admin-check-input" type="checkbox" data-id="${s.id}" ${checked}>
                  <span class="admin-check-box" aria-hidden="true"></span>
                </label>
              </td>
              <td>${label}</td>
              <td class="admin-muted">${s.id}</td>
              <td><button class="admin-btn danger admin-btn-sm" type="button" data-action="delete-sample" data-id="${s.id}" data-label="${label.replace(/"/g, "&quot;")}">삭제</button></td>
            </tr>`;
          })
          .join("")}</tbody>
      </table>`;

    if (pagination) pagination.hidden = false;
    renderSamplesPageNav(totalPages);
    updateSampleSelectionUi(total);
  }

  async function deleteSamplesByIds(ids, confirmMessage) {
    if (!ids.length) {
      showToast("삭제할 샘플을 선택하세요.");
      return;
    }
    if (!confirm(confirmMessage)) return;

    const stop = startBusy("샘플 삭제", "선택한 항목을 정리하고 있습니다.", "잠시만 기다려 주세요.", { showModel: false });
    try {
      if (ids.length === 1) {
        await api(`/api/samples/${ids[0]}`, { method: "DELETE" });
      } else {
        await api("/api/samples/bulk-delete", { method: "POST", body: { ids } });
      }
      ids.forEach((id) => selectedSampleIds.delete(id));
      showToast(`${ids.length}건 삭제됨`);
      await loadSamples();
    } catch (error) {
      showToast(error.message || "삭제 실패");
    } finally {
      stop();
    }
  }

  async function loadSamples() {
    const list = document.getElementById("samplesList");
    const toolbar = document.getElementById("samplesBulkActions");
    if (!list) return;
    list.textContent = "불러오는 중…";
    if (toolbar) toolbar.hidden = true;
    try {
      const data = await api("/api/samples");
      samplesCache = data.samples || [];
      if (!samplesCache.length) {
        selectedSampleIds.clear();
        renderSamplesTable();
        return;
      }
      samplesPage = 1;
      renderSamplesTable();
    } catch (error) {
      samplesCache = [];
      list.innerHTML = `<p class="admin-muted">샘플 목록을 불러오지 못했습니다.<br>${escapeHtml(
        error.message || "오류"
      )}</p>
        <button type="button" class="admin-btn secondary admin-btn-sm" data-action="retry-samples">다시 시도</button>`;
      list.querySelector("[data-action='retry-samples']")?.addEventListener("click", () => loadSamples());
      const pagination = document.getElementById("samplesPagination");
      if (pagination) pagination.hidden = true;
    }
  }

  document.getElementById("samplesList")?.addEventListener("change", (event) => {
    const box = event.target.closest(".sample-select");
    if (!box) return;
    if (box.checked) selectedSampleIds.add(box.dataset.id);
    else selectedSampleIds.delete(box.dataset.id);
    updateSampleSelectionUi();
  });

  document.getElementById("samplesSelectAll")?.addEventListener("change", (event) => {
    const checked = event.target.checked;
    if (checked) {
      samplesCache.forEach((sample) => selectedSampleIds.add(sample.id));
    } else {
      samplesCache.forEach((sample) => selectedSampleIds.delete(sample.id));
    }
    renderSamplesTable();
  });

  document.getElementById("samplesPageSize")?.addEventListener("change", (event) => {
    samplesPageSize = Number(event.target.value) || 10;
    samplesPage = 1;
    renderSamplesTable();
  });

  document.getElementById("samplesPageNav")?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-page]");
    if (!btn || btn.disabled) return;
    const page = Number(btn.dataset.page);
    if (!page || page === samplesPage) return;
    samplesPage = page;
    renderSamplesTable();
  });

  document.getElementById("deleteSelectedSamplesBtn")?.addEventListener("click", async () => {
    const ids = getSelectedSampleIds();
    await deleteSamplesByIds(ids, `선택한 ${ids.length}건의 샘플을 삭제할까요?`);
  });

  document.getElementById("deleteAllSamplesBtn")?.addEventListener("click", async () => {
    const data = await api("/api/samples");
    const count = data.count || 0;
    if (!count) {
      showToast("삭제할 샘플이 없습니다.");
      return;
    }
    if (!confirm(`올린 샘플 ${count}건을 전부 삭제할까요?\n이 작업은 되돌릴 수 없습니다.`)) return;

    const stop = startBusy("샘플 전체 삭제", "모든 샘플을 정리하고 있습니다.", "되돌릴 수 없습니다. 잠시만 기다려 주세요.", {
      showModel: false,
    });
    try {
      const result = await api("/api/samples", { method: "DELETE" });
      selectedSampleIds.clear();
      showToast(`${result.count || count}건 전체 삭제됨`);
      await loadSamples();
    } catch (error) {
      showToast(error.message || "전체 삭제 실패");
    } finally {
      stop();
    }
  });

  document.getElementById("adminApp")?.addEventListener("click", async (event) => {
    const btn = event.target.closest("button[data-action='delete-sample']");
    if (!btn) return;
    const id = btn.dataset.id;
    const label = btn.dataset.label || id;
    await deleteSamplesByIds([id], `「${label}」\n이 샘플을 삭제할까요?`);
  });

  async function loadStyleGuide() {
    const editor = document.getElementById("styleGuideEditor");
    if (!editor) return;
    try {
      const data = await api("/api/patterns");
      editor.value = data.style_guide || "";
    } catch {
      editor.placeholder = "①에서 샘플을 올리고 분석을 실행한 뒤 여기서 확인·수정할 수 있습니다.";
    }
  }

  function buildDetailEditor(generated) {
    const editor = document.getElementById("detailEditor");
    if (!editor) return;
    const parts = [];

    if (generated.행발) {
      parts.push(`
        <div class="admin-field inspect-field" data-field-key="행발">
          <div class="admin-field-head">
            <label>행동특성 및 종합의견</label>
            <span class="inspect-char-count" data-for="행발">공백 제외 0자, 공백 포함 0자, 0바이트</span>
          </div>
          <textarea class="admin-textarea detail-field" data-key="행발" rows="10">${escapeHtml(generated.행발)}</textarea>
          <ul class="inspect-field-issues" data-for="행발"></ul>
        </div>`);
    }

    const setuk = generated.세특 || {};
    for (const [subject, text] of Object.entries(setuk)) {
      const key = `세특:${subject}`;
      parts.push(`
        <div class="admin-field inspect-field" data-field-key="${escapeAttr(key)}">
          <div class="admin-field-head">
            <label>세특 · ${escapeHtml(subject)}</label>
            <span class="inspect-char-count" data-for="${escapeAttr(key)}">공백 제외 0자, 공백 포함 0자, 0바이트</span>
          </div>
          <textarea class="admin-textarea detail-field" data-key="${escapeAttr(key)}" rows="10">${escapeHtml(text)}</textarea>
          <ul class="inspect-field-issues" data-for="${escapeAttr(key)}"></ul>
        </div>`);
    }

    const changche = generated.창체 || {};
    for (const [keyName, text] of Object.entries(changche)) {
      const key = `창체:${keyName}`;
      parts.push(`
        <div class="admin-field inspect-field" data-field-key="${escapeAttr(key)}">
          <div class="admin-field-head">
            <label>창체 · ${escapeHtml(keyName)}</label>
            <span class="inspect-char-count" data-for="${escapeAttr(key)}">공백 제외 0자, 공백 포함 0자, 0바이트</span>
          </div>
          <textarea class="admin-textarea detail-field" data-key="${escapeAttr(key)}" rows="10">${escapeHtml(text)}</textarea>
          <ul class="inspect-field-issues" data-for="${escapeAttr(key)}"></ul>
        </div>`);
    }

    if (!parts.length) {
      editor.innerHTML = `<p class="admin-muted">아직 생성된 본문이 없습니다.</p>`;
      return;
    }
    editor.innerHTML = parts.join("");
    editor.dataset.fieldActionsBound = "0";
    bindDetailEditorInspectEvents();
    updateDetailCharCounts(currentInspectReport);
    renderFieldIssues(currentInspectReport);
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(text) {
    return String(text).replace(/"/g, "&quot;");
  }

  function collectGeneratedFromEditor() {
    const generated = {};
    document.querySelectorAll("#detailEditor .detail-field").forEach((el) => {
      const key = el.dataset.key;
      const value = el.value;
      if (key === "행발") {
        generated.행발 = value;
        return;
      }
      if (key.startsWith("세특:")) {
        generated.세특 = generated.세특 || {};
        generated.세특[sectionSubjectFromKey(key)] = value;
        return;
      }
      if (key.startsWith("창체:")) {
        generated.창체 = generated.창체 || {};
        generated.창체[sectionSubjectFromKey(key)] = value;
      }
    });
    return generated;
  }

  function allDetailText() {
    return [...document.querySelectorAll("#detailEditor .detail-field")]
      .map((el) => {
        const label = el.closest(".admin-field")?.querySelector("label")?.textContent || "";
        return `【${label}】\n${el.value}`;
      })
      .join("\n\n");
  }

  async function showStudent(id, fromTab = "review") {
    currentStudentId = id;
    lastTabBeforeDetail = fromTab;
    const student = mergeStudentWithDraft(await api(`/api/students/${id}`));
    currentStudentData = student;
    switchTab("detail");
    document.getElementById("detailTitle").textContent = studentLabel(student);
    const privacyNote = privacySettings.store_generated
      ? ""
      : ' <span class="admin-muted">· 작성본은 이 브라우저에만 저장됩니다</span>';
    buildDetailEditor(student.generated || {});
    const detailTips = document.getElementById("detailWritingTips");
    if (detailTips) {
      detailTips.hidden = false;
      await loadWritingTipsPanel("common", detailTips);
    }
    try {
      currentInspectReport = await inspectCurrentStudent();
      document.getElementById("detailMeta").innerHTML = `상태: ${statusPill(student.status)}${privacyNote} ${inspectBadgeHtml(
        id,
        currentInspectReport
      )}`;
      renderInspectSummary(currentInspectReport);
      renderFieldIssues(currentInspectReport);
      updateDetailCharCounts(currentInspectReport);
    } catch {
      currentInspectReport = null;
      document.getElementById("detailMeta").innerHTML = `상태: ${statusPill(student.status)}${privacyNote}`;
      renderInspectSummary(null);
    }
  }

  loginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    loginError.textContent = "";
    const password = document.getElementById("adminPassword").value;
    const submitBtn = loginForm.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    try {
      const data = await api("/api/auth/login", { method: "POST", body: { password }, rawError: true });
      if (!data?.token) {
        throw new Error("로그인 응답이 올바르지 않습니다. API 서버를 재빌드해 주세요.");
      }
      setToken(data.token);
      await api("/api/auth/me", { rawError: true });
      showApp();
      await refreshAll();
    } catch (error) {
      setToken("");
      showGate();
      if (error?.status === 401) {
        loginError.textContent = "비밀번호가 올바르지 않습니다.";
      } else if (error?.status === 503) {
        loginError.textContent = error.message || "서버 설정이 완료되지 않았습니다.";
      } else {
        loginError.textContent = error.message || "로그인에 실패했습니다.";
      }
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  logoutBtn?.addEventListener("click", async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    setToken("");
    showGate();
  });

  document.querySelectorAll(".admin-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      if (tab !== "detail") switchTab(tab);
      if (tab === "learn" || tab === "samples") loadSamples();
    });
  });

  document.getElementById("studentsTableBody")?.addEventListener("click", async (event) => {
    const target = event.target.closest("button[data-action]");
    if (!target) return;
    const id = target.dataset.id;
    if (target.dataset.action === "review") {
      await showStudent(id, "students");
      return;
    }
    if (target.dataset.action === "edit-memo") {
      try {
        await openMemoEditModal(id);
      } catch (error) {
        showToast(error.message);
      }
      return;
    }
    if (target.dataset.action === "run-one") {
      const studentName = target.closest("tr")?.children[1]?.textContent?.trim() || "학생";
      let section;
      try {
        section = getSelectedWriteSection();
      } catch (error) {
        showToast(error.message);
        switchTab("review");
        return;
      }
      const sectionLabel = WRITE_SECTION_LABELS[section] || section;
      const runTitle = section === "전체" ? "전체 항목 작성" : `${section} 작성`;
      try {
        const data = await withAsyncRun(
          runTitle,
          `${studentName} · ${sectionLabel}`,
          "진행 상황을 표시합니다. 창을 닫지 마세요.",
          buildRunPayload({ studentId: id })
        );
        showToast(data.partialErrors ? `작성 실패: ${data.partialErrors}` : "작성 완료");
        await Promise.all([loadStudents(), loadReviewList(), loadUsage()]);
      } catch (error) {
        showToast(error.message);
      }
      return;
    }
    if (target.dataset.action === "delete-student") {
      const label = target.dataset.label || id;
      await deleteStudentsByIds([id], `「${label}」\n이 학생을 삭제할까요?\n메모·작성 결과가 모두 지워집니다.`);
    }
  });

  document.getElementById("studentsTableBody")?.addEventListener("change", (event) => {
    const box = event.target.closest(".student-select");
    if (!box) return;
    if (box.checked) selectedStudentIds.add(box.dataset.id);
    else selectedStudentIds.delete(box.dataset.id);
    updateStudentSelectionUi();
  });

  document.getElementById("studentsSelectAll")?.addEventListener("change", (event) => {
    const checked = event.target.checked;
    document.querySelectorAll(".student-select").forEach((box) => {
      box.checked = checked;
      if (checked) selectedStudentIds.add(box.dataset.id);
      else selectedStudentIds.delete(box.dataset.id);
    });
    updateStudentSelectionUi();
  });

  document.getElementById("deleteSelectedStudentsBtn")?.addEventListener("click", async () => {
    const ids = getSelectedStudentIds();
    await deleteStudentsByIds(ids, `선택한 ${ids.length}명의 학생을 삭제할까요?\n메모·작성 결과가 모두 지워집니다.`);
  });

  document.getElementById("deleteAllStudentsBtn")?.addEventListener("click", async () => {
    const data = await api("/api/students");
    const count = data.count || 0;
    if (!count) {
      showToast("삭제할 학생이 없습니다.");
      return;
    }
    if (!confirm(`등록된 학생 ${count}명을 전부 삭제할까요?\n이 작업은 되돌릴 수 없습니다.`)) return;

    const stop = startBusy("학생 전체 초기화", "모든 학생 데이터를 지우고 있습니다.", "되돌릴 수 없습니다. 잠시만 기다려 주세요.", {
      showModel: false,
    });
    try {
      const result = await api("/api/students", { method: "DELETE" });
      selectedStudentIds.clear();
      selectedReviewIds.clear();
      clearAllDrafts();
      showToast(`${result.count || count}명 전체 삭제됨`);
      await Promise.all([loadStudents(), loadReviewList()]);
    } catch (error) {
      showToast(error.message || "전체 삭제 실패");
    } finally {
      stop();
    }
  });

  document.getElementById("reviewTableBody")?.addEventListener("click", async (event) => {
    const target = event.target.closest("button[data-action]");
    if (!target) return;
    const id = target.dataset.id;
    if (target.dataset.action === "review") {
      await showStudent(id, "review");
      return;
    }
    if (target.dataset.action === "reset-generated") {
      const label = target.dataset.label || id;
      await resetGeneratedByIds([id], `「${label}」\n작성된 생기부만 삭제할까요?\n학생 메모는 유지됩니다.`);
    }
  });

  document.getElementById("reviewTableBody")?.addEventListener("change", (event) => {
    const box = event.target.closest(".review-select");
    if (!box) return;
    if (box.checked) selectedReviewIds.add(box.dataset.id);
    else selectedReviewIds.delete(box.dataset.id);
    updateReviewSelectionUi();
  });

  document.getElementById("resetSelectedReviewBtn")?.addEventListener("click", async () => {
    const ids = getSelectedReviewIds();
    await resetGeneratedByIds(ids, `선택한 ${ids.length}명의 작성본을 삭제할까요?\n학생 메모는 유지됩니다.`);
  });

  document.getElementById("inspectAllReviewBtn")?.addEventListener("click", async () => {
    const ids = getSelectedReviewIds();
    await runInspectBatch(ids.length ? ids : null);
  });

  document.getElementById("resetAllReviewBtn")?.addEventListener("click", async () => {
    const data = await api("/api/students");
    const count = mergeStudentsWithDrafts(data.students).filter((s) => Object.keys(s.generated || {}).length).length;
    if (!count) {
      showToast("삭제할 작성본이 없습니다.");
      return;
    }
    if (!confirm(`작성된 생기부 ${count}건을 전부 삭제할까요?\n학생 메모는 유지됩니다.`)) return;

    const stop = startBusy("작성본 전체 초기화", "모든 작성 결과를 지우고 있습니다.", "잠시만 기다려 주세요.", {
      showModel: false,
    });
    try {
      const result = await api("/api/students/generated/all", { method: "DELETE" });
      selectedReviewIds.clear();
      clearAllDrafts();
      showToast(`${result.count || count}건 작성본 삭제됨`);
      await Promise.all([loadStudents(), loadReviewList()]);
    } catch (error) {
      showToast(error.message || "전체 초기화 실패");
    } finally {
      stop();
    }
  });

  document.getElementById("exportReviewExcelBtn")?.addEventListener("click", async () => {
    try {
      await downloadStudentsExcel();
      showToast("엑셀 파일을 저장했습니다.");
    } catch (error) {
      showToast(error.message);
    }
  });

  document.getElementById("backToReview")?.addEventListener("click", () => switchTab(lastTabBeforeDetail));

  document.getElementById("saveDetailBtn")?.addEventListener("click", async () => {
    if (!currentStudentId) return;
    try {
      const generated = collectGeneratedFromEditor();
      const updated = await api(`/api/students/${currentStudentId}`, {
        method: "PATCH",
        body: { generated },
      });
      if (!privacySettings.store_generated) {
        setDraft(currentStudentId, generated, updated.status);
        currentStudentData = mergeStudentWithDraft(updated);
      } else {
        currentStudentData = updated;
      }
      showToast(privacySettings.store_generated ? "저장됨" : "이 브라우저에 저장됨");
      try {
        currentInspectReport = await inspectCurrentStudent();
        const privacyNote = privacySettings.store_generated
          ? ""
          : ' <span class="admin-muted">· 작성본은 이 브라우저에만 저장됩니다</span>';
        document.getElementById("detailMeta").innerHTML = `상태: ${statusPill(currentStudentData.status)}${privacyNote} ${inspectBadgeHtml(
          currentStudentId,
          currentInspectReport
        )}`;
        renderInspectSummary(currentInspectReport);
        renderFieldIssues(currentInspectReport);
        updateDetailCharCounts(currentInspectReport);
        await loadReviewList();
      } catch {
        /* inspect optional after save */
      }
    } catch (error) {
      showToast(error.message);
    }
  });

  document.getElementById("inspectDetailBtn")?.addEventListener("click", async () => {
    if (!currentStudentId) return;
    const stop = startBusy("생기부 검사", "수정한 본문을 점검합니다.", "항목별로 순차 검사합니다.", {
      showModel: false,
      showInspectChecklist: true,
    });
    startInspectBusyAnimation();
    try {
      currentInspectReport = await inspectCurrentStudent();
      document.getElementById("detailMeta").innerHTML = `상태: ${statusPill(currentStudentData?.status || "pending")} ${inspectBadgeHtml(
        currentStudentId,
        currentInspectReport
      )}`;
      renderInspectSummary(currentInspectReport);
      renderFieldIssues(currentInspectReport);
      updateDetailCharCounts(currentInspectReport);
      await loadReviewList();
      showToast("검사 완료");
    } catch (error) {
      showToast(error.message || "검사 실패");
    } finally {
      stopInspectBusyAnimation();
      stop();
    }
  });

  document.getElementById("copyDetailBtn")?.addEventListener("click", async () => {
    const text = allDetailText();
    if (!text) {
      showToast("복사할 내용이 없습니다.");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast("클립보드에 복사됨");
    } catch {
      showToast("복사에 실패했습니다.");
    }
  });

  document.getElementById("editMemoFromDetailBtn")?.addEventListener("click", async () => {
    if (!currentStudentId) return;
    try {
      await openMemoEditModal(currentStudentId);
    } catch (error) {
      showToast(error.message);
    }
  });

  document.getElementById("memoEditCancelBtn")?.addEventListener("click", closeMemoEditModal);
  document.getElementById("memoEditModal")?.addEventListener("click", (event) => {
    if (event.target.id === "memoEditModal") closeMemoEditModal();
  });
  document.getElementById("memoEditSaveBtn")?.addEventListener("click", async () => {
    try {
      await saveMemoEdit();
    } catch (error) {
      showToast(error.message);
    }
  });
  document.getElementById("saveStyleBtn")?.addEventListener("click", async () => {
    const style_guide = document.getElementById("styleGuideEditor").value;
    try {
      await api("/api/patterns/style-guide", { method: "PUT", body: { style_guide } });
      showToast("스타일 저장됨");
    } catch (error) {
      showToast(error.message);
    }
  });

  function collectSetukSubjectPayload() {
    const subject = document.getElementById("simpleSubject")?.value.trim() || "";
    const career = document.getElementById("simpleSetukCareer")?.value.trim() || "";
    const assessmentType = document.getElementById("simpleSetukAssessment")?.value.trim() || "";
    const topic = document.getElementById("simpleSetukTopic")?.value.trim() || "";
    const content = document.getElementById("simpleSetukContent")?.value.trim() || "";
    if (!subject) return { error: "세특을 선택했다면 과목명을 입력하세요." };
    if (content && content.length < 20) {
      showToast("활동 내용은 20자 이상 권장합니다. 짧아도 등록은 가능합니다.");
    }
    return {
      subjects: {
        [subject]: {
          career,
          assessment_type: assessmentType,
          topic,
          content,
          activities: content ? [content] : [],
          notes: content,
        },
      },
    };
  }

  document.getElementById("simpleStudentForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const writeTargets = getSelectedWriteTargets();
    if (!writeTargets.length) {
      showToast("작성할 항목을 하나 이상 선택하세요.");
      return;
    }

    const subjects = {};
    if (writeTargets.includes("세특")) {
      const setuk = collectSetukSubjectPayload();
      if (setuk.error) {
        showToast(setuk.error);
        return;
      }
      Object.assign(subjects, setuk.subjects);
    }

    const changche = {};
    if (writeTargets.includes("자율")) {
      changche.자율 = document.getElementById("simpleJayul").value.trim();
    }
    if (writeTargets.includes("동아리")) {
      changche.동아리 = document.getElementById("simpleDongari").value.trim();
    }
    if (writeTargets.includes("진로")) {
      changche.진로 = document.getElementById("simpleJillo").value.trim();
    }

    try {
      await api("/api/students", {
        method: "POST",
        body: {
          name: document.getElementById("simpleName").value.trim(),
          grade: Number(document.getElementById("simpleGrade").value),
          class_num: Number(document.getElementById("simpleClass").value),
          number: Number(document.getElementById("simpleNumber").value),
          haengbal_notes: writeTargets.includes("행발")
            ? document.getElementById("simpleHaengbal").value.trim()
            : "",
          subjects,
          changche,
          write_targets: writeTargets,
        },
      });
      showToast("학생 추가됨");
      event.target.reset();
      resetStudentFormDefaults();
      await loadStudents();
    } catch (error) {
      showToast(error.message);
    }
  });

  async function aiParse(save) {
    const fileInput = document.getElementById("aiStudentFile");
    const text = document.getElementById("aiStudentInput").value.trim();
    const previewEl = document.getElementById("aiParsePreview");

    if (fileInput?.files?.length) {
      const file = fileInput.files[0];
      const form = new FormData();
      form.append("file", file);
      const path = save ? "/api/students/parse-file?save=true" : "/api/students/parse-file";
      const data = await api(path, { method: "POST", body: form });
      if (save) return data;
      previewEl.hidden = false;
      previewEl.textContent = JSON.stringify(data.preview, null, 2);
      return data.preview;
    }

    if (!text) throw new Error("메모를 입력하거나 파일을 선택하세요.");
    const path = save ? "/api/students/parse-save" : "/api/students/parse";
    const data = await api(path, { method: "POST", body: { text } });
    if (save) return data;
    previewEl.hidden = false;
    previewEl.textContent = JSON.stringify(data.preview, null, 2);
    return data.preview;
  }

  document.getElementById("aiParsePreviewBtn")?.addEventListener("click", async () => {
    try {
      await withBusy(
        "AI 학생 정보 정리",
        "메모·파일을 읽고 구조화하고 있습니다.",
        "완료될 때까지 창을 닫지 마세요.",
        () => aiParse(false)
      );
      showToast("미리보기 완료");
    } catch (error) {
      showToast(error.message);
    }
  });

  document.getElementById("aiParseSaveBtn")?.addEventListener("click", async () => {
    try {
      await withBusy(
        "AI 학생 등록",
        "학생 정보를 저장하고 있습니다.",
        "완료될 때까지 창을 닫지 마세요.",
        () => aiParse(true)
      );
      showToast("학생 추가됨");
      document.getElementById("aiStudentInput").value = "";
      const fileInput = document.getElementById("aiStudentFile");
      if (fileInput) fileInput.value = "";
      const nameEl = document.getElementById("aiStudentFileName");
      if (nameEl) {
        nameEl.textContent = "선택된 파일 없음";
        nameEl.classList.remove("has-file");
      }
      document.getElementById("aiParsePreview").hidden = true;
      await loadStudents();
    } catch (error) {
      showToast(error.message);
    }
  });

  document.getElementById("exportStudentsTsvBtn")?.addEventListener("click", async () => {
    try {
      await downloadStudentsRegistryTsv();
      showToast("학생 목록 TSV를 받았습니다.");
    } catch (error) {
      showToast(error.message);
    }
  });

  document.getElementById("exportStudentsRegistryXlsxBtn")?.addEventListener("click", async () => {
    try {
      await downloadStudentsRegistryXlsx();
      showToast("학생 목록 엑셀을 받았습니다.");
    } catch (error) {
      showToast(error.message);
    }
  });

  document.getElementById("importStudentsForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = document.getElementById("studentsFile");
    const file = input?.files?.[0];
    if (!file) {
      showToast("파일을 선택하세요.");
      return;
    }
    const check = validateFiles([file], "studentsFile");
    if (!check.ok) {
      showToast(`지원하지 않는 형식: ${formatRejectedNames(check.rejected)}`);
      return;
    }
    const form = new FormData();
    form.append("file", file);
    try {
      const preview = await api("/api/students/import/preview", { method: "POST", body: form });
      if ((preview.errors || []).length && !preview.valid_count) {
        showUploadLog("studentsUploadLog", preview.errors);
        showToast("가져올 수 있는 행이 없습니다.");
        return;
      }
      openImportStudentsModal(preview, file);
    } catch (error) {
      showToast(error.message);
    }
  });

  document.getElementById("importStudentsConfirmBtn")?.addEventListener("click", confirmImportStudents);
  document.getElementById("importStudentsCancelBtn")?.addEventListener("click", closeImportStudentsModal);
  document.getElementById("importStudentsCloseBtn")?.addEventListener("click", closeImportStudentsModal);
  document.getElementById("importStudentsModal")?.addEventListener("click", (event) => {
    if (event.target.id === "importStudentsModal") closeImportStudentsModal();
  });

  document.getElementById("importSamplesForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = document.getElementById("samplesFile");
    const files = [...(input.files || [])];
    if (!files.length) {
      showToast("파일을 선택하세요.");
      return;
    }
    const check = validateFiles(files, "samplesFile");
    if (!check.ok) {
      showToast(`지원하지 않는 형식: ${formatRejectedNames(check.rejected)}`);
      return;
    }
    showToast(`${files.length}개 파일 업로드 중…`);
    let imported = 0;
    const errors = [];
    for (const file of files) {
      const form = new FormData();
      form.append("file", file);
      try {
        const data = await api("/api/samples/import", { method: "POST", body: form });
        imported += data.imported || 0;
      } catch (error) {
        errors.push(`${file.name}: ${error.message}`);
      }
    }
    if (errors.length) {
      showUploadLog("samplesUploadLog", errors);
      showToast(`샘플 ${imported}건 · 실패 ${errors.length}건`);
    } else {
      showUploadLog("samplesUploadLog", []);
      showToast(`샘플 ${imported}건 등록됨`);
    }
    await loadSamples();
    event.target.reset();
    const nameEl = document.getElementById("samplesFileName");
    if (nameEl) {
      nameEl.textContent = filePickerEmptyLabel("samplesFile");
      nameEl.classList.remove("has-file");
    }
  });

  document.getElementById("analyzeBtn")?.addEventListener("click", async () => {
    try {
      await withBusy(
        "문체·분량 분석",
        "샘플 문체·분량을 분석하고 있습니다.",
        "샘플 수에 따라 1~3분 걸릴 수 있습니다.",
        () => api("/api/analyze?use_gemini=true", { method: "POST" })
      );
      showToast("분석 완료 · ② 스타일 설정에서 확인하세요");
      await loadStyleGuide();
    } catch (error) {
      showToast(error.message);
    }
  });

  document.getElementById("runBatchBtn")?.addEventListener("click", async () => {
    let section;
    try {
      section = getSelectedWriteSection();
    } catch (error) {
      showToast(error.message);
      return;
    }
    const sectionLabel = WRITE_SECTION_LABELS[section] || section;
    const runTitle = "AI 일괄 작성";
    try {
      const data = await withAsyncRun(
        runTitle,
        `${sectionLabel} · 미작성 전원`,
        "진행 상황을 표시합니다. 창을 닫지 마세요.",
        buildRunPayload()
      );
      const errCount = (data.errors || []).length;
      const msg = data.partialErrors
        ? `일부 실패: ${data.partialErrors}`
        : data.message || `완료 ${data.processed || 0}명${errCount ? `, 오류 ${errCount}건` : ""}`;
      showToast(msg);
      await Promise.all([loadStudents(), loadReviewList(), loadUsage()]);
    } catch (error) {
      showToast(error.message);
    }
  });

  async function refreshAll() {
    await loadSystemInfo().catch(() => null);
    const results = await Promise.allSettled([
      loadStudents(),
      loadSamples(),
      loadReviewList(),
      loadStyleGuide(),
      loadUsage(),
    ]);
    const failed = results.filter((result) => result.status === "rejected");
    if (failed.length) {
      const reason = failed[0].reason;
      const message = reason?.message || "";
      if (message && message !== "Internal Server Error") {
        showToast(message);
      } else if (failed.length) {
        showToast(`일부 데이터를 불러오지 못했습니다 (${failed.length}건)`);
      }
    }
    await initWritingTips();
    switchTab("learn");
  }

  document.querySelector(".admin-grade-pick")?.addEventListener("click", (event) => {
    const btn = event.target.closest(".admin-grade-btn");
    if (!btn) return;
    setStudentGrade(btn.dataset.grade);
  });

  document.getElementById("privacyBtn")?.addEventListener("click", openPrivacyModal);
  document.getElementById("privacyCloseBtn")?.addEventListener("click", closePrivacyModal);
  document.getElementById("privacyModal")?.addEventListener("click", (event) => {
    if (event.target.id === "privacyModal") closePrivacyModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Backspace" && !isEditableTarget(event.target)) {
      event.preventDefault();
    }
    if (event.key === "Escape") {
      if (!document.getElementById("privacyModal")?.hidden) closePrivacyModal();
      if (!document.getElementById("importStudentsModal")?.hidden) closeImportStudentsModal();
    }
  });

  document.getElementById("studentWriteTargets")?.addEventListener("change", (event) => {
    if (event.target.classList.contains("write-target")) {
      const selected = getSelectedWriteTargets();
      if (!selected.length) {
        event.target.checked = true;
        showToast("최소 한 항목은 선택해야 합니다.");
        return;
      }
      updateStudentMemoPanels();
    }
  });

  async function bootstrap() {
    initDevOnlyUi();
    setupFilePickers();
    initStudentFormControls();
    restoreWriteSectionChoice();
    document.getElementById("writeSectionChoices")?.addEventListener("change", updateWriteSectionUi);
    updateWriteSectionUi();
    updateStudentMemoPanels();
    bindCurriculumInputs();
    const expectedPanels = ["panelLearn", "panelStyle", "panelStudents", "panelReview"];
    const missing = expectedPanels.filter((id) => !document.getElementById(id));
    if (missing.length) {
      showToast("관리자 UI가 오래됐습니다. NAS 배포(main push 또는 NAS-배포.bat) 후 브라우저 캐시를 초기화하고 새로고침하세요.");
    }
    try {
      await api("/api/auth/me", { rawError: true });
      showApp();
      await refreshAll();
    } catch (error) {
      setToken("");
      showGate();
      if (error?.status && error.status !== 401 && loginError) {
        loginError.textContent =
          error.status === 503
            ? error.message || "서버 점검 중이거나 설정이 완료되지 않았습니다."
            : "세션을 확인하지 못했습니다. 다시 로그인해 주세요.";
      }
    }
  }

  bootstrap();
})();
