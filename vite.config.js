import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
  server: { port: 5173, strictPort: true },
})
