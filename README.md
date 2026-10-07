# 「왜곡」 — AI 기반 지역관광 방탈출

폐역에 차려진 합동수사본부를 무대로 한 1인칭 방탈출.
인공지능사관학교 최종 프로젝트.

---

## 시작하기

```bash
git clone <이 저장소 주소>
cd kgeseo
npm install      # 패키지 설치 (처음 한 번, 그리고 package.json 이 바뀔 때마다)
npm run dev      # http://localhost:5173
```

`npm install` 을 빼먹으면 `Failed to resolve import "..."` 오류가 난다.
**팀원이 새 패키지를 추가한 커밋을 받으면 반드시 다시 돌린다.**

### 앱별 실행

한 저장소에 앱이 셋이고 포트가 고정돼 있다(`strictPort` — 물려 있으면 옆 포트로 옮기지 않고 실패한다).

| 앱 | 실행 | 주소 |
|---|---|---|
| 본편 게임 | `npm run dev` | `localhost:5173` |
| 나주 맵(naju01) | `npx vite naju01` | `localhost:5174` |
| 웹사이트(website) | `npm run web:dev` | `localhost:5175` |

> 웹사이트 폴더는 `시작페이지/` 에서 `website/` 로 이름이 바뀌었다. 옛 명령 `npx vite 시작페이지` 는
> **없는 폴더로 빈 서버를 5173 에 띄워** 본편 포트를 막는다. `Port 5173 is already in use` 가 뜨면
> `lsof -nP -iTCP:5173 -sTCP:LISTEN` 으로 무엇이 잡고 있는지 먼저 본다.

## 기술 스택

| | |
|---|---|
| 언어 | TypeScript 6 (strict) |
| 빌드 | Vite 8 |
| UI | React 19 · React Router 7 |
| 3D | Three.js 0.185 · React Three Fiber · drei |
| 후처리 | @react-three/postprocessing |
| 값 조절 | Leva (개발용 패널) |

## 폴더 구조

```
src/
├── main.tsx            엔트리 — 라우터 · 로딩 영상 막
├── app/                껍데기(Canvas·HUD·키 입력·씬 전환·오버레이)
├── engine/             여러 씬이 함께 쓰는 바탕
│                         · 툰 그라디언트 · 외곽선 · 상자 합치기 · 그림자 관리
│                         · Leva 값 저장(팀 기준값 포함) · 이동/카메라 붐
├── station/            역 씬 — 승강장 · 비밀 복도 · 수사본부 · 기차
│   └── controls/       Leva 조절 폴더(영어 열쇠 + 한글 표시)
├── props/              소품과 그 상태(자판기 · 작업등 퍼즐 · 자물쇠 · 배전반 …)
├── lobby/              겨냥 · 줍기 · 놓기 상호작용
├── tutorial/           튜토리얼 단계 · 출동
├── trainInterior/      기차 안 씬
├── game/ · investigation/  소지품 · 힌트 · 조사
├── settings/ · audio/  설정 · 효과음 · 배경음악
├── server/ · session/  백엔드 연결(계약 v0.3.1)
├── characterCreation/  캐릭터 생성 화면(naju01 컴포넌트를 감싼다)
├── naju/               본편이 naju01 에서 가져다 쓰는 것의 입구
├── debug/              성능 계기 · 오류 기록 · window.__game
└── types/              three 타입 보강
public/models/          GLB 모델
public/check.html       성능 진단 페이지
```

## 주소

| 주소 | 화면 |
|---|---|
| `/` | 역 — 승강장 · 비밀 복도 |
| `/train` | 기차 안 |
| `/character-creation` | 캐릭터 생성(웹사이트 「게임 시작」이 여기로 온다. `?transition=초` 면 오프닝 영상을 이어 튼다) |

### 개발용 스위치 (주소 뒤에 붙인다)

| | |
|---|---|
| `?leva` | Leva 조절 패널 열기 |
| `?dev` | 개발 도구(성능 계기 등) 열기 |
| `?q=low` | 저사양 모드 (그림자·안티앨리어싱 끔, 텍스처 절반) |
| `?fx=off` | 후처리(Bloom) 제거 · `?fx=hi` 고품질 비교 |
| `?zone=off` | 구역 컬링 끄기 (전부 항상 그림) |
| `?input=always` | 포인터 잠금 없이 조작(자동 검사용) |

콘솔에서는 `window.__game` 아래에 디버그 손잡이가 모여 있다(`__game.teleport(x, z)`, `__game.leva` …).

## 조작

`T` 시작 · `WASD` 이동 · `Shift` 달리기 · `Space` 점프 · `C` 앉기 · `E` 상호작용 · `ESC` 나가기

> `Ctrl` 은 조작키로 쓰지 않는다. 윈도우에서 `Ctrl+W` 가 탭을 닫아 버린다.

## 배포

```bash
npm run build
npx vercel --prod
```

## 작업 규칙

브랜치·충돌 규칙은 [`docs/브랜치-작업규칙.md`](docs/브랜치-작업규칙.md) 를 먼저 읽는다.
