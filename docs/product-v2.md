# 생기부 작성 머신 v2 — 제품 방향

교사가 TSV·엑셀 형식을 몰라도 쓸 수 있는 **4단계 흐름**을 기준으로 재설계했습니다.

## 사용자 흐름

```
① 스타일 학습  →  ② 스타일 설정  →  ③ 학생 등록  →  ④ 작성·검토
```

| 단계 | 교사가 하는 일 | 시스템이 하는 일 |
|------|----------------|------------------|
| ① 스타일 학습 | 예전 생기부 파일 업로드 (xlsx, docx, tsv 등) | 샘플 저장 → 문체·분량 분석 → 스타일 가이드 생성 |
| ② 스타일 설정 | 스타일 가이드 확인·수정 | 수정본을 다음 작성 프롬프트에 반영 |
| ③ 학생 등록 | 자연어 메모 붙여넣기 / 활동지 파일 / 간단 양식 | AI가 학생 DB(JSON)로 구조화 |
| ④ 작성·검토 | 일괄 작성 실행 → 결과 열어 수정·복사 | Gemini로 행발·세특·창체 생성 |

TSV 업로드는 **고급** 메뉴로만 남겨 두었습니다. 기본 경로는 자연어·파일·간단 양식입니다.

## 학생 데이터 DB화

교사가 직접 DB를 만들 필요 없습니다.

1. **자연어 입력** — 활동지·수행평가·메모를 그대로 붙여넣기
2. **파일 업로드** — txt, docx, tsv 등 → AI 파싱 (`POST /api/students/parse-file`)
3. **간단 양식** — 이름·학년·반·번호·행발·과목·활동 메모만 입력

파싱 결과는 `StudentInput` JSON으로 저장되며, 이후 일괄 작성에 사용됩니다.

## 요금제 (스캐폴드)

| 플랜 | 환경 변수 | 한도 |
|------|-----------|------|
| 무료 | `SGB_PLAN=free` (기본) | 월 `SGB_FREE_GENERATIONS`건 (기본 10) |
| Pro | `SGB_PLAN=pro` 또는 `paid` | 무제한 |

- `GET /api/usage` — 남은 횟수 확인
- 작성 시 `check_generation_allowed()` → 성공 후 `record_generation()`
- **결제 연동(Stripe 등)은 아직 없음** — Vercel 환경변수 `SGB_PLAN`으로 수동 전환

## API 요약 (v2)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/api/students/parse` | 자연어 → 미리보기 |
| POST | `/api/students/parse-save` | 자연어 → 등록 |
| POST | `/api/students/parse-file` | 파일 → 미리보기/등록 (`?save=true`) |
| POST | `/api/students` | 간단 양식 등록 |
| GET | `/api/patterns` | 스타일 가이드 조회 |
| PUT | `/api/patterns/style-guide` | 스타일 가이드 수정 |
| PATCH | `/api/students/{id}` | 작성본 수정 저장 |
| GET | `/api/usage` | 무료 한도 |

## 배포 후 확인

main push → Vercel 자동 배포 후 관리자 UI: `https://sgb.mansejin.com/admin/saenggibu`

## 이후 과제

- 교사별 계정·Stripe 구독
- NEIS 붙여넣기용보내기
- xlsx 활동지 AI 파싱 확장
