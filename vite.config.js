import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs/promises'

// ── 나주 편집 읽기 (본편 5173 서버에서도 나주 맵을 열 수 있게) ──────────
// [왜 여기 있나]
//   나주 맵(naju01)은 손으로 놓은 배치를 `naju01/에셋/편집.json` 에서 읽는다
//   (naju01/src/배치.js 의 편집읽기 → GET /__naju-edit). 원래는 naju 전용
//   개발서버(5174)의 `편집저장` 플러그인만 그 주소를 내줬다.
//   이제 텔레포트가 본편(5173) 안의 /naju01/ 로 바로 넘어가므로, 5173 서버도
//   이 주소를 내줘야 손 배치가 그대로 보인다. 없으면 배치가 초기값으로 되돌아간다.
// [읽기만 둔다]
//   저장(POST)은 나주 담당이 5174(`npx vite naju01`)에서 한다. 본편에서 편집기로
//   저장을 시도하면 배치.js 가 "저장 기능이 없다"고 곱게 알린다.
//   원본(저장까지 포함)은 naju01/vite.config.js 의 `편집저장` 플러그인이다.
const 나주편집파일 = fileURLToPath(new URL('./naju01/에셋/편집.json', import.meta.url))
function 나주편집읽기() {
  return {
    name: 'naju-편집읽기',
    apply: 'serve',
    configureServer(서버) {
      서버.middlewares.use(async (req, res, next) => {
        const 길 = (req.url ?? '').split('?')[0]
        if (길 !== '/__naju-edit') return next()
        if (req.method !== 'GET') return next()
        res.setHeader('Content-Type', 'application/json')
        try {
          res.end(await fs.readFile(나주편집파일, 'utf8'))
        } catch {
          res.end('{"지움":{},"고침":{}}')
        }
      })
    },
  }
}

// ── leva 의 값 읽기 고치기 ────────────────────────────────────
// [무엇이 문제인가 — 실측]
//   leva 의 `useValuesForPath` 는 자기 폴더 값 몇 개를 읽으려고
//   `{...initialData, ...s.data}` 로 **스토어 전체를 통째로 복사**한다.
//   본부실은 Leva 입력이 1,190개(폴더 96개)라 한 번에 1,190개 복사다.
//   게다가 이 selector 는
//     · 스토어가 바뀔 때마다 — 구독자 96개 전원이 (zustand 의 listeners.forEach, 동기)
//     · 리렌더될 때마다   — selector 가 매번 새 화살표라 캐시가 안 먹어서 또
//   돈다. 슬라이더 **한 칸에 전체 복사가 약 185번**이다.
//   실측: 동기 구간만 12.9 ms(중앙값 30회). 슬라이더 20칸을 끌면 7초가 걸리고
//   그동안 5fps 로 떨어진다 — 사용자가 "갑자기 느려졌다"고 한 것의 절반이 이것이다.
//
// [왜 이렇게 고치면 결과가 같은가]
//   `getValuesForPaths(data, paths)` 는 `pick(data, paths)` 로 **paths 만** 읽는다.
//   그리고 병합에서 `s.data` 가 `initialData` 를 덮는다. 그러니 paths 가 전부
//   `s.data` 에 있으면 **그 경로들의 값은 병합 결과와 완전히 같다.**
//   병합이 정말 필요한 건 마운트 첫 렌더(아직 store.addData 가 안 돈 순간)뿐이고,
//   그때는 원래대로 병합한다. → 값은 한 글자도 안 달라지고 복사만 사라진다.
//
// [왜 node_modules 를 직접 안 고치나]
//   `npm i` 한 번에 날아간다. 이 저장소가 이미 쓰는 Vite 플러그인 방식이 자국이 적다.
//
// ★ leva 를 올리면 아래 문자열이 안 맞을 수 있다. 조용히 안 먹는 게 제일 나쁘므로
//   못 찾으면 **빌드를 실패**시킨다.
// ★ 고친 뒤에는 `rm -rf node_modules/.vite` 를 해야 한다 — leva 는 사전 번들
//   (optimizeDeps) 대상이라 캐시가 남아 있으면 이 플러그인이 안 먹는다.
function 레바값읽기고치기() {
  const 원본 =
    "const data = _objectSpread2(_objectSpread2({}, initialData), s.data);\n" +
    "    return getValuesForPaths(data, paths);"
  const 고침 =
    "for (let i = 0; i < paths.length; i++) {\n" +
    "      if (!Object.prototype.hasOwnProperty.call(s.data, paths[i])) {\n" +
    "        return getValuesForPaths(_objectSpread2(_objectSpread2({}, initialData), s.data), paths);\n" +
    "      }\n" +
    "    }\n" +
    "    return getValuesForPaths(s.data, paths);"
  return {
    name: 'leva-값읽기-고치기',
    enforce: 'pre',
    transform(코드, id) {
      if (!id.includes('/leva/dist/leva.esm.js')) return null
      if (!코드.includes(원본)) {
        this.error('[leva-값읽기] 고칠 자리를 못 찾았다 — leva 판이 바뀌었는지 보라')
      }
      return { code: 코드.replace(원본, 고침), map: null }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [레바값읽기고치기(), react(), 나주편집읽기()],
  // ── 포트를 못 박는다 ──────────────────────────────────────
  // [왜 strictPort 가 필요한가]
  //   포트를 안 적으면 vite 는 5173 을 쓰되, **이미 물려 있으면 말없이 5174 로
  //   옮겨 붙는다.** 5174 는 naju01 그레이박스 전용이라, 그때부터 둘이 서로
  //   엉뚱한 화면을 보게 된다.
  //
  // [왜 그게 단순한 불편이 아닌가]
  //   Leva 저장값은 localStorage 에 들어가고, localStorage 는 **출처(origin)별**
  //   로 갈린다. localhost:5173 과 localhost:5174 는 다른 출처다.
  //   공용.jsx 가 쓰는 키는 `kgeseo.leva.v1` 하나뿐이라(폴더 이름으로만 나눈다),
  //   포트가 밀리면 맞춰 둔 값이 **통째로 사라진 것처럼 보인다.**
  //
  //   strictPort 를 켜면 5173 이 막혔을 때 옮겨 붙지 않고 그냥 실패한다.
  //   "왜 값이 다 날아갔지" 보다 "포트가 물렸다" 가 훨씬 고치기 쉬운 오류다.
  // ── 나주(naju01)를 서버 시작 때 미리 묶고 데워 둔다 ──────────────
  //   목적: 나주로 "처음" 들어갈 때의 긴 멈춤("응답 없는 페이지")을 없앤다.
  optimizeDeps: {
    // 두 앱(본편·나주)의 의존성을 서버 켤 때 함께 훑어 한 번에 묶는다.
    //   안 그러면 나주 첫 진입 때 vite 가 새 의존성을 발견해 다시 묶으면서
    //   페이지를 새로고침한다 — 그게 첫 로딩이 유난히 오래 걸리는 주범이다.
    entries: ["index.html", "naju01/index.html"],
  },
  server: {
    port: 5173,
    strictPort: true,
    // 나주 씬 모듈을 서버 켤 때 미리 변환(warmup)해 둔다.
    //   기본 dev 서버는 요청이 와야 그 파일을 변환한다. 나주는 파일이 많고 무거워
    //   첫 요청에서 통째로 변환하느라 멈춘다. 미리 데워 두면 첫 진입이 빨라진다.
    //   (서버 시작이 조금 느려지는 대신, 켠 뒤 아무 때나 빠르게 들어간다.)
    warmup: {
      clientFiles: [
        "./naju01/src/main.jsx",
        "./naju01/src/scenes/공간그레이박스.jsx",
      ],
    },
    // 백엔드(FastAPI, backend/) 로 /api 요청을 넘긴다 — feature/sejin-backend-integration
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
