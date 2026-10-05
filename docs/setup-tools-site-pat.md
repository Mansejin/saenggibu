# TOOLS_SITE_PAT 설정 (A안) — 3분

Cursor 봇은 **당신 GitHub Secrets에 접근할 수 없어서** PAT는 본인이 한 번만 등록해야 합니다.  
아래 순서 그대로 하면 이후 **자동**입니다.

---

## 1) 토큰 만들기 (1분)

1. 열기: https://github.com/settings/tokens?type=beta  
2. **Generate new token**
3. 설정:
   - **Token name**: `tools-site-deploy`
   - **Expiration**: 90 days (또는 No expiration)
   - **Repository access**: **Only select repositories** → `Mansejin/tools-site` 체크
   - **Permissions** → Repository permissions → **Contents**: **Read and write**
4. **Generate token** → `github_pat_...` 로 시작하는 문자열 **복사** (다시 안 보임)

---

## 2) Secret 등록 (30초)

1. 열기: https://github.com/Mansejin/saenggibu/settings/secrets/actions  
2. **New repository secret**
3. Name: `TOOLS_SITE_PAT`  ← **이름 정확히**
4. Secret: 방금 복사한 토큰 붙여넣기
5. **Add secret**

---

## 3) 자동 배포 실행 (30초)

1. 열기: https://github.com/Mansejin/saenggibu/actions/workflows/sync-tools-site.yml  
2. **Run workflow** → Branch: `main` → **Run workflow**
3. 초록 체크 뜨면 성공

1~2분 후: https://mansejin.com/admin/saenggibu/ → `sgb.mansejin.com` 으로 이동

---

## 이후

`saenggibu`에 push할 때마다 tools-site redirect가 **자동 갱신**됩니다.  
**복사·GitHub Desktop push 필요 없음.**

UI/업로드 변경은 **나스만** `docker compose up -d --build`.

---

## PAT 없이 하고 싶다면

`docs/setup-tools-site-auto.md` — tools-site 쪽 workflow 1파일만 넣는 방식 (PAT 불필요)
