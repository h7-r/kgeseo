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
/* ── 에러 수집기 — **개발 서버에서만** 넣는다 ──
   잡히지 않은 에러를 탭 제목에 찍고 window.__E 에 쌓아 두는 개발용 장치(본편 index.html 과 같은 것).
   [전엔] index.html 에 박혀 있어 배포본에도 들어갔다 → 실제 사용자 화면에서 에러가 나면
          탭 제목이 「ERR: …」로 바뀌었다. 배포본엔 필요 없는 코드라 개발 때만 끼워 넣는다. */
function 개발용에러수집기() {
  return {
    name: "개발용-에러수집기",
    apply: "serve",
    transformIndexHtml() {
      return [{
        tag: "script",
        injectTo: "body-prepend",
        children: `window.__E=[];function __err(m){window.__E.push(String(m).slice(0,500));document.title="ERR: "+String(m).slice(0,120);}addEventListener("error",e=>__err((e.error&&e.error.stack)||e.message));addEventListener("unhandledrejection",e=>__err("REJ "+((e.reason&&e.reason.stack)||e.reason)));`,
      }];
    },
  };
}

/* ── 배포본 index.html 에서 주석 빼기 ──
   JS·CSS 는 빌드할 때 압축(minify)되며 주석이 저절로 빠지지만, **HTML 은 Vite 가 손대지 않는다.**
   그래서 index.html 의 긴 설명 주석이 그대로 배포돼 첫 요청(문서)이 커졌다. 빌드할 때만 지운다
   (소스 index.html 의 주석은 그대로 — 읽는 사람을 위한 설명이다). */
function 배포html주석빼기() {
  return {
    name: "배포-html-주석빼기",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler: (html) => html.replace(/<!--(?!\[if)[\s\S]*?-->/g, "").replace(/\n\s*\n+/g, "\n"),
    },
  };
}

/* ── 배포본 셰이더(GLSL) 글에서 주석 빼기 ──
   셰이더는 JS 안의 **문자열**이라, JS 압축기는 그 안의 주석을 코드가 아닌 글자로 보고 그대로 남긴다.
   (히어로영상.jsx 의 셰이더 설명 주석이 배포 JS 에 그대로 실려 갔다.)
   빌드할 때만 「○○셰이더 = `…`」 문자열 안의 주석과 빈 줄을 지운다. 셰이더 동작은 그대로다. */
function 배포셰이더주석빼기() {
  return {
    name: "배포-셰이더-주석빼기",
    apply: "build",
    transform(코드, id) {
      if (!/\.jsx?$/.test(id) || !코드.includes("셰이더 = `")) return null;
      const 새코드 = 코드.replace(/(셰이더\s*=\s*`)([^`]*)(`)/g, (_, 앞, 몸, 뒤) =>
        앞 + 몸.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim() + 뒤);
      return { code: 새코드, map: null };
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react(), 개발용에러수집기(), 배포html주석빼기(), 배포셰이더주석빼기()],

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
  server: {
    port: 5175,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
});
