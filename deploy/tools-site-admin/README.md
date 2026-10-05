# mansejin.com 관리자 페이지

**더 이상 css/js를 tools-site에 복사하지 않습니다.**

`https://mansejin.com/admin/saenggibu/` → 자동으로 `https://sgb.mansejin.com/admin/saenggibu` 로 이동합니다.

실제 UI·업로드·분석은 **나스 API**가 제공합니다. 코드 수정 후 나스만 업데이트하면 됩니다.

## 자동 배포 (선택, 1회 설정)

`saenggibu` 저장소 Secrets에 `TOOLS_SITE_PAT` 추가 시, push마다 redirect 페이지가 tools-site에 자동 반영됩니다.

1. GitHub → Settings → Developer settings → Personal access token (repo 권한)
2. `saenggibu` → Settings → Secrets → `TOOLS_SITE_PAT`

수동 push 없이도 mansejin.com 주소가 유지됩니다.

## 수동 (PAT 없을 때)

`deploy/tools-site-admin/admin/saenggibu/index.html` 한 파일만 tools-site에 push하면 됩니다.

## 나스 업데이트

```bash
docker run --rm -v /volume1/docker/saenggibu:/git -w /git alpine/git pull
docker compose up -d --build
```

`web/admin` 은 volume 마운트라 UI 변경은 **재시작만**으로도 반영될 수 있습니다.

배포 중 점검 페이지: `docs/maintenance-page.md` 참고.
