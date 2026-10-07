import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// 개발 서버에서만: 잡히지 않은 오류를 탭 제목과 window.__errors 에 남긴다.
function devErrorCollector(): Plugin {
  return {
    name: "dev-error-collector",
    apply: "serve",
    transformIndexHtml: () => [
      {
        tag: "script",
        injectTo: "body-prepend",
        children:
          "window.__errors=[];" +
          "const report=(m)=>{window.__errors.push(String(m).slice(0,500));document.title='ERR: '+String(m).slice(0,120);};" +
          "addEventListener('error',(e)=>report((e.error&&e.error.stack)||e.message));" +
          "addEventListener('unhandledrejection',(e)=>report('REJ '+((e.reason&&e.reason.stack)||e.reason)));",
      },
    ],
  };
}

// Vite 는 HTML 주석을 지우지 않는다. 배포본에서만 걷어 낸다.
function stripHtmlComments(): Plugin {
  return {
    name: "strip-html-comments",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler: (html) => html.replace(/<!--(?!\[if)[\s\S]*?-->/g, "").replace(/\n\s*\n+/g, "\n"),
    },
  };
}

// 셰이더는 JS 문자열이라 압축기가 주석을 남긴다. `/* glsl */` 표시가 붙은 템플릿만 줄인다.
function minifyGlsl(): Plugin {
  const GLSL_TEMPLATE = /\/\* glsl \*\/\s*`([^`]*)`/g;
  return {
    name: "minify-glsl",
    apply: "build",
    transform(code, id) {
      if (!/\.tsx?$/.test(id) || !code.includes("/* glsl */")) return null;
      const minified = code.replace(GLSL_TEMPLATE, (_, body: string) => {
        const stripped = body
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/\/\/[^\n]*/g, "")
          .replace(/[ \t]+/g, " ")
          .replace(/\s*\n\s*/g, "\n")
          .trim();
        return "`" + stripped + "`";
      });
      return { code: minified, map: null };
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react(), devErrorCollector(), stripHtmlComments(), minifyGlsl()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  // 본편 5173 · naju01 5174 · website 5175. 포트가 물려 있으면 옆 포트로 옮기지 않고 실패한다.
  // /api 는 같은 출처로 보내 백엔드(FastAPI)에 넘긴다. CORS 설정 없이 쿠키·요청이 오간다.
  server: {
    port: 5175,
    strictPort: true,
    proxy: {
      "/api": { target: "http://127.0.0.1:8000", changeOrigin: true },
    },
  },
});
