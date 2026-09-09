# WSMK Crew Performance

선원 승선이력 스크린샷 → (Claude vision) 선박·승선기간 추출 → 해당 기간의
**PSC 검사 / Unplanned Unavailability(Unscheduled stoppage) / LTIF** 실적을 보여주는 웹 플랫폼.

- 비밀번호 보호 (`APP_PASSWORD`, 기본 `wsmk2026!`)
- 상단: 당해년도 vs 전년도 **한 척당 평균** (PSC 검사·결함·무결함율·Detention·Unavailability 시간·LTIF 건수) + 조회한 선원의 합계
- 결과는 항목별로 정리: 승선기간 요약표 → 1. PSC(날짜·항구·MOU·결함수·Code 17·Detention·결함 상세) → 2. Unscheduled stoppage(시간, ≥24h Remark) → 3. LTIF/LTSF (Crew Data1)
- Claude 모델: `claude-haiku-4-5` (가장 빠른 vision 모델). 정확도가 아쉬우면 환경변수 `CLAUDE_MODEL=claude-sonnet-5`

## 폴더 구조
```
api/                 Vercel serverless functions
  login.js           비밀번호 확인 → 12시간 세션 토큰
  data.js            색인 데이터(JSON) 제공 (로그인 필요)
  extract.js         스크린샷 → Claude vision → {vessel, rank, sign_on, sign_off}
  _auth.js           HMAC 토큰 유틸
public/index.html    프론트엔드 (단일 파일)
data/index.json      두 엑셀을 deep-indexing 한 결과 (api에서만 읽힘, 외부 노출 안 됨)
scripts/build_index.py   색인 생성 스크립트
```

## 데이터 색인 갱신 (엑셀이 바뀌었을 때)
```powershell
cd "H:\My Drive\WSMK Work Place\PSC Database File\wsmk-crew-perf"
pip install openpyxl
python scripts\build_index.py "..\WSMK PSC Status & Schedule(Updated) - Editable - Editable.xlsx" "..\WSMK KPI.xlsx" data\index.json
git add data\index.json
git commit -m "Refresh index"
git push        # Vercel 자동 재배포
```

색인 규칙:

| 항목 | 파일 / 시트 | 규칙 |
|---|---|---|
| PSC | PSC Status & Schedule → `Database` | 선박+날짜로 검사 단위 묶음. Code 30 = Detention. `No deficiency` / `total:` 행은 결함으로 세지 않음 |
| Unplanned Unavailability | WSMK KPI → `Tech Data` | Event = *Unscheduled stoppage (Operational Delay)*, Off-Hire(H:MM) → 시간. KPI `Yes` 행만 합계 (`To be confirmed`는 표시만) |
| LTIF / LTSF | WSMK KPI → `Crew Data1` | 건수 (Rank·Description 포함) |
| 선박 수(연도별 평균 분모) | 위 시트에 해당 연도 기록이 있는 선박 수, 당해년도는 `WSMK Vessel Schedule` 선박 수 | 화면 상단에서 직접 수정 가능 |

## 최초 배포 (GitHub + Vercel)
1. GitHub에서 **private** 저장소 생성 (예: `wsmk-crew-perf`)
2. 이 폴더에서 (Git Bash / PowerShell):
   ```powershell
   git init
   git add .
   git commit -m "WSMK Crew Performance platform"
   git branch -M main
   git remote add origin https://github.com/<계정>/wsmk-crew-perf.git
   git push -u origin main
   ```
3. Vercel → **Add New… → Project** → 위 저장소 Import
   - Framework Preset: **Other** (빌드 없음 — `vercel.json`이 `public/`을 정적 루트로 지정)
4. **Environment Variables** 입력 후 **Deploy**
   - `ANTHROPIC_API_KEY` = Claude API 키 (console.anthropic.com)
   - `APP_PASSWORD` = `wsmk2026!`
   - (선택) `CLAUDE_MODEL`, `SESSION_SECRET`
5. 배포 URL 접속 → 비밀번호 → 스크린샷 붙여넣기(Ctrl+V) → **승선기간 분석 (Claude)** → 표 확인/수정 → **Performance 조회**

## 로컬 실행
```powershell
npm i -g vercel
copy .env.example .env.local     # 값 채우기
vercel dev
```

## 참고
- 이미지는 브라우저에서 최대 1800px JPEG로 축소 후 전송 (Vercel 요청 4.5MB 제한, 응답 속도)
- 추출 결과는 표에서 직접 수정 가능. 선박명은 함대 목록에 자동 매칭(오탈자 보정, 미매칭 시 붉게 표시)
- 하선일이 비어 있으면 "on board"로 보고 오늘까지 집계
- PSC 데이터는 2014년~, KPI 데이터는 2016년~ 색인됨
