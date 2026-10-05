# A안: tools-site 자동 배포 (PAT 없음, 2분)

`mansejin.com/admin/saenggibu/` 가 Vercel의 생기부 API로 자동 이동하도록 설정합니다.  
**한 번만** tools-site에 워크플로 파일을 넣으면, 이후는 **자동**입니다.

---

## 1분 설정 (GitHub 웹)

1. 브라우저에서 열기:  
   https://github.com/Mansejin/tools-site/new/main/.github/workflows

2. 파일 이름: `sync-saenggibu-admin.yml`

3. 아래 파일 내용 **전체 복사**해서 붙여넣기:  
   `saenggibu` 저장소의  
   `deploy/tools-site-admin/.github/workflows/sync-saenggibu-admin.yml`

4. **Commit changes** → **Commit directly to main**

5. **Actions** 탭 → **Sync saenggibu redirect** → **Run workflow** → **Run workflow**

1~2분 후 https://mansejin.com/admin/saenggibu/ 접속 → `sgb.mansejin.com` 으로 이동하면 성공.

---

## 이후

| 할 일 | 누가 |
|--------|------|
| UI·업로드 기능 수정 | `saenggibu` main push → Vercel 자동 배포 |
| mansejin.com redirect 갱신 | **자동** (매시간 + saenggibu push 시 수동 실행 가능) |

**복사·tools-site push 필요 없음.**

---

## (선택) saenggibu PAT 방식

`saenggibu` → Settings → Secrets → `TOOLS_SITE_PAT` 를 넣으면  
`saenggibu` push 시 즉시 tools-site 반영 (`.github/workflows/sync-tools-site.yml`).

PAT 발급: GitHub → Settings → Developer settings → Fine-grained token  
- Repository: `Mansejin/tools-site`  
- Permission: Contents **Read and write**

Secret 이름은 반드시 `TOOLS_SITE_PAT`.

---

## 문제 해결

| 증상 | 해결 |
|------|------|
| Actions 탭이 없음 | tools-site → Settings → Actions → Allow |
| workflow 실패 | Actions 로그 확인, `main` 브랜치인지 확인 |
| 이동 안 됨 | `sgb.mansejin.com/health` 확인, Vercel 배포 상태 확인 |
