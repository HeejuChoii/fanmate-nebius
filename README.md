# FanMate (덕메) — a K-pop fan agent with memory, powered by NVIDIA Nemotron on Nebius Token Factory

**Track: Personal AI** · Nebius x NVIDIA Global AI Hackathon 2026

FanMate is an always-on fandom companion for K-pop fans. It remembers who your favorite idol is, your size, budget and colors, what you already own and which "pilgrimage" spots you've visited — and uses that memory to find the exact items your idol wore (verified by the Sonminsoo Wiki fan community), suggest budget alternatives, and plan a day route through places your idol visited. It answers in Korean, English, Japanese and Chinese, so international fans visiting Korea can use it too.

## Built on Nebius + NVIDIA
| Layer | What we use |
|---|---|
| Agent brain | **NVIDIA Nemotron** (`nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`, configurable) via **Nebius Token Factory** OpenAI-compatible API, with native function calling |
| Agent loop | Our own multi-step tool loop (`src/agent/nebius.ts`): up to 8 iterations of tool calls per turn, per-turn tool budget guard |
| Memory | Per-user long-term memory (`rememberFact` tool) + structured fan profile (favorites, size, budget, wishlist, owned items, visited places), injected as context every turn so memory survives new chats and restarts |
| Semantic search | **Nebius Token Factory embeddings** (`src/embeddings.ts`): when a fan's description doesn't match item text literally ("cozy brown corduroy cap"), FanMate ranks candidates by embedding similarity; vectors are cached on disk |
| User-controlled tools | 8 skills the user can see and undo: searchItem, findAlternative, addWishlist, planRoute, findPlaces, updateOwned, markVisited, savePreferences. The "My fandom record" panel shows and deletes every memory |

## Run
```sh
npm install
cp .env.example .env   # set NEBIUS_API_KEY
npm start              # http://localhost:3000
```
Env: `NEBIUS_API_KEY` (required), `NEBIUS_MODEL`, `NEBIUS_EMBED_MODEL`, `NEBIUS_BASE_URL`, `NEBIUS_EXTRA_BODY` (JSON, e.g. `{"chat_template_kwargs":{"enable_thinking":false}}`). Without `NEBIUS_API_KEY` the app falls back to the original Croche agent.

Deploy: `render.yaml` (Render, Node web service + persistent disk).

## Data
> This public repo ships a **sample** (141 items, 137 places for NCT WISH, aespa and BTS) so judges can run it locally. The hosted demo loads the full dataset (600+ items, 500+ places) from a private file on the server via `FANMATE_DATA_DIR` (Render Secret Files → `/etc/secrets`), because the curated fan data is our community's core asset.

- Items: Sonminsoo Wiki (sonminsoo.kr) fan-verified idol-worn products + clearly labeled unverified fan-account candidates
- Places: fan "pilgrimage" spots with real coordinates
- FanMate never invents items: if nothing is found it says so and points the fan to ask on the wiki.

License: MIT

---

# 덕메

K팝 팬이 최애 아이돌의 착용템과 성지(다녀간 장소)를 따라 할 수 있게 돕는, 내 덕질을 기억하는 AI 비서.
자세한 기획은 [PRD.md](PRD.md) 참고.

## 시연 당일 — 빠른 안내

### 서버 켜기

```sh
npm install        # 처음 한 번만
npm start
```

터미널에 뜨는 두 주소 중 하나로 접속:

- `http://localhost:3000` — 이 노트북에서
- `http://<와이파이 IP>:3000` — 같은 와이파이에 있는 팀원 노트북/휴대폰에서 (와이파이가 바뀌면 IP도 바뀜 — 서버 켤 때마다 터미널에 새로 찍힘)

### 서버 끄기

터미널에서 `Ctrl + C`. (`npm start`를 돌린 그 터미널 창에서 끄면 됨)

### 시연 중간에 처음부터 다시 하고 싶을 때

화면 오른쪽 위 **"처음부터"** 버튼(또는 "덕질 기록" 패널의 "기억 초기화"). 그 브라우저 사용자의 대화·기억(최애/사이즈/예산)·찜·보유·방문 기록·구매 연결 카운터·대화 언어·메시지 수까지 전부 비워지고 첫 화면(예시 질문)으로 돌아감.

("새 대화" 버튼은 대화창만 비우고 기억은 남겨둠 — 기억이 유지되는 걸 보여주고 싶을 때 씀.)

### 부스 모드 (방문자마다 분리)

- 브라우저마다 익명 사용자(서명된 랜덤 UUID 쿠키)가 생기고, 사용자마다 Croche 인스턴스·저장 폴더(`DATA_DIR/users/<uuid>/`)·찜/보유 기록·화면 이벤트가 따로다. 같은 브라우저(부스 노트북)는 같은 사용자.
- `BOOTH_IDLE_RESET=180`이면 3분 동안 입력이 없을 때 자동으로 "처음부터"(다음 관람객용). 부스 모드에서는 "처음부터" 버튼도 확인 창 없이 바로 초기화.
- 비용 보호: 사용자당 메시지 `USER_MESSAGE_LIMIT`(기본 30, "처음부터"하면 다시 셈), 서버 전체 시간당 `GLOBAL_MESSAGES_PER_HOUR`(기본 600), 한 턴 Tool 호출 `TOOL_CALLS_PER_TURN`(기본 12). 넘으면 화면에 안내 문구.

### 문제가 생겼을 때 — 마지막 정상 커밋으로 되돌리기

1. 지금까지 어떤 커밋들이 있는지 보기:

   ```sh
   git log --oneline
   ```

2. 화면/동작이 이상해졌는데 원인을 모르겠으면, 마지막으로 정상 작동했던 커밋으로 되돌리기:

   ```sh
   git stash        # 혹시 저장 안 된 변경이 있으면 일단 치워둠 (나중에 git stash pop으로 복구 가능)
   git reset --hard <커밋 해시>   # 예: git reset --hard d751b2d
   npm install       # package.json이 바뀐 커밋으로 되돌렸다면 한 번 더
   npm start
   ```

   `<커밋 해시>`는 `git log --oneline`에서 왼쪽에 나오는 7자리 값. 시연 직전에 안정적으로 돌았던
   커밋 해시를 메모해두면 좋음 (이 README 맨 아래 "체크포인트" 표 참고).

3. `.env` 파일은 git에 올라가지 않으므로(`.gitignore`), `git reset --hard`로 지워지지 않음 — 안심하고 되돌려도 됨.

4. 되돌린 뒤에도 안 되면, `users/` 폴더(사용자별 저장소, `DATA_DIR`를 바꿨다면 그 아래)를 지우고 다시 시작 (모든 방문자 기억이 초기화됨):

   ```sh
   rm -rf users
   npm start
   ```

### 자주 막히는 지점

| 증상 | 원인/조치 |
|---|---|
| `덕메 서버를 시작할 수 없어요: CROCHE_PROJECT_KEY…` | `.env` 파일이 없거나 비어있음(`.env.example` 참고). 로컬은 `CROCHE_DEBUG_KEY`, 운영은 `CROCHE_SERVER_KEY`. 디버그 키는 `croche debug-keys create --project <프로젝트ID>`로 다시 발급 |
| `node: .env: not found` | `.env` 파일이 프로젝트 루트(`dukme/`)에 없음. 터미널 현재 위치가 `dukme/` 폴더인지 확인 |
| 포트 3000이 이미 사용 중 | 이전에 띄운 서버가 안 꺼진 상태. `lsof -i :3000`으로 PID 찾아서 `kill <PID>`, 또는 `PORT=3001 npm start`로 다른 포트 사용 |
| 같은 와이파이 팀원이 접속 안 됨 | 같은 와이파이인지 확인, 맥북 방화벽이 들어오는 연결을 막고 있는지 확인(시스템 설정 → 네트워크 → 방화벽) |

## 개발용 명령어

```sh
npm start            # 서버 실행 (localhost:3000, .env 사용)
npm run dev           # 파일 바뀌면 자동 재시작
npm run typecheck     # TypeScript 타입 체크만
npm test              # scripts/*.test.ts 전부 (Croche 연결 없이 도는 범위)
npm run start:prod    # 운영 실행 (--env-file 없이, 환경변수는 Render가 넣어 줌)
```

## Render 배포

계속 켜져 있는 Node 서버 하나 + 영구 디스크로 올린다(Croche FileStorage는 폴더 하나를 프로세스 하나가 소유해야 해서 서버리스 불가). 설정은 레포의 `render.yaml`(Blueprint)에 있다.

1. Render 대시보드 → **New → Blueprint** → 이 GitHub 레포 선택 → `render.yaml`을 읽어 `dukme` Web Service가 만들어진다.
   - Node, `buildCommand: npm ci`, `startCommand: npm run start:prod`, `healthCheckPath: /health`
   - 디스크 `dukme-data`를 `/data`에 1GB로 붙인다. **디스크는 유료 인스턴스(Starter 이상)에서만** 붙고, 디스크가 붙은 서비스는 인스턴스 1개로만 돈다(그래서 저장 폴더 소유자가 하나로 유지된다).
2. 만들 때 값을 묻는 두 개(`sync: false`)를 입력한다. **키는 대시보드에만 넣고 코드·레포에는 절대 넣지 않는다.**
   - `CROCHE_PROJECT_KEY` — Croche Studio 공개 프로젝트 키
   - `CROCHE_SERVER_KEY` — Croche Studio 서버 키(`csk_…`). 디버그 키(`cdt_…`)는 로컬 개발용이라 운영에서는 거부된다.
3. 배포가 끝나면 `https://<서비스>.onrender.com/health`가 `{"ok":true,…}`인지 확인 → 그 주소가 부스 URL.
4. 키를 바꿀 때: Studio에서 새 서버 키 발급 → Render Environment에서 교체(재배포) → 이전 키 폐기.

### 환경변수

| 이름 | 필수 | 설명 |
|---|---|---|
| `CROCHE_PROJECT_KEY` | ✅ | Croche Studio 공개 프로젝트 키 |
| `CROCHE_SERVER_KEY` | 운영 ✅ | 서버 키 `csk_…` (Render에만) |
| `CROCHE_DEBUG_KEY` | 로컬 | 디버그 키 `cdt_…` (로컬 `.env`에만). 서버 키가 있으면 서버 키를 씀 |
| `SESSION_SECRET` | 운영 ✅ | 익명 사용자 쿠키 서명(32자 이상). `render.yaml`이 자동 생성(`generateValue`) |
| `NODE_ENV` | 운영 | `production` (서버 키·SESSION_SECRET 필수 검사, 프록시 신뢰) |
| `DATA_DIR` | | 저장 위치. 기본은 프로젝트 폴더, Render는 `/data` |
| `PORT` / `HOST` | | Render가 `PORT`를 넣어 줌. HOST 기본 `0.0.0.0` |
| `BOOTH_IDLE_RESET` | | 부스 자동 "처음부터"(초). `180` = 3분, 0/비우면 끔 |
| `USER_MESSAGE_LIMIT` | | 사용자당 메시지 수 (기본 30) |
| `GLOBAL_MESSAGES_PER_HOUR` | | 서버 전체 시간당 메시지 수 (기본 600) |
| `TOOL_CALLS_PER_TURN` | | 한 턴 Tool 호출 수 (기본 12) |
| `MAX_SESSIONS` | | 동시에 열어 두는 사용자 인스턴스 수 (기본 50) |
| `SESSION_IDLE_MINUTES` | | 이 시간 안 쓴 인스턴스는 닫음(저장 폴더는 유지, 기본 20) |
| `NEW_USERS_PER_IP_PER_HOUR` | | IP 하나에서 시간당 새 익명 사용자 수 (기본 100). 부스 와이파이처럼 한 IP를 여럿이 쓰면 늘릴 것 |
| `TRUST_PROXY` | | 프록시의 `X-Forwarded-For/Proto`를 믿을지 (`NODE_ENV=production`이면 기본 1) |

## 구조

- `data/items.json`, `data/places.json`, `data/aliases.json` — 목데이터 (나중에 실제 DB로 교체 가능, PRD §6)
- `src/server.ts` — 웹 서버(HTTP·SSE), 사용자별 요청 처리
- `src/agent/` — Croche 호출은 여기에만 (`croche.ts`: Croche.open, `pool.ts`: 사용자별 인스턴스, `prompt.ts`: 지침, `toolGuard.ts`: 한 턴 Tool 상한). SDK 마이그레이션 때 이 폴더만 고친다
- `src/config.ts` — 환경변수 / `src/identity.ts` — 서명된 익명 사용자 쿠키 / `src/paths.ts` — 사용자별 저장 경로
- `src/tools/` — Croche Tool 6종 (searchItem/findAlternative/addWishlist/planRoute/updateOwned/markVisited)
- `src/state.ts` — 찜/보유/방문 목록의 앱 authoritative 저장소 (`DATA_DIR/users/<id>/app-state.json`, Croche FileStorage는 같은 폴더의 `croche/`)
- `public/index.html` — 채팅 화면 1장
- `docs/notes.md` — 작업 중 판단 기록, `docs/results.md` — 모델 비교·페르소나 테스트 결과

## 체크포인트 (안정적으로 작동 확인된 커밋)

시연 리허설 중 "이 커밋은 확실히 잘 됐다"고 확인될 때마다 아래에 추가해두면, 문제가 생겨도 빠르게 되돌릴 수 있음.

| 날짜 | 커밋 | 확인한 내용 |
|---|---|---|
| 2026-10-15 | `3fd4bf7` | 시나리오 1~3 (오늘 밤 범위) |
| 2026-10-16 | (진행 중) | 시나리오 1~6 전체 |
