import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// 시작 페이지(게임 진입 전 웹페이지) 전용 개발 서버
//   본편·naju01 과 **같은 node_modules · 같은 패키지 버전**을 쓴다.
//   (저장소 뿌리의 package.json 하나만 설치하면 여기도 그대로 돌아간다)
//
//   실행:  npx vite 시작페이지        → http://localhost:5175
//   빌드:  npx vite build 시작페이지
//
// [왜 본편 src/ 가 아니라 따로 두나]
//   지금 이 페이지는 게임과 **연결하지 않는다.** 본편 App.jsx 나 라우터를
//   건드리면 진행 중인 게임 작업과 같은 파일에서 부딪힌다. 여기는 완전히
//   분리된 앱이라, 이쪽을 아무리 고쳐도 게임 쪽 화면은 한 줄도 안 바뀐다.
//   나중에 붙일 땐 src/시작화면.jsx 를 본편 라우트로 옮겨 붙이면 된다.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],

  // publicDir 은 **이 폴더 것**(시작페이지/public/)을 쓴다 — 기본값이라 안 적는다.
  //
  // [왜 본편 public/ 을 공유하지 않나]
  //   공유하면 편해 보이지만, publicDir 안의 파일은 빌드할 때 **쓰든 안 쓰든
  //   통째로 복사된다.** 본편 public/ 에는 게임용 GLB 모델과 텍스처가 들어
  //   있어서, 그렇게 하면 글자 몇 줄뿐인 이 페이지의 빌드가 13MB 가 된다.
  //   (실제로 그랬다. 그래서 떼어 놨다.)
  //
  //   공용 자산이 필요하면 복사하지 말고 상대경로로 **가리키기만** 한다.
  //   CSS:  url("../../public/fonts/eonggeongkwi.woff2")
  //   JS :  import 그림 from "../../public/textures/...";
  //   이러면 실제로 쓴 파일 하나만 해시가 붙어 번들에 들어간다.

  // ── 포트를 못 박는다 ──────────────────────────────────────
  //   본편 5173 · naju01 5174 · 시작페이지 5175.
  //   strictPort 를 켜면 이미 물려 있을 때 옆 포트로 말없이 옮겨 붙지 않고
  //   그냥 실패한다. "왜 엉뚱한 화면이 뜨지" 보다 "포트가 물렸다" 가 훨씬
  //   고치기 쉬운 오류다. (뿌리 vite.config.js 의 같은 판단을 따른다)
  server: { port: 5175, strictPort: true },
});
