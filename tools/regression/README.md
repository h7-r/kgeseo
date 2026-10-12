# 회귀 검사

코드를 고친 뒤에도 게임이 **똑같이 보이고 똑같이 움직이는지** 확인하는 도구다.
고치기 전 코드로 한 번 「기준」을 떠 두고, 고친 코드를 같은 입력으로 다시 떠서 체크포인트마다 견준다.
리팩터(이름 바꾸기·파일 나누기·TS 전환)처럼 「화면은 그대로여야 하는」 변경을 검증할 때 쓴다.

| 묶음   | 대상                                                                                                                   | 체크포인트    | 한 판 걸리는 시간 |
| ------ | ---------------------------------------------------------------------------------------------------------------------- | ------------- | ----------------- |
| `game` | 본편 — 튜토리얼 1~8, 퍼즐, 복도·자판기·소화전, 본부실, 기차·나주 진입, 캐릭터 생성, 주소 스위치                        | 92            | 약 15~30분        |
| `naju` | naju01 — 맵, ?dev 계기판, 편집기(고르기만), 로딩 이어받기, 캐릭터 생성 미리보기, 보행 비교·QA·지형 페이지, 주소 스위치 | 112 (구간 17) | 약 10~20분        |

```
tools/regression/
  game/   suite.json · route.json
  naju/   suite.json · route.json · pages.json · build-route.mjs
  shared/
    check.sh     서버 켜기 → 한 판 뜨기 → 서버 끄기 → 기준과 비교 (평소엔 이것만 쓴다)
    baseline.sh  기준 만들기(같은 코드를 두 번 떠서 잡음까지 잰다)
    capture.sh   떠 있는 서버를 상대로 한 판(run.mjs + leva-dump.mjs)
    server.sh    검사용 vite 서버 켜기/끄기
    run.mjs      경로 재생 → 체크포인트마다 PNG + JSON
    leva-dump.mjs   Leva 값 전부를 {"폴더/키": 값} 으로
    compare.mjs  기준 vs 새 실행 (+ leva-compare.mjs)
    noise.mjs    기준끼리의 차이 = 잡음
    contact-sheet.mjs  스크린샷을 한 장 격자로 모아 보기
    session.mjs · steps.mjs · checkpoint.mjs · pixel-diff.mjs · suite.mjs · vite.harness.config.mjs
```

`baseline/`·`runs/`·`.cache/` 는 스크린샷 수백 장이라 깃에 올리지 않는다(`.gitignore`). 기준은 각자 컴퓨터에서 뜬다.

## 준비

- 루트에서 `npm install` 만 하면 된다. 따로 받을 패키지는 없다(Playwright·Prettier·three 는 루트 의존성을 쓴다).
- 실제 Chrome 이 깔려 있어야 한다(`channel: "chrome"` 으로 띄워야 WebGL 이 진짜로 그려진다).
- bash · curl · lsof 가 필요하다(macOS·Linux 기본).

## 1. 기준 만들기 — 고치기 전 커밋에서 한 번

기준은 **고치기 전 코드**에서 뜬다. 작업 트리를 건드리지 않도록 그 커밋을 옆 폴더에 꺼낸다.

```bash
# 고치기 전 커밋(예: main 끝, 또는 리팩터 직전 커밋)을 옆 폴더로
git worktree add ../kgeseo-base <커밋>
# package-lock.json 이 같으면 의존성은 링크로 충분하다(다르면 그 폴더에서 npm ci)
ln -s "$PWD/node_modules" ../kgeseo-base/node_modules

# 기준 뜨기 — 도구는 지금 저장소의 것을 쓰고, 대상만 기준 폴더를 가리킨다
bash tools/regression/shared/baseline.sh game ../kgeseo-base      # 포트 5301
bash tools/regression/shared/baseline.sh naju ../kgeseo-base      # 포트 5321
```

`baseline.sh` 는 같은 코드를 **두 번 동시에** 떠서(일부러 부하를 줘서) 두 판의 차이를 잡음으로 잰다.
결과는 `tools/regression/<묶음>/baseline/{run1, run2, noise.json, leva.json}`. 두 묶음을 동시에 돌려도 된다(포트가 다르다).
다 쓴 기준 폴더는 `git worktree remove ../kgeseo-base` 로 치운다.

## 2. 비교 돌리기 — 고친 뒤마다

```bash
npm run regress:game                     # 이 저장소를 포트 5302 로 떠서 game 기준과 비교
npm run regress:naju                     # 포트 5322, naju 기준과 비교

# 인자는 -- 뒤에: [저장소 루트] [포트] [출력폴더]
npm run regress:game -- . 5303
npm run regress:naju -- ../다른-작업트리 5323 /tmp/naju-check
```

결과는 `tools/regression/<묶음>/runs/<폴더이름-시각>/`. 종료 코드 0 = 전부 같음, 1 = 차이 있음.

이미 떠 둔 결과 둘만 견줄 때(서버 없이):

```bash
node tools/regression/shared/compare.mjs tools/regression/game/baseline tools/regression/game/runs/<폴더>
#   [--noise noise.json] [--tol 0.10] [--leva-map map.json] [--json report.json]
```

환경변수로 바꿔 끼우는 것:

| 변수            | 언제                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------- |
| `BASELINE=폴더` | 기본 기준(`<묶음>/baseline`) 말고 다른 기준과 견줄 때                                                   |
| `PAGES=파일`    | naju 페이지 파일 이름이 바뀌었을 때 — 이름표는 그대로 두고 주소만 바꾼 json                             |
| `ROUTE=파일`    | 다른 경로 파일로 돌릴 때                                                                                |
| `APP_DIR=폴더`  | 앱 폴더 이름이 바뀌었을 때(naju 기본 `naju01`)                                                          |
| `LEVA_MAP=파일` | Leva 폴더·키 이름을 바꿨을 때 — `{ "folders": {"폴더": "새폴더"}, "keys": {"폴더/키": "새폴더/새키"} }` |

한 구간만 다시 볼 때: `node tools/regression/shared/run.mjs naju http://localhost:5322 /tmp/out --only editor`
(서버는 `bash tools/regression/shared/server.sh start naju . 5322`, 끝나면 `… stop 5322`). `--headed` 를 붙이면 창이 보인다.

## 3. 결과 읽기

```
체크포인트                                픽셀%    허용%    판정
62-valve-cutscene-mid                    0.043    0.147    ✔
80-naju-entry-cinematic                  3.422    0.100    ✖ 픽셀 3.422% > 허용 0.100% (잡음 0.000%)
…
Leva: 기준 1308개 · 새 1308개 · 짝지음(같은키 1308 / 매핑 0 / label 0)
결과: 체크포인트 91/92 같음 · Leva 문제 0건 · 차이 그림: …/_diff
```

체크포인트마다 견주는 것:

- **픽셀** — 다른 픽셀 비율(pixelmatch 알고리즘, 안티에일리어싱 제외). 허용 = 그 체크포인트의 잡음 + 0.10%p.
  다르면 `<결과>/_diff/<이름>.png` 에 빨간 점으로 남는다. 점이 흩어져 있으면 타이밍·무작위, 덩어리면 진짜 변화다.
- **글자** — 화면 `innerText` 줄 단위(`-` 빠짐, `+` 추가). ?dev 계기판의 좌표·속도·접지 같은 줄도 여기서 정확히 견준다.
- **저장소** — localStorage·sessionStorage 키별(Leva 저장값은 해시).
- **오류** — pageerror·console.error 중 새로 생긴 것. vite 웹소켓·하네스가 막은 외부 요청은 뺀다.
- **기타** — 주소(naju 는 `{map}?dev` 같은 이름표 꼴), 탭 제목, 포인터 잠금, 경로에 적힌 기대 글자.
- **Leva** — 열린 화면에 마운트된 값 전부(본편 1,308개 · naju 112개). 키 → 매핑 파일 → 새 입력의 label 순으로 짝짓고,
  폴더별 값 모음도 견준다. 이름이 바뀐 폴더는 「값 모음이 똑같은 짝」으로 제안해 준다.

기준끼리도 달랐던 항목은 실패가 아니라 `✔ (경고: …)` 로만 보인다. 전체 결과는 `<결과>/compare-report.json`,
한 판을 눈으로 훑으려면 `node tools/regression/shared/contact-sheet.mjs <결과폴더>`.

### 원래 매번 다른 것 — 실패로 보여도 코드 문제가 아니다

- **game 80 `naju-entry-cinematic`** — 로딩 막이 `<video>` 라 진짜 시간으로 재생된다. 0.4~10% 다른 게 정상이다.
  91/92 에서 이것 하나만 빨갛다면 통과로 본다. 81 `naju-first-screen` 의 로딩 문구도 무작위로 바뀐다(경고).
- **naju 052 · 054 · 055** — 같은 영상 막. 경로에 `warnOnly` 로 적혀 있어 경고로만 나온다.
- **naju ?dev 구간(009~038)** — 계기판의 「삼각형 N」「드로우콜 N」은 그림자 패스가 그 프레임에 돌았느냐에 따라 흔들린다.
  기준끼리 숫자만 달랐던 줄은 `noise.json` 의 `noisyLines` 로 빠지고, 픽셀 0.005~0.014% 도 잡음 안이다.
- **첫 로드 직후(game 01~05)** — 지연 로딩되는 아바타 머리카락·윤곽선 몇 점(≤0.03%).
- **텍스처·모형 도착 타이밍** — 에셋이 100ms 시간 덩어리 **안에서** 도착하면 어느 프레임에 붙을지가 달라질 수 있다.
  경로 전환 직후 몇 장에서 0.01~0.05% 쯤 나온다(game 62 · 89 · 90, naju 105). 허용치 안이면 신경 쓰지 않는다.
- `Math.random` 은 고정하지 않는다. 리팩터가 무작위 호출 순서를 바꾸면 깜빡이는 빛 등이 「흩어진 점」으로 나온다.

이 밖의 체크포인트가 빨갛다면 `_diff` 그림과 글자 차이부터 본다. 같은 코드로 한 번 더 떠서 또 나오면 진짜 차이다.

## 같은 화면을 두 번 만드는 법

1. **가짜 시계** — 페이지가 뜨기 전에 Playwright 시계를 멈춘 채 설치한다. rAF·performance.now·Date·setTimeout 이 전부
   가짜 시간이고, 경로가 민 만큼만 흐른다(rAF 는 정확히 16ms 간격). 시계를 설치하는 동안 Node 의 시각도 멈춰,
   판마다 performance.now 가 같은 값에서 시작한다.
2. **100ms 덩어리 + 응답 관문** — 시간을 100ms 씩 밀고, 밀기 전마다 진행 중 요청이 0 이 될 때까지 기다린다.
   미는 동안 도착한 응답은 붙잡아 두었다가 덩어리 사이에만 넘긴다. 디코딩(Draco 워커 등)을 위해 진짜 400ms 를 더 기다린다.
3. **외부 차단** — 구글 로그인 스크립트 등 바깥 요청은 막고, Draco 디코더(gstatic)는 `node_modules/three` 에 든 디코더로 대신 준다.
   백엔드 `/api/*` 는 늘 503 — 게임은 자기 로컬 판정으로 간다.
4. 1600×900 · 배율 1 · `ko-KR` · Asia/Seoul · 소리 끔. naju 는 구간마다 새 컨텍스트(빈 저장소·새 시계)에서 시작한다.
5. 검사용 vite 서버는 대상의 `vite.config` 를 그대로 쓰되 캐시를 `tools/regression/.cache` 로 돌리고 HMR 을 끈다.
   검사 중 파일을 고쳐도 페이지가 다시 뜨지 않고, 각자 띄운 개발 서버의 `node_modules/.vite` 도 건드리지 않는다.

경로와 비교는 게임 내부(window 전역·식별자)를 읽지 않는다. 입력은 키보드·포인터 잠금 마우스·클릭·휠·보이는 글자·
접근성 이름·주소·저장소뿐이라, 이름을 다 바꾸는 리팩터 뒤에도 같은 경로가 돈다. Leva 덤프만 leva 패키지의 공개 export
`levaStore` 를 읽는다(앱이 실제로 받은 모듈 주소로 import 해서 같은 인스턴스를 얻는다).

## 손 배치 파일은 안전하다

naju 편집기는 Ctrl+S·「저장하기」로 `POST /__naju-edit` 를 보내 `naju01/assets/edits.json` 을 덮어쓴다. 검사는 세 겹으로 막는다.

1. 경로가 저장 키·단추를 누르지 않는다. `hold`·`press` 단계는 Ctrl/⌘+S 조합이면 그 자리에서 실패한다.
2. 브라우저에서 GET/HEAD/OPTIONS 가 아닌 요청(`/api` 제외)을 전부 끊고 `summary.json` 의 `writeAttempts` 에 적는다.
   한 건이라도 있으면 그 판은 실패로 끝난다.
3. 검사용 vite 서버가 맨 앞 미들웨어로 쓰기 요청을 405 로 돌려준다(`.cache/blocked-writes.log`). 플러그인 이름·주소가 아니라
   「메서드」로 막아서, 저장 플러그인이 바뀌어도 그대로 듣는다. 본편 서버도 naju 편집 플러그인을 싣고 있어 똑같이 막힌다.

## 포트

- 검사용 서버는 **5301~5330 만** 쓴다. `server.sh` 가 이 밖이면 거부한다.
- **5173 · 5174 · 5175 는 각자 띄운 개발 서버 자리 — 쓰지 않는다.**
- 관례: game 기준 5301 · 비교 5302, naju 기준 5321 · 비교 5322. 동시에 여러 판을 돌릴 땐 5303·5323 처럼 비켜 쓴다.
- 중간에 끊겨 서버가 남았으면 `bash tools/regression/shared/server.sh stop <포트>`.

## 경로 고치기

- **naju** — `naju/build-route.mjs` 를 고치고 `node tools/regression/naju/build-route.mjs` 로 `route.json` 을 다시 만든다.
  편집기 클릭 좌표는 화면 배치에 묶여 있어, 맵 배치가 바뀌면 다시 재야 한다.
- **game** — `game/route.json` 은 769단계를 직접 적은 데이터다. 몇 px 돌리고 몇 ms 걷는지가 다 숫자라 손으로 고칠 땐
  고친 구간 뒤의 체크포인트가 전부 밀린다는 점을 생각한다. 경로를 바꾸면 기준도 새 경로로 다시 떠야 한다.
- 단계(op): `goto` `key` `hold` `run` `mouse` `mouseAbs` `click` `mclick` `wheel` `clickText` `clickRole` `fill` `press`
  `rclickDrag` `exitPointerLock` `waitUrl` `waitText` `storage` `newContext` `section` `checkpoint` — `shared/steps.mjs` 참고.

## 체크포인트

**game (92)**

| 구간                   | 체크포인트                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| 첫 로드 · 튜토리얼     | 01 첫 로드 · 02~12 T 잠금·시점·걷기·F1·달리기·점프·앉기·1인칭·돌기 · 13 비상문 앞              |
| 튜토리얼 퍼즐          | 14~25 작업등·분기함 A/B/C·차단기함 자물쇠·모양 선·레버 → 튜토리얼 완료                         |
| 화면 창                | 26~31 H 힌트함 · P 설정 · I 소지품 · Esc · V 3인칭                                             |
| 복도 · 자판기 · 소화전 | 32~38 분리수거·그림·전원·끝문 · 39~51 자판기·동전·컵·캔·쪽지 · 52~63 소화전·배전반·밸브 → 컷신 |
| 본부실                 | 64~75 비밀문·긴급 호출·서랍·머그(1·3인칭)·노트북·의자                                          |
| 기차 · 나주            | 76~79 기차·홀로그램·나주 선택 · 80 진입 연출(영상) · 81 naju01 첫 화면                         |
| 주소 · 스위치          | 82 /train · 83~88 /character-creation 탭 · 89 ?leva=1 · 90 ?q=low · 91 ?fx=off · 92 ?zone=off  |

**naju (112)**

| 구간                      | 체크포인트                                                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| map                       | 001~008 첫 로드 · T · 걷기 · 3인칭·펀치·달리기 · 1인칭                                                          |
| map-dev (?dev)            | 009~038 계기판 · 걷기/달리기/점프/앉기 · 시점 · V1·V2·V3 · 3인칭 · Shift+숫자 차단물 연출 · 잠금 풀기           |
| editor                    | 039~051 편집 모드 · 나무/나룻배 고르기 · 못 옮기는 땅 · 우클릭 시점 · Tab 부감 · 「놓을 것」 — 저장 안 함       |
| handoff                   | 052~056 이어받은 로딩 막(경고만) · ?transition=3 오프닝 · SKIP                                                  |
| cc                        | 057~092 character-creation.html — 피부·성별·보기·체형·되돌리기·헤어·의상·초기화·이름 규칙·중복확인·완료         |
| gait · wardrobe · terrain | 093~099 보행 비교 단추들 · 100 빈 QA 무대 · 101 지형 지문                                                       |
| switch-*                  | 102~112 ?leva · ?q=low · ?fx=off · toon/outline 끔 · 후처리 변형 · 16x9 · dpr=1 · ?customize · ?avatar=sidekick |

각 체크포인트는 `NN-이름.png`(1600×900) 와 `NN-이름.json`(화면 글자·주소·탭 제목·포인터 잠금·저장소·직전 이후 오류·기대 글자 누락)
두 파일이다. 단계가 실패하면 `_fail-stepN.png/.txt` 가 남고, 그 뒤 체크포인트는 `summary.json` 에 `not-reached` 로 적힌다.

덮지 못한 것: 편집기의 고치는 동작(옮기기·회전·지우기·놓기)과 저장, 로딩 영상 자체, 소리, 색 직접 고르기 입력,
qa-wardrobe 의 장면 전환(화면 조작 없이 `window.__qa` 로만 움직인다), 낙하 복귀·고리 완주 같은 긴 보행.
