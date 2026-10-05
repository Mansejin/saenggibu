# 생기부 작성 머신 (sgb)

과거에 작성한 생기부 샘플을 넣어 **문체·분량 패턴**을 학습하고, 학생별 활동 데이터를 구조화한 뒤 **Gemini 3.1 Pro**로 자동 작성합니다.

**관리자 웹(권장)**: `mansejin.com/admin/saenggibu/` — 비밀번호 로그인 후 사용  
**CLI**: 서버/로컬에서 `sgb.py` 직접 실행

## 관리자 웹 (mansejin.com)

공개 메뉴·도구함(`data/tools.json`)에는 **노출되지 않습니다**. URL을 아는 관리자만 접근합니다.

### 1. API 서버 실행 (saenggibu)

```bash
pip install -r requirements.txt
cp config.example.env .env
```

`.env` 필수 항목:

```env
GEMINI_API_KEY=...
ADMIN_PASSWORD=강한비밀번호
ADMIN_SESSION_SECRET=랜덤긴문자열
SGB_ALLOWED_ORIGINS=https://mansejin.com,https://www.mansejin.com
```

```bash
python3 server.py
# http://127.0.0.1:8787/admin/saenggibu 에서도 바로 사용 가능
```

프로덕션에서는 Cloud Run·VPS 등에 배포하고 HTTPS URL을 확보하세요.

### 2. mansejin 사이트 연결 (tools-site)

**수동 복사 불필요.** `mansejin.com/admin/saenggibu/` 는 API로 자동 이동합니다.

| 주소 | 역할 |
|------|------|
| https://mansejin.com/admin/saenggibu/ | 리다이렉트 (북마크용) |
| https://sgb.mansejin.com/admin/saenggibu | **실제 관리자 UI** |

Vercel 배포(`web/admin` + API)만 최신이면 됩니다. tools-site는 redirect HTML 한 장만 유지.

자동 sync: `saenggibu` Secrets에 `TOOLS_SITE_PAT` 설정 시 push마다 tools-site 반영.

상세: [`deploy/tools-site-admin/README.md`](../deploy/tools-site-admin/README.md)

- 로그인: `.env`의 `ADMIN_PASSWORD`
- 세션: 브라우저 `sessionStorage` (24시간)
- CORS: `mansejin.com`만 허용 (`.env`에서 변경 가능)

## CLI 빠른 시작

```bash
pip install -r requirements.txt
cp config.example.env .env
# .env 에 GEMINI_API_KEY 설정

python sgb.py init
python sgb.py samples import data/saenggibu/examples/
python sgb.py analyze              # 로컬 통계 분석
python sgb.py analyze --gemini     # Gemini로 스타일 가이드 정제 (API 사용)
python sgb.py students import data/saenggibu/examples/students.example.tsv
python sgb.py students list
python sgb.py run --yes            # pending 학생 전원 자동 작성
```

## 워크플로

```
[과거 생기부 샘플] → samples import → analyze → patterns.json (스타일 가이드)
[학생 활동 데이터] → students import/add → students/*.json
                                              ↓
                                         sgb.py run
                                              ↓
                              generated 필드 + outputs/ 저장
```

## 샘플 데이터 형식

### JSON (1명 분 권장)

`data/saenggibu/examples/sample_a.json` 참고

```json
{
  "label": "2025_2학년_샘플A",
  "grade": 2,
  "sections": {
    "행발": "...",
    "세특": { "국어": "...", "수학": "..." },
    "창체": { "자율": "...", "동아리": "...", "봉사": "...", "진로": "..." }
  }
}
```

### TSV (영역별 여러 행)

| 영역 | 과목 | 소분류 | 내용 |
|------|------|--------|------|
| 행발 | | | ... |
| 세특 | 국어 | | ... |
| 창체 | | 동아리 | ... |

## 학생 데이터 형식 (TSV)

`data/saenggibu/examples/students.example.tsv` 참고

- 기본: `id`, `name`, `grade`, `class_num`, `number`, `gender`
- 행발: `행발_notes`, `행발_keywords` (키워드는 `|` 구분)
- 세특: `세특_국어`, `세특_수학` … (활동 메모, `;`로 여러 항목)
- 창체: `창체_자율`, `창체_동아리`, `창체_봉사`, `창체_진로`

## CLI 명령어

| 명령 | 설명 |
|------|------|
| `sgb.py init` | 데이터 폴더 생성 |
| `sgb.py samples import <경로>` | 과거 생기부 샘플 등록 |
| `sgb.py samples list` | 샘플 목록 |
| `sgb.py analyze [--gemini]` | 패턴 분석·스타일 가이드 저장 |
| `sgb.py patterns` | 저장된 패턴 확인 |
| `sgb.py students import <tsv>` | 학생 일괄 등록 |
| `sgb.py students list [--status pending]` | 학생 목록 |
| `sgb.py students show <id>` | 학생 상세·작성 결과 |
| `sgb.py students reset <id>` | 재작성 대기로 초기화 |
| `sgb.py run [--student id] [-y]` | 자동 작성 실행 |
| `server.py` | 관리자 웹 API 서버 |

## 모델 설정

`.env`의 `GEMINI_MODEL` 기본값: `gemini-3.1-pro-preview`

생기부는 문체·사실성·분량 조절이 중요하므로 Pro 계열을 권장합니다.

## 작성 규칙

`prompts/saenggibu.md` — 행발·세특·창체 공통 원칙 및 금지 사항

## 데이터 저장 위치

- 샘플: `data/saenggibu/samples/`
- 학생: `data/saenggibu/students/` (git 제외)
- 패턴: `data/saenggibu/patterns.json`
- 출력: `data/saenggibu/outputs/<학생id>/`

## 주의

- 입력 메모는 **사실에 근거**해야 합니다. AI는 메모를 바탕으로 문장을 다듬을 뿐, 허위 사실을 만들면 안 됩니다.
- 작성 결과는 반드시 교사가 검토·수정한 뒤 제출하세요.
