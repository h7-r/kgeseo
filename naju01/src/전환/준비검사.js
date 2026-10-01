// 준비검사.js — 「정말 다 떴나」를 판정한다. 로딩 영상(로딩영상.jsx)은 이게 「됐다」 할 때만 걷힌다.
//
// [왜 이렇게까지 하나] (사용자 지시)
//   「렌더 다 돼서 진입할 때 절대 하나라도 늦게 뜨거나 아직 준비 중이면 안 된다 —
//    특히 나주 맵 · 본부실」.
//   그런데 「파일을 다 받았다」는 시작일 뿐이다. 영상이 걷힌 **뒤에** 늦게 뜨는 것들은 대개 이렇다.
//     ① 받은 파일을 **해석**하고 상태를 바꾸는 사이(구운 모형이 「됨」 이 되며 갈아 끼워지는 순간)
//     ② 처음 보는 재질의 **셰이더 컴파일**(수백 ms 멈춤) — 화면 밖(본부실 벽 뒤)에 있으면 걷힌 뒤에야 컴파일된다
//     ③ 텍스처·지오메트리를 GPU 로 **올리는** 일 — 카메라에 안 잡힌 물체는 처음 보이는 순간 올라간다
//     ④ 늦게 붙는 화면 조각(lazy 컴포넌트) · 글꼴 · Leva 가 뒤늦게 올리는 저장값
//   그래서 아래 **네 관문을 차례로 모두 통과**해야 「됐다」 고 한다. 중간에 하나라도 흔들리면 처음부터 다시 본다.
//
//   관문 1 · 조용함   0.8초 동안 아무것도 안 받는다
//                      · three 로딩 관리자(GLTFLoader · TextureLoader 전부 거친다)가 쉬고 있다
//                      · 모델·그림 파일 요청(fetch/XHR)이 하나도 안 걸려 있다
//                      · 새로 받아진 파일(스크립트 조각 · 그림 포함)이 0.8초째 없다
//                      · 글꼴이 다 왔다 · 화면에 캔버스가 있다 · 누가 「잠깐」(로딩붙잡기)을 걸어 두지 않았다
//   관문 2 · 데우기   씬 **전체**를(안 보이는 것 · 화면 밖 것까지)
//                      · 텍스처를 GPU 에 올리고(initTexture)
//                      · 셰이더를 전부 컴파일하고(compileAsync — 끝날 때까지 기다린다)
//                      · 컬링을 잠깐 끄고 작은 판에 한 번 그려 **지오메트리까지** 올려 둔다
//   관문 3 · 안정      1.5초 동안
//                      · 프레임이 한 번도 크게 끊기지 않았다(평소의 2.5배 · 최소 100ms 넘는 프레임 없음)
//                      · 새 셰이더 프로그램이 하나도 안 생겼다(= 처음 그려지는 물건이 없다)
//                      · 관문 1 조건이 계속 맞다
//   관문 4 · 최소 시간  막이 너무 빨리 걷혀 「번쩍」 이 되지 않게
//   ※ 그래도 안 끝나면 최대 시간 뒤에 걷는다 — 막이 영영 안 걷히는 것이 제일 나쁘다.
//     이때는 콘솔에 **무엇을 기다리다 포기했는지** 남긴다(window.__로딩검사).
//
// [팀원이 쓸 수 있는 손잡이]
//   const 놓기 = 로딩붙잡기("구렁이 굽는 중");  …  놓기();
//   파일을 다 받은 뒤에도 따로 준비할 일이 있으면(워커 계산 · 큰 배열 굽기 등) 이걸 걸어 두면
//   그동안은 막이 안 걷힌다. 이름은 콘솔 진단에 그대로 나온다.
import * as THREE from "three";
import { _roots } from "@react-three/fiber";

// ── 요청 세기 — 모델·그림 파일만 센다(서버 API 같은 건 렌더와 상관없어서 뺀다) ──
const 자원확장자 = /\.(glb|gltf|bin|png|jpe?g|webp|avif|ktx2|basis|hdr|exr|wasm|drc|fbx|obj|mtl|woff2?|ttf|otf)(\?|#|$)/i;
const 걸린요청 = new Map(); // 번호 → 시작 시각
let 요청번호 = 0;
let 마지막받음 = 0; // 마지막으로 파일 하나가 다 받아진 때(performance.now)
let 마지막받은것 = ""; // 진단용 — 그게 무엇이었나
const 붙잡음 = new Map(); // 이름 → 건 횟수

function 자원인가(주소) {
  try { return 자원확장자.test(new URL(String(주소), location.href).pathname); } catch { return false; }
}
/* 전환 영상 자기 자신은 세지 않는다 — 이게 세지면 막이 자기 영상 때문에 안 걷힌다 */
function 전환영상인가(주소) {
  const s = String(주소);
  return s.includes("/전환/") || s.includes("/%EC%A0%84%ED%99%98/");
}

let 깔림 = false;
function 감시깔기() {
  if (깔림 || typeof window === "undefined") return;
  깔림 = true;
  /* fetch — three 의 FileLoader(GLB · bin) 가 이걸 쓴다 */
  const 원래fetch = window.fetch?.bind(window);
  if (원래fetch) {
    window.fetch = (입력, 옵션) => {
      const 주소 = typeof 입력 === "string" ? 입력 : 입력?.url;
      if (!자원인가(주소) || 전환영상인가(주소)) return 원래fetch(입력, 옵션);
      const 번호 = ++요청번호;
      걸린요청.set(번호, performance.now());
      const 끝 = () => { 걸린요청.delete(번호); 마지막받음 = performance.now(); };
      // ★ 응답 머리만 오고 몸통은 아직일 수 있다 — 몸통을 다 읽을 때까지 「걸린 요청」 으로 둔다
      return 원래fetch(입력, 옵션).then((응답) => {
        const 복제 = 응답.clone();
        복제.arrayBuffer().then(끝, 끝);
        return 응답;
      }, (오류) => { 끝(); throw 오류; });
    };
  }
  /* XHR — 오래된 로더들 */
  const 원래열기 = XMLHttpRequest.prototype.open;
  const 원래보내기 = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (방식, 주소, ...나머지) {
    this.__자원 = 자원인가(주소) && !전환영상인가(주소);
    return 원래열기.call(this, 방식, 주소, ...나머지);
  };
  XMLHttpRequest.prototype.send = function (...인자) {
    if (this.__자원) {
      const 번호 = ++요청번호;
      걸린요청.set(번호, performance.now());
      this.addEventListener("loadend", () => { 걸린요청.delete(번호); 마지막받음 = performance.now(); }, { once: true });
    }
    return 원래보내기.apply(this, 인자);
  };
  /* 받아진 파일 전부(스크립트 조각 · 그림 · CSS 포함) — lazy 로 늦게 붙는 화면 조각을 잡는다 */
  try {
    new PerformanceObserver((목록) => {
      for (const 항 of 목록.getEntries()) {
        if (항.initiatorType === "video" || 전환영상인가(항.name)) continue;
        마지막받음 = performance.now();
        마지막받은것 = `${항.initiatorType} ${항.name.slice(-60)}`;
      }
    }).observe({ type: "resource", buffered: false });
  } catch { /* 옛 브라우저 — 위 둘로 버틴다 */ }
}
감시깔기(); // 이 파일을 읽는 순간(= main.jsx 가 뜨는 순간) 깔아야 첫 요청부터 센다

/** 따로 준비할 일이 있는 동안 막을 붙잡아 둔다. 돌려받은 함수를 부르면 놓는다(두 번 불러도 한 번만). */
export function 로딩붙잡기(이름 = "이름 없음") {
  붙잡음.set(이름, (붙잡음.get(이름) || 0) + 1);
  let 놓음 = false;
  return () => {
    if (놓음) return;
    놓음 = true;
    const n = (붙잡음.get(이름) || 1) - 1;
    if (n <= 0) 붙잡음.delete(이름); else 붙잡음.set(이름, n);
  };
}

// ── 지금 화면에 있는 R3F 캔버스들 ─────────────────────────────
function 캔버스들() {
  const 결과 = [];
  try {
    _roots.forEach((뿌리, 캔버스) => {
      if (!캔버스?.isConnected) return;
      const 상태 = 뿌리?.store?.getState?.();
      if (상태?.gl && 상태?.scene && 상태?.camera) 결과.push(상태);
    });
  } catch { /* R3F 내부가 바뀌었으면 캔버스 유무만 본다 */ }
  return 결과;
}

/** 관문 1 — 지금 조용한가. 아니면 「무엇 때문에」 를 돌려준다(진단용) */
function 조용한가(읽는중) {
  const 지금 = performance.now();
  for (const [번호, 시작] of 걸린요청) if (지금 - 시작 > 30000) 걸린요청.delete(번호); // 30초 넘게 매달린 요청은 놓아 준다
  if (!document.querySelector("canvas")) return "캔버스 없음";
  if (캔버스들().length === 0) return "3D 준비 전";
  if (읽는중()) return "모델 · 텍스처 받는 중";
  if (걸린요청.size) return `파일 ${걸린요청.size}개 받는 중`;
  if (지금 - 마지막받음 < 800) return `파일 막 받음(${마지막받은것})`;
  if (document.fonts && document.fonts.status !== "loaded") return "글꼴 받는 중";
  if (붙잡음.size) return `준비 중: ${[...붙잡음.keys()].join(", ")}`;
  return null;
}

/** 관문 2 — 씬 전체를 GPU 에 미리 올리고 컴파일한다 */
async function 데우기() {
  const 판 = new THREE.WebGLRenderTarget(4, 4);
  for (const { gl, scene, camera } of 캔버스들()) {
    // ① 텍스처 — 재질의 모든 칸(map · normalMap …)과 셰이더 uniform 을 뒤져 GPU 에 올린다
    const 텍스처들 = new Set();
    const 재질들 = new Set();
    scene.traverse((o) => {
      const m = o.material;
      if (!m) return;
      (Array.isArray(m) ? m : [m]).forEach((재질) => 재질 && 재질들.add(재질));
    });
    재질들.forEach((재질) => {
      for (const 값 of Object.values(재질)) if (값 && 값.isTexture) 텍스처들.add(값);
      if (재질.uniforms) for (const u of Object.values(재질.uniforms)) if (u?.value?.isTexture) 텍스처들.add(u.value);
    });
    텍스처들.forEach((t) => { try { gl.initTexture(t); } catch { /* 비디오·캔버스 텍스처 등 */ } });

    // ② 셰이더 — 숨은 것까지 전부. 병렬 컴파일 확장이 있으면 끝날 때까지 기다린다
    try {
      if (gl.compileAsync) await gl.compileAsync(scene, camera);
      else gl.compile(scene, camera);
    } catch (e) { console.warn("[로딩검사] 셰이더 미리 컴파일 실패 — 계속 간다", e); }

    // ③ 지오메트리 — 화면 밖 물체는 아직 GPU 에 안 올라가 있다. 컬링을 잠깐 끄고
    //    4×4 짜리 보이지 않는 판에 **한 번** 그려 모든 버퍼를 올린다(화면에는 안 나온다).
    const 껐던것 = [];
    scene.traverse((o) => { if (o.frustumCulled) { o.frustumCulled = false; 껐던것.push(o); } });
    const 원래판 = gl.getRenderTarget();
    const 원래자동 = gl.autoClear;
    try {
      gl.setRenderTarget(판);
      gl.autoClear = true;
      gl.render(scene, camera);
    } catch (e) {
      console.warn("[로딩검사] 미리 그리기 실패 — 계속 간다", e);
    } finally {
      gl.setRenderTarget(원래판);
      gl.autoClear = 원래자동;
      껐던것.forEach((o) => { o.frustumCulled = true; });
    }
  }
  판.dispose();
}

/** 지금 쓰고 있는 셰이더 프로그램 수(새 물건이 처음 그려지면 늘어난다) */
function 프로그램수() {
  return 캔버스들().reduce((합, { gl }) => 합 + (gl.info?.programs?.length ?? 0), 0);
}

/**
 * 「다 떴다」 가 될 때까지 기다린다.
 * @param 읽는중   () => boolean  — three 로딩 관리자가 일하는 중인가(로딩영상.jsx 가 useProgress 로 넘긴다)
 * @param 알림     (글) => void   — 지금 무엇을 기다리는지(막의 작은 상태 글)
 * @param 끊김     () => boolean  — 막이 사라졌으면 그만둔다
 * @returns 「됨」 또는 「시간 초과: …」
 */
export async function 다뜰때까지(읽는중, 알림, 끊김, { 최대 = 60 } = {}) {
  const 시작 = performance.now();
  /* 탭이 숨어 있는 동안은 시간을 안 센다 — 숨은 탭은 그리기를 멈추므로(캔버스조차 안 만들어진다)
     그동안 최대 시간이 흘러 버리면, 돌아왔을 때 덜 뜬 화면으로 막이 걷힌다. */
  let 숨은합 = 0;
  let 숨은때 = document.visibilityState === "hidden" ? performance.now() : null;
  const 보임바뀜 = () => {
    if (document.visibilityState === "hidden") 숨은때 ??= performance.now();
    else if (숨은때 != null) { 숨은합 += performance.now() - 숨은때; 숨은때 = null; }
  };
  document.addEventListener("visibilitychange", 보임바뀜);
  const 흐른초 = () => (performance.now() - 시작 - 숨은합 - (숨은때 != null ? performance.now() - 숨은때 : 0)) / 1000;
  const 남은시간 = () => 최대 - 흐른초();
  const 쉬기 = (ms) => new Promise((r) => setTimeout(r, ms));
  const 프레임 = () => new Promise((r) => requestAnimationFrame(r));
  let 마지막이유 = "";
  const 기록 = (글) => { 마지막이유 = 글; 알림?.(글); window.__로딩검사 = { 기다리는것: 글, 흐른초: 흐른초().toFixed(1) }; };

  let 시도 = 0;
  while (!끊김()) {
    if (남은시간() <= 0) break;
    시도 += 1;

    // 관문 1 — 0.8초 내리 조용해야 한다
    let 조용시작 = null;
    while (!끊김() && 남은시간() > 0) {
      const 이유 = 조용한가(읽는중);
      if (이유) { 조용시작 = null; 기록(이유); }
      else {
        조용시작 ??= performance.now();
        if (performance.now() - 조용시작 >= 800) break;
        기록("마무리 확인 중");
      }
      await 쉬기(100);
    }
    if (끊김() || 남은시간() <= 0) break;

    // 관문 2 — 데우기
    기록("그래픽 데우는 중");
    await 데우기();
    if (끊김()) break;

    // 관문 3 — 1.5초 안정
    기록("화면 안정 확인 중");
    const 사이들 = [];
    const 처음프로그램 = 프로그램수();
    let 깨짐 = null;
    const 창시작 = performance.now();
    let 앞 = performance.now();
    // 1.5초 + 프레임 10장 — 둘 다 채울 때까지(아주 느린 기계는 6초까지 모은다)
    while (!끊김() && (performance.now() - 창시작 < 1500 || 사이들.length < 10) && performance.now() - 창시작 < 6000) {
      await 프레임();
      const 지금 = performance.now();
      사이들.push(지금 - 앞);
      앞 = 지금;
      const 정렬 = [...사이들].sort((a, b) => a - b);
      const 중간 = 정렬[Math.floor(정렬.length / 2)];
      const 한계 = Math.max(100, 중간 * 2.5);
      if (사이들.length > 3 && 사이들[사이들.length - 1] > 한계) { 깨짐 = `프레임 끊김 ${Math.round(사이들[사이들.length - 1])}ms`; break; }
      if (프로그램수() !== 처음프로그램) { 깨짐 = "새 셰이더가 생김(처음 그려지는 물건)"; break; }
      const 이유 = 조용한가(읽는중);
      if (이유) { 깨짐 = 이유; break; }
    }
    if (끊김()) break;
    if (!깨짐 && 사이들.length >= 10) { 기록("됨"); document.removeEventListener("visibilitychange", 보임바뀜); return "됨"; }
    /* 다섯 번째부터는 「끊김 · 새 셰이더」 는 봐준다 — 원래 자주 끊기는 느린 기계거나, 재질을 계속
       새로 만드는 물건이 있으면 영영 안 끝나기 때문이다. **관문 1(다 받았나)과 데우기는 끝까지 지킨다.** */
    if (시도 >= 5 && !조용한가(읽는중)) {
      console.warn(`[로딩검사] 안정 확인을 ${시도}번 넘기지 못했다(${깨짐 || "프레임이 너무 적음"}) — 다 받고 데운 상태라 걷는다`);
      기록("됨"); document.removeEventListener("visibilitychange", 보임바뀜); return "됨";
    }
    기록(깨짐 || "프레임이 너무 적음");
    console.info(`[로딩검사] 안정 확인 ${시도}번째 실패 — ${깨짐 || "프레임이 너무 적음"}`);
    // 깨지면 관문 1 부터 다시 — 새로 생긴 것까지 다시 데운다
  }
  document.removeEventListener("visibilitychange", 보임바뀜);
  const 결과 = `시간 초과: ${마지막이유}`;
  if (!끊김()) console.warn(`[로딩검사] ${최대}초 안에 다 뜨지 않아 막을 걷는다 — 마지막으로 기다리던 것: ${마지막이유}`);
  return 결과;
}
