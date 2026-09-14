// ═══════════════════════════════════════════════════════════════
//  바닥결.js — 땅·비탈·길·절벽에 **결(texture)** 을 얹는다
// ═══════════════════════════════════════════════════════════════
// [무엇이 문제였나]
//   실측: 바닥이란 바닥이 전부 **uv 없음 · 텍스처 없음**이었다.
//     땅 71,138 삼각형(0.34 m 격자) · 절벽면 26,340(0.09 m) · z.지오 31,168
//     — 모양은 충분히 촘촘한데 표면에 **결이 하나도 없다.**
//   그래서 곡선도 단차도 다 있는데 **단색 색판**으로 읽혔다.
//   「그래픽 질감이 원소스 로비보다 뒤떨어진다」의 큰 몫이 이것이다.
//
// [왜 이미지 텍스처를 안 쓰나]
//   이 저장소의 바닥은 전부 `deleteAttribute("uv")` 를 거친다 — 지오메트리를
//   합치려면 속성 구성이 같아야 하고(`mergeGeometries` 는 다르면 조용히
//   null 을 돌려준다), 그 규칙 때문에 uv 를 다 떼어 냈다.
//   uv 를 되살리려면 지형·통로·절벽 생성기를 전부 고쳐 언랩해야 한다.
//   **삼면(triplanar)은 uv 가 필요 없다** — 월드 좌표로 바로 계산한다.
//   유기적인 지형에는 원래 이 방식이 맞기도 하다(언랩 이음매가 없다).
//
// [무엇을 얹나 — 셋]
//   ① 얼룩   여러 크기의 노이즈를 겹쳐 밝기를 흔든다. 단색 판을 깬다.
//   ② 결     잔 노이즈로 법선을 살짝 흔든다. 빛이 표면을 읽게 한다.
//   ③ 경사   **가파른 면일수록 바위처럼** 어둡고 거칠게. 평평한 데는 흙·풀.
//            `normal.y` 하나로 갈린다 — 절벽·비탈이 공짜로 달라진다.
//
// [★ 셰이더 안은 전부 ASCII]
//   GLSL 은 한글 식별자를 못 쓴다(번들은 통과하고 **GPU 에서 깨진다**).
//   `물잔결.js` 머리말에 적어 둔 그대로다. 설명은 바깥 JS 주석에 남긴다.
//   ※ **적어 두고도 밟았다.** 길 결을 넣으며 `float 채도 = …` 이라고 썼다가
//     `ERROR: '?' : syntax error` 로 프래그먼트가 통째로 안 컴파일됐다.
//     지오메트리 **속성 이름**도 같다 — three 가 그 이름을 그대로 `attribute`
//     선언에 넣는다(그래서 `길결` 이 아니라 `gilGyeol` 이다).
//     막는 것은 **식별자와 속성 이름**이다 — 변수·함수·attribute.
//     주석은 전처리기가 떼므로 한글이어도 된다(이 파일이 그렇게 돌고 있다).
//
// [★ `customProgramCacheKey` 를 반드시 준다]
//   안 주면 three 가 같은 종류 재질끼리 프로그램을 재활용해, 결을 안 건
//   무리(나무·바위 인스턴스)까지 이 셰이더를 물려받는다. 실제로 확인했다.
//
// [단위]  셰이더 안의 좌표는 **미터**다(월드 유닛 ÷ 미터).

import { 미터 } from "./공간도면.js";

const 결식 = /* glsl */ `
  // cheap 3D value noise — no texture lookup, no uv
  float badakHash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float badakNoise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(badakHash(i + vec3(0,0,0)), badakHash(i + vec3(1,0,0)), f.x),
          mix(badakHash(i + vec3(0,1,0)), badakHash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(badakHash(i + vec3(0,0,1)), badakHash(i + vec3(1,0,1)), f.x),
          mix(badakHash(i + vec3(0,1,1)), badakHash(i + vec3(1,1,1)), f.x), f.y),
      f.z);
  }
  // 3 octaves is enough — more costs pixels and adds nothing at this scale
  float badakFbm(vec3 p) {
    return badakNoise(p) * 0.55
         + badakNoise(p * 2.17 + 13.7) * 0.29
         + badakNoise(p * 4.63 + 41.3) * 0.16;
  }
`;

// ── 걸린 재질들을 모아 둔다 ─────────────────────────────────
//   세기를 돌리려면 **모든 바닥 재질**의 uniform 을 같이 바꿔야 한다.
//   바닥 메시가 11 개(땅·절벽면·길×4·비탈×2·연결로·z.지오×2)라
//   ref 를 하나씩 들고 다니면 호출부가 지저분해진다. 여기 모은다.
const 걸린것들 = [];
let 지금세기 = 1;
let 지금바위 = 1;

/** 결 세기를 한 번에 바꾼다. 0 이면 예전과 한 픽셀도 다르지 않다. */
export function 결세기(세기 = 1, 바위 = 1) {
  지금세기 = 세기;
  지금바위 = 바위;
  for (const h of 걸린것들) {
    h.균일.badakAmp.value = 세기;
    h.균일.badakRock.value = 바위;
  }
}

/**
 * 바닥 재질에 결을 끼워 넣는다.
 *   길  true 면 **길 전용 결**을 쓴다(진행 방향으로 늘어난 결 + 바퀴 자국).
 *       길 지오메트리에 `gilGyeol`(진행방향 x, z, 가로자리 u) 속성이 있어야 한다.
 *   재질  three 표준 재질(Lambert · Toon 둘 다 된다)
 *   돌려주는 것 { 균일 } — 세기를 밖에서 돌릴 수 있게 내준다
 *
 * ※ 재질 하나에 한 번만 건다. 두 번 걸면 셰이더가 두 겹으로 붙어 터진다.
 */
export function 결걸기(재질, { 길 = false } = {}) {
  if (!재질) return null;
  if (재질.userData.바닥결걸림) return 재질.userData.바닥결손잡이 ?? null;

  const 균일 = {
    badakAmp: { value: 1 },   // 전체 세기
    badakRock: { value: 1 },  // 경사면을 얼마나 바위처럼 만들까
  };

  재질.onBeforeCompile = (셰) => {
    Object.assign(셰.uniforms, 균일);

    // 월드 좌표를 미터로 넘긴다. `worldPosition` 은 조건부라 직접 만든다.
    셰.vertexShader = 셰.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         varying vec3 vBadakPos;
         ${길 ? "attribute vec3 gilGyeol;\n         varying vec3 vGil;" : ""}`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         vBadakPos = (modelMatrix * vec4(transformed, 1.0)).xyz / ${미터.toFixed(6)};
         ${길 ? "vGil = gilGyeol;" : ""}`,
      );

    셰.fragmentShader = 셰.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         varying vec3 vBadakPos;
         ${길 ? "varying vec3 vGil;" : ""}
         uniform float badakAmp;
         uniform float badakRock;
         ${결식}`,
      )
      // ── ① 얼룩 + ③ 경사 ─────────────────────────────────
      //   `color_fragment` 가 꼭짓점 색을 `diffuseColor` 에 실은 **직후**에 끼운다.
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
         {
           vec3 p = vBadakPos;
           float blot;
           ${
             길
               ? `
           // ── 길 ──
           //   진행 방향으로 **늘인** 결. 바퀴·발이 지나간 자국은 길을 따라
           //   길게 끌린다. 흙바닥과 같은 둥근 얼룩을 주면 그냥 흙판이 된다.
           vec2 dir = normalize(vGil.xy + vec2(1e-5));
           vec2 side = vec2(-dir.y, dir.x);
           float along = dot(p.xz, dir);
           float across = dot(p.xz, side);
           // 세로(진행) 6 배로 늘이고 가로는 촘촘하게 — 끌린 자국이 된다
           blot = (badakFbm(vec3(along * 0.16, p.y * 0.4, across * 1.05)) - 0.5) * 0.34
                + (badakFbm(vec3(along * 0.55, p.y * 0.4, across * 3.1) + 9.0) - 0.5) * 0.30;
           // ★ 바퀴 자국 둘 — 걷는 폭의 |u| ≈ 0.5 에 다져진 띠가 난다.
           //   가운데(u=0)는 발이 모이는 자리라 한 번 더 밝다.
           float u = vGil.z;
           float rut = exp(-pow((abs(u) - 0.5) / 0.17, 2.0));
           float mid = exp(-pow(u / 0.22, 2.0));
           // 자국을 따라 끊기게 — 연속한 띠면 레일처럼 보인다
           float broken = badakFbm(vec3(along * 0.5, 0.0, 0.0) + 31.0) * 0.6 + 0.55;
           blot -= rut * 0.18 * broken;
           blot += mid * 0.10;`
               : `
           // ── 흙·풀·자갈 ──
           // ★ **큰 무늬를 키우면 안 된다.** 처음에 6 m 짜리 얼룩을 0.62 로
           //   줬더니 바닥에 **기름때 같은 검은 아메바**가 앉았다(사용자 지적:
           //   「얼룩덜룩 검정색 점이 기괴하다」). 실제 흙바닥은 멀리서 보면
           //   거의 고르고, 눈에 드는 변화는 **발밑의 잔 결**이다.
           //   그래서 무게를 큰 것 → 작은 것으로 옮긴다.
           float wide = badakFbm(p * 0.17);
           float mid  = badakFbm(p * 0.62 + 7.3);
           float fine = badakFbm(p * 2.9 + 21.1);
           blot = (wide - 0.5) * 0.16 + (mid - 0.5) * 0.24 + (fine - 0.5) * 0.34;
           // ★ 바탕색으로 **무엇인지** 알아낸다 — 새 자료가 필요 없다.
           //   자갈밭은 잿빛(채도 낮음) · 들판은 초록 · 나머지는 흙.
           //   구역마다 결이 달라야 「다른 재료」로 읽힌다.
           float mx = max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b);
           float mn = min(min(diffuseColor.r, diffuseColor.g), diffuseColor.b);
           float sat = mx > 0.001 ? (mx - mn) / mx : 0.0;
           float gravel = smoothstep(0.22, 0.08, sat);                       // 잿빛일수록 1
           float grass = smoothstep(0.02, 0.14, diffuseColor.g - diffuseColor.r);
           // 자갈 — 알갱이. 아주 잔 노이즈를 세게 넣으면 낱알로 읽힌다.
           //   ※ 생 노이즈(badakNoise)를 세게 넣었더니 **네모난 검은 점**이
           //     찍혔다 — 값 노이즈라 격자가 그대로 보인다. fbm 으로 부드럽게.
           blot += (badakFbm(p * 4.2) - 0.5) * 0.34 * gravel;
           // 풀 — 잔 결을 성기게, 대신 포기 단위(0.5 m)로 뭉친다
           blot += (badakFbm(p * 1.9 + 3.3) - 0.5) * 0.26 * grass;`
           }
           // 가파를수록 바위 — 평평한 데(ny=1)는 0, 선 면(ny=0)은 1
           float steep = clamp(1.0 - abs(normalize(vNormal).y), 0.0, 1.0);
           steep = smoothstep(0.25, 0.75, steep) * badakRock;
           // 바위 면은 세로로 긁힌 결이 난다 — 물이 흘러내린 자국
           float streak = badakFbm(vec3(p.x * 3.4, p.y * 0.55, p.z * 3.4) + 5.0);
           blot += (streak - 0.5) * 0.30 * steep;
           // ★ **반드시 조인다.** 겹친 항이 다 같은 쪽으로 몰리면 blot 이
           //   ±1.1 까지 갔고, 밝기가 **0.19 배**까지 떨어져 새까맣게 탔다.
           //   실제 흙바닥의 명암 폭은 ±15 % 남짓이다.
           blot = clamp(blot, -0.42, 0.42);
           // 밝기만 흔든다. 색상은 안 건드린다 — 꼭짓점 색이 정한 색을 지키고
           //   **명암만** 준다. 흙은 흙색, 풀은 풀색 그대로다.
           diffuseColor.rgb *= 1.0 + blot * 0.30 * badakAmp;
           // 가파른 면은 한 톤 더 가라앉힌다(바위는 흙보다 어둡다)
           diffuseColor.rgb *= 1.0 - steep * 0.09 * badakAmp;
         }`,
      )
      // ── ② 결로 법선 흔들기 ──────────────────────────────
      .replace(
        "#include <normal_fragment_begin>",
        `#include <normal_fragment_begin>
         {
           vec3 p = vBadakPos * 3.1;
           float e = 0.35;
           float n0 = badakNoise(p);
           float nx = badakNoise(p + vec3(e, 0.0, 0.0));
           float nz = badakNoise(p + vec3(0.0, 0.0, e));
           // 2.4 → 1.1. 세게 주면 평평한 바닥이 **우둘투둘한 금속**처럼 번들거린다.
           vec2 g = vec2(nx - n0, nz - n0) * 1.1 * badakAmp;
           normal = normalize(normal + vec3(-g.x, 0.0, -g.y));
         }`,
      );
  };
  // ★ 길과 아닌 것은 **셰이더가 다르다.** 키를 같이 두면 three 가 프로그램을
  //   재활용해 길 셰이더가 땅에 붙거나(gilGyeol 이 없어 깨진다) 그 반대가 된다.
  재질.customProgramCacheKey = () => (길 ? "바닥결.길" : "바닥결");
  재질.needsUpdate = true;

  const 손잡이 = { 균일 };
  걸린것들.push(손잡이);
  // 이미 정해 둔 세기가 있으면 새 재질에도 바로 먹인다
  손잡이.균일.badakAmp.value = 지금세기;
  손잡이.균일.badakRock.value = 지금바위;
  재질.userData.바닥결걸림 = true;
  재질.userData.바닥결손잡이 = 손잡이;
  return 손잡이;
}

// ── 재질 ref 에 그대로 물릴 수 있는 콜백 ────────────────────
//   `바닥셰이딩` 손잡이로 램버트↔툰을 바꾸면 재질이 새로 생긴다.
//   그때 ref 콜백이 다시 불리므로 새 재질에도 자동으로 걸린다.
//   `상자` 를 주면 거기에 손잡이를 담아 둔다(세기를 매 프레임 넣을 때 쓴다).
export function 바닥결참조(상자 = null, 옵션 = {}) {
  return (재질) => {
    if (!재질) return;
    const h = 결걸기(재질, 옵션);
    if (상자) 상자.current = h;
  };
}
