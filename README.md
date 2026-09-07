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

## 기술 스택

| | |
|---|---|
| 빌드 | Vite 8 |
| UI | React 19 · React Router 7 |
| 3D | Three.js 0.185 · React Three Fiber · drei |
| 후처리 | @react-three/postprocessing |
| 값 조절 | Leva (개발용 패널) |

## 폴더 구조

```
src/
├── main.jsx        엔트리 — 라우터를 감싼다
├── App.jsx         껍데기(Canvas·HUD·조작) + 역(승강장·복도) 씬
├── 공용.jsx        여러 씬이 함께 쓰는 부품
│                     · 셀셰이딩 그라디언트 · 외곽선 규칙
│                     · 상자합치기(드로우콜 절약) · Leva 값 저장
│                     · use이동 (1인칭 조작)
└── scenes/
    └── 기차내부.jsx  기차 안 씬
public/models/      GLB 모델
public/check.html   성능 진단 페이지
```

## 주소

| 주소 | 씬 |
|---|---|
| `/` | 역 — 승강장 · 비밀 복도 |
| `/train` | 기차 안 |

### 개발용 스위치 (주소 뒤에 붙인다)

| | |
|---|---|
| `?leva=1` | 배포본에서도 Leva 조절 패널 열기 |
| `?q=low` | 저사양 모드 (그림자·안티앨리어싱 끔, 텍스처 절반) |
| `?fx=off` | 후처리(Bloom) 제거 |
| `?zone=off` | 구역 컬링 끄기 (전부 항상 그림) |

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
