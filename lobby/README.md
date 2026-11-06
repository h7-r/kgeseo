# 로비 서버 (waegok-lobby)

본부실에서 같은 방 참가자의 닉네임·캐릭터·이동을 보고 정해진 문구로 인사하는 방 서버다.
기준: 「왜곡 로비 멀티플레이 설계 v0.19」 3·3.1·3.2·3.3·5절.

## 버전 (설계 3.2절)

| 패키지                   | 판                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------- |
| Node.js                  | 22 이상                                                                               |
| `colyseus`               | 0.18.11                                                                               |
| `@colyseus/core`         | 0.18.10 — `overrides`로 고정. 설치 뒤 `npm ls @colyseus/core`가 0.18.10 하나여야 한다 |
| `@colyseus/sdk`          | 0.18.9 (시험·클라이언트)                                                              |
| `@colyseus/loadtest`     | 0.18.4                                                                                |
| `@colyseus/schema`       | 5.0.42 — 서버·브라우저가 같은 판을 쓴다(`overrides`)                                  |
| `@colyseus/ws-transport` | 0.18.4                                                                                |
| `jose`                   | 6.2.13 (HS256 검증)                                                                   |

배포 서버에서는 `npm ci`만 쓴다. Core를 올릴 때는 `joinOrCreate`·`callOnAuth`·`Room._onJoin`이 바뀌었는지 먼저 비교한다.

## 로컬 개발 (test 프로필)

```bash
cd lobby
npm ci
npm run make-dev-env   # lobby/.env.lobby · backend/.env.lobby 를 같은 개발 키(dev-…)로 만든다. 키는 화면에 안 찍는다
npm run dev            # --profile=test, ws://localhost:2567

# 다른 창: 입장권을 발급하는 백엔드도 test 프로필로
cd backend && WAEGOK_RUN_PROFILE=test .venv/bin/uvicorn app.main:app --port 8000
```

- `lobby/.env.lobby`는 **test 프로필에서만** 읽는다(Git 무시: `.env.*`). 프로필 키는 이 파일에 있어도 무시한다. 파일이 없는 것은 괜찮지만, 있는데 못 읽거나 형식이 틀린 줄이 있으면 시작하지 않는다.
- `npm run dev`에서 `--profile=test`를 빼면 production으로 보고 개발 키·시험 값에 걸려 시작하지 않는다.
- 다른 기기에서 열 때만 `LOBBY_HOST=0.0.0.0`을 준다(기본 127.0.0.1).

## 운영 (production 프로필)

```bash
npm ci && npm run build
node dist/index.js --profile=production     # systemd waegok-lobby 의 ExecStart 줄
```

프로필은 실행 명령에만 적는다. 설정값은 프로세스 환경으로만 받는다(systemd `EnvironmentFile`). 운영에서 로비 전용 파일을 직접 열지 않는다.

| 환경값                  | 뜻                                        | 운영 시작 검사                                  |
| ----------------------- | ----------------------------------------- | ----------------------------------------------- |
| `LOBBY_TICKET_SECRET`   | FastAPI와 같은 서명 키                    | 없음·32바이트 미만·`dev-`로 시작하면 시작 안 함 |
| `LOBBY_ALLOWED_ORIGINS` | 게임 출처(쉼표로 여러 개, 경로 없이)      | 비었거나 와일드카드면 시작 안 함                |
| `LOBBY_MAX_ROOMS`       | 방 수 상한(방당 10자리)                   | 5가 아니면 시작 안 함                           |
| `LOBBY_TEST_HOOKS`      | 시험 장치                                 | 1이면 시작 안 함                                |
| `LOBBY_ENV`             | (선택) 설정 묶음 표시                     | 적었는데 실행 프로필과 다르면 시작 안 함        |
| `LOBBY_PORT`            | 기본 2567                                 | 정수가 아니면 시작 안 함                        |
| `LOBBY_HOST`            | 기본 127.0.0.1(Caddy 뒤)                  | —                                               |
| `LOBBY_TEST_HOOKS_PORT` | 시험 장치 조작 창구(기본 2568, 127.0.0.1) | —                                               |

시작 검사에 걸리면 `startup_check_failed` 한 줄(항목과 이유만, 값은 없음)을 남기고 종료 코드 1로 끝난다.

## 동작 요약

- 열어 둔 매칭 경로: `joinOrCreate` 하나(`create`·`join`·`joinById`·`reconnect`는 닫힘).
- CORS: 기본 `Access-Control-Allow-Origin: *`와 `Allow-Credentials`를 지우고, 허용한 출처에만 그 출처·자격 증명 허용을 준다. `Max-Age` 600, `Vary: Origin`.
- WebSocket: `@colyseus/ws-transport` 0.18.4의 `beforeUpgrade` 훅에서 출처가 다르면 403, 주소에 `_authToken`이 있으면 400(`src/matchmaking.ts`).
- **티켓은 URL에 넣지 않는다.** SDK의 `client.auth.token`은 티켓을 WebSocket 주소(`_authToken`)에 복사하므로 쓰지 않는다. 클라이언트는 `new Client(주소, { headers: { Authorization: "Bearer <티켓>" } })`처럼 매칭 HTTP 헤더로만 보낸다(브라우저 WebSocket 은 헤더를 보내지 않는다).
- 인증(`static onAuth`): 출처 → 같은 요청 재시도면 저장한 결과(만료만 재확인) → 티켓 검증 → `usedJti` 확인·등록(사이에 await 없음) → 인증 정보 객체 키 `WeakMap`.
- 입장(`onJoin`): 만료 재확인, 검증된 닉네임만 쓴다. 좌석 예약 5초, 정원 10, 가장 찬 방부터.
- 방 상태: 연결 ID·닉네임·검사한 외형·위치·방향·걸음새만. 계정 ID·티켓 ID는 넣지 않는다.
- 메시지: `move { x, y, z, ry, gait }`(초당 10회, 본부실 벽 안, 이동 거리 예산 — 최고 속도×1.5를 초당 채우고 0.5초 치까지 모아 둔다. 먼 자리가 3초 넘게 계속 오면 그 자리로 옮긴다), `greet { id }`(1~6, 3초 쿨다운) → 방에 `greet { sid, id }`.
- 티켓 시간: 재시작 이전·같은 초 발급(`TICKET_STALE`), 발급 시각이 5초 넘게 미래이거나 유효 시간이 120초를 넘으면 `TICKET_INVALID`.
- 운영 로그: 매칭 인증 거절(`auth_rejected`)·WebSocket 거절(`ws_rejected`)·입장 거절은 유형만 남긴다. 티켓·계정 ID·닉네임·위치는 남기지 않는다.

### 클라이언트가 받는 거절 사유

| 사유(message)                                     | 코드 | 화면 처리                        |
| ------------------------------------------------- | ---- | -------------------------------- |
| `ORIGIN_NOT_ALLOWED`                              | 525  | 이번 방문 재시도 끝              |
| `TICKET_USED` · `TICKET_STALE` · `TICKET_EXPIRED` | 525  | 일시적 실패 — 새 티켓으로 재시도 |
| `TICKET_INVALID` · `AUTH_MISSING`                 | 525  | 이번 방문 재시도 끝              |
| `LOBBY_FULL`                                      | 529  | 이번 방문 재시도 끝              |

### 외형(look)

`{ catalog, gender, hair, top, bottom, shoes, colors{skin,hair,cloth,bottom,shoes}, body{12개} }`, 직렬화 2,048바이트 이하.
허용 목록은 naju01 원본에서 뽑은 `src/generated/lookAllowlist.json`이다. 카탈로그·체형 범위를 바꾸면 `npm run extract-look`으로 다시 뽑는다(원본과 다르면 `npm test`가 실패한다). 틀린 외형은 비워서(`""`) 내려 보낸다. 성별도 함께 버려지므로 받는 쪽은 화면의 기본 외형 데이터로 그린다(빈 값을 그대로 렌더러에 넘기면 「안 입음」이 된다).

## 시험 장치 (test 프로필 + `LOBBY_TEST_HOOKS=1`에서만)

- 마지막 자리 경합: 두 요청의 첫 방 조회를 붙잡았다가 함께 풀어 같은 방을 고르게 한다(`RaceDriver`).
- 인증 기록: 서버가 정한 요청 번호로 첫 인증·같은 요청 재인증·거절 사유를 남긴다(티켓 원문 없음).
- 원격 조작: `127.0.0.1:${LOBBY_TEST_HOOKS_PORT:-2568}`(환경값 `LOBBY_TEST_HOOKS_PORT`) — `POST /race/arm`, `POST /room-init/fail-next`, `GET /trace`, `GET /race`.

## 시험

```bash
npm run typecheck
npm test     # 단위 + 실제 서버·SDK 통합(약 25초)
```
