# mansejin.com에서 생기부 관리자 쓰기

관리자 화면과 API는 모두 Vercel의 `sgb.mansejin.com`이 제공합니다. `mansejin.com/admin/saenggibu/`(tools-site, GitHub Pages)는 그 주소로 넘겨 주는 redirect 페이지 한 장입니다.

| 주소 | 역할 |
|------|------|
| https://mansejin.com/admin/saenggibu/ | 공유용 주소 → 아래로 이동 |
| https://sgb.mansejin.com/admin/saenggibu | 관리자 화면 + API (Vercel) |

배포·저장소·환경변수는 [deploy-vercel.md](deploy-vercel.md)를 보세요.

## redirect 페이지 (tools-site)

**자동 (추천)**: `saenggibu` → Settings → Secrets → `TOOLS_SITE_PAT` (tools-site 쓰기 권한 토큰). 이후 push마다 `sync-tools-site.yml`이 redirect 페이지를 tools-site에 반영합니다.

**수동 1회**: `deploy/tools-site-admin/admin/saenggibu/index.html` 한 파일만 tools-site에 push.

## CORS

mansejin.com 페이지에서 API를 부르려면 Vercel 환경변수 `SGB_ALLOWED_ORIGINS`에 `https://mansejin.com,https://www.mansejin.com`이 있어야 합니다.

## 문제 해결

| 증상 | 확인 |
|------|------|
| 로그인 실패 | `https://sgb.mansejin.com/health`, Vercel 환경변수 `ADMIN_PASSWORD`·`ADMIN_SESSION_SECRET` |
| 로그인은 되는데 목록 안 뜸 | `SGB_ALLOWED_ORIGINS`, Vercel 함수 로그 |
| 일괄 작성이 중간에 멈춘 듯 보임 | 5분 단위로 이어서 실행됨. 창을 닫지 말고 기다리기 ([deploy-vercel.md](deploy-vercel.md)) |
| 카톡에서만 이상 | 인앱 브라우저 → Safari/Chrome에서 열기 |
