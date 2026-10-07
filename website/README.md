# website

게임 「왜곡 — Escape the Legend」에 들어가기 전의 웹사이트. React 19 · TypeScript · Vite · react-router · three.js(@react-three/fiber).

## 실행

저장소 루트에서:

```bash
npm install
npm run web:dev         # http://localhost:5175
npm run web:typecheck   # tsc --noEmit
npm run web:build       # 타입 검사 후 빌드 → website/dist
npm run web:preview
npm run format          # Prettier 로 src/·website/ 서식 맞추기 (검사만: format:check)
```

포트는 고정이다 — 본편 5173 · naju01 5174 · website 5175 (`strictPort`).

환경변수는 `.env.example` 참고. `VITE_GAME_URL` 이 비어 있으면 게임 시작 단추가 게임 소개로 간다.
개발 서버는 `.env.development` 의 본편 개발 서버(5173)로 간다.

## 구조

```
src/
  main.tsx, App.tsx      진입점 · 라우트 · 3D 배경 · 페이지 전환
  app/pageRegistry.ts    페이지 코드 분할(lazy)과 미리 받기
  navigation/            주소 상수(routes.ts) · 하위 메뉴(subMenus.ts)
  pages/                 주소 하나에 대응하는 화면
  sections/<page>/       화면을 이루는 구간
  layout/                머리띠 · 푸터 · 영상 모달 · 게임 전환 영상
  components/            Stage · Modal · RegionPicker 등 공용 부품
  hooks/                 스크롤 연출 · 근접 반응 · 폼 검사 · 영상 미리보기
  services/              세션 · 계정 저장소(IndexedDB) · 비밀번호 재설정 · 소셜 로그인
  state/                 작은 전역 상태(createStore + useSyncExternalStore)
  lib/                   스타일 도우미 · 검증 · 검색 색인 · 이벤트
  data/                  화면 문구 데이터
  three/                 3D 장면(lazy 로드)
  styles/                전역 CSS (index.css 가 순서대로 import)
  assets/images/         피그마에서 내보낸 그림
```

## 설계 메모

- **1920 고정 좌표 + 통째로 축소.** 피그마 원본이 오토레이아웃이 아니라 좌표 디자인이라,
  `Stage` 가 1920 폭으로 그리고 창 폭에 맞춰 `scale` 한다. 높이는 맨 아래 요소까지 재서 정한다.
- **이동은 주소 상수로.** 모든 이동처는 `navigation/routes.ts` 의 `ROUTES` 에 있다.
  게임 시작 단추는 `START_GAME` 을 넘기고, `useSiteNavigate` 가 로그인 여부로 게임/로그인을 가른다.
- **스크롤 연출은 CSS 우선.** `animation-timeline` 을 지원하면 CSS(합성 스레드)가 하고,
  지원하지 않는 브라우저에서만 `hooks/motion.ts` 가 rAF 로 같은 값을 쓴다.
- **three.js 는 필요할 때만.** 장면 코드는 lazy 로 떼어 화면에 가까워질 때 붙이고,
  화면 밖이거나 동작 줄이기를 켠 사용자에겐 렌더하지 않는다.
- **인증 서버 전 단계.** 세션은 sessionStorage, 계정은 IndexedDB(PBKDF2 해시)에 둔다.
  화면 흐름을 위한 것이며 보안 장치가 아니다. 서버가 붙으면 `services/` 만 바꾼다.
  출시 전 `VITE_TEST_ACCOUNT=off` 로 테스트 계정을 끈다.

## 본편과의 계약

게임 시작 시 전환 영상을 2.6초 틀고 `GAME_URL + GAME_ENTRY_PATH` 로 옮겨 가며,
본 초를 `GAME_TRANSITION_PARAM` 질의로 넘긴다. 본편이 같은 영상을 그 초부터 이어 튼다.
두 앱의 `public/` 에 같은 영상 파일(`opening-cinematic.mp4`)이 있어야 한다.
