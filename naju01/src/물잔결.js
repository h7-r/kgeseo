// ═══════════════════════════════════════════════════════════════
//  물잔결.js — 수면의 **잔물결을 픽셀마다** 만든다
// ═══════════════════════════════════════════════════════════════
// [무엇이 문제였나]
//   `강.js` 의 수면은 이미 흐른다 — 잔물결 셋 + 긴 너울을 **꼭짓점마다**
//   계산해 매 프레임 밀어 올린다. 문제는 그 격자가 **1 m 당 0.6칸**,
//   즉 1.7 m 간격이라는 것이다. 그보다 잔 물결은 담을 자리가 없다.
//   격자를 촘촘히 하면 꼭짓점이 제곱으로 불어나고(지금도 2.4 만 개를
//   매 프레임 훑는다), 그 비용은 전부 CPU 가 문다.
//
// [그래서 무엇을 하나]
//   **기하는 그대로 두고 법선만 픽셀마다 흔든다.**
//   큰 물결(너울·잔물결 셋)은 지금처럼 CPU 가 꼭짓점을 밀어 올린다 —
//   물가 선이 실제로 오르내려야 하고, 그 자리에 **왜곡 장치**가 걸려 있다.
//   그 위에 훨씬 잔 물결 셋을 **프래그먼트 셰이더**에서 얹는다.
//   꼭짓점은 한 개도 안 늘고, 격자 간격의 제약을 아예 받지 않는다.
//
// [★ 왜곡 장치를 그대로 지킨다]
//   ④ Scene 01 §3 의 「물소리와 물결의 방향이 어긋난다」가 이 수면에 걸려
//   있다(`강.js` 의 `갱신(시각, 어긋남)` — `너울뒤집기`·`옆끌림`).
//   여기 얹는 잔결도 **같은 `옆끌림` 을 받는다.** 안 그러면 너울만 어긋나고
//   잔물결은 멀쩡해서, 가까이 보면 위화감이 반만 온다.
//   ※ 영상·gif 로 바꾸면 이 장치가 통째로 죽는다. 그래서 안 바꾼다.
//
// [왜 `onBeforeCompile` 인가]
//   수면은 `vertexColors` 로 깊이·마루 색을 싣고, 씬의 다른 것들과 **같은
//   램버트/툰 조명**을 받아야 한다. 재질을 새로 짜면 그 둘을 다시 만들어야
//   하고 화풍이 겉돈다. three 의 셰이더에 **몇 줄만 끼워 넣는** 편이 싸다.
//
// [★ 셰이더 안은 전부 ASCII 다 — 이 파일에서 유일한 예외]
//   이 저장소는 식별자를 한글로 쓴다. 그런데 **GLSL 은 한글 식별자를 못 쓴다**
//   (GLSL ES 명세상 이름은 [A-Za-z_][A-Za-z0-9_]* 뿐이다). 한글로 적으면
//   번들은 통과하고 **GPU 에서 컴파일이 깨진다** — 화면이 그대로 검어진다.
//   그래서 `/* glsl */` 안쪽만 ASCII 로 적고, 무엇을 하는지는 **바깥 JS
//   주석**에 한글로 남긴다. 셰이더 주석도 ASCII 로 둔다(드라이버마다
//   비ASCII 주석을 다루는 방식이 다르다).
//
// [단위]  셰이더 안의 x·z 는 **미터**다(월드 유닛 ÷ 미터). `강.js` 의 CPU
//   물결이 미터로 계산하므로 두 식의 주기가 같은 자에 놓인다.

import { 미터 } from "./공간도면.js";

// ── 잔결 파형 ───────────────────────────────────────────────
// [무엇을 돌려주나]  `vec3(높이, dx, dz)` — 높이는 안 쓰고 기울기만 쓴다.
//   법선을 흔드는 데는 기울기면 충분하고, 기울기는 sin 의 도함수라 공짜다.
// [왜 셋을 겹치나]  하나면 규칙적인 빨래판이고 둘이면 격자무늬가 보인다.
//   주기가 서로 안 맞는 셋을 겹쳐야 무늬가 안 잡힌다(`강.js` 와 같은 생각).
// [왜 이 주파수인가]  CPU 물결의 가장 잔 것이 `(x + z) * 1.7` 이다.
//   그 위를 메우는 것이 목적이라 3.1 ~ 7.3 으로 잡았다 — 파장으로 치면
//   2 m → 0.9 m 다. 격자(1.7 m)로는 절대 못 담는 범위다.
const 잔결식 = /* glsl */ `
  // one ripple: returns (height, dHeight/dx, dHeight/dz)
  vec3 mulJanGyeol(vec2 p, vec2 dir, float freq, float speed, float amp, float t) {
    float ph = dot(p, dir) * freq + t * speed;
    return vec3(
      sin(ph) * amp,
      cos(ph) * freq * dir.x * amp,
      cos(ph) * freq * dir.y * amp
    );
  }
`;

/**
 * 수면 재질에 잔결을 끼워 넣는다.
 *   재질  three 의 표준 재질(Lambert · Toon 둘 다 된다)
 *   돌려주는 것 { 갱신(시각, 어긋남, 세기) } — 매 프레임 부른다
 *
 * ※ 재질 하나에 한 번만 건다. 두 번 걸면 셰이더가 두 겹으로 붙어 터진다.
 */
export function 잔결걸기(재질) {
  if (!재질) return null;
  if (재질.userData.잔결걸림) return 재질.userData.잔결손잡이 ?? null;

  const 균일 = {
    mulTime: { value: 0 },
    mulAmp: { value: 1 },
    // ★ 왜곡 — `강.js` 의 `옆끌림` 과 같은 값을 받는다(머리말 참고)
    mulDrag: { value: 0 },
  };

  재질.onBeforeCompile = (셰) => {
    Object.assign(셰.uniforms, 균일);

    // ── 꼭짓점: 월드 XZ 를 미터로 넘긴다 ──────────────────
    //   three 의 `worldPosition` 은 환경맵·그림자 등이 켜졌을 때만 생긴다
    //   (`#include <worldpos_vertex>` 가 조건부다). 믿지 않고 직접 만든다.
    셰.vertexShader = 셰.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         varying vec2 vMulXZ;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         vMulXZ = (modelMatrix * vec4(transformed, 1.0)).xz / ${미터.toFixed(6)};`,
      );

    // ── 조각(픽셀): 법선을 흔든다 ─────────────────────────
    //   `normal_fragment_begin` 이 `normal` 을 정해 준 **직후**에 끼운다.
    //   그 뒤의 조명 계산이 흔들린 법선을 그대로 받는다.
    셰.fragmentShader = 셰.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         varying vec2 vMulXZ;
         uniform float mulTime;
         uniform float mulAmp;
         uniform float mulDrag;
         ${잔결식}`,
      )
      .replace(
        "#include <normal_fragment_begin>",
        `#include <normal_fragment_begin>
         {
           // sideways drag: same knob the CPU ripple p2 uses (x * (0.15 + drag))
           vec2 push = vec2(mulDrag, 0.0);
           vec3 w1 = mulJanGyeol(vMulXZ, normalize(vec2( 0.92,  0.39) + push), 3.1, -2.7, 0.055, mulTime);
           vec3 w2 = mulJanGyeol(vMulXZ, normalize(vec2(-0.54,  0.84) + push), 4.7,  3.3, 0.038, mulTime);
           vec3 w3 = mulJanGyeol(vMulXZ, normalize(vec2( 0.31, -0.95) + push), 7.3, -4.4, 0.022, mulTime);
           // tilt the existing normal by the summed slope (do not replace it)
           vec2 slope = vec2(w1.y + w2.y + w3.y, w1.z + w2.z + w3.z) * mulAmp;
           normal = normalize(normal + vec3(-slope.x, 0.0, -slope.y));
         }`,
      );
  };
  // 셰이더를 고쳤으니 프로그램을 다시 만들게 한다.
  //   ※ `customProgramCacheKey` 를 안 주면 three 가 **같은 재질 종류끼리
  //     프로그램을 재활용**해, 잔결 없는 땅·언덕까지 이 셰이더를 물려받는다.
  재질.customProgramCacheKey = () => "물잔결";
  재질.needsUpdate = true;

  const 손잡이 = {
    // ※ `균일` 을 그대로 내준다 — 값이 정말 바뀌는지 **밖에서 확인**할 수
    //   있어야 한다. 셰이더 uniform 은 컴파일 뒤 프로그램 안에 숨어서,
    //   내주지 않으면 「걸리긴 했는데 값이 가는가」를 잴 방법이 없다
    //   (왜곡 장치가 잔결까지 닿는지 확인하다 막혀서 뚫었다).
    균일,
    // 매 프레임 — `강.js` 의 `갱신` 을 부르는 바로 그 자리에서 같이 부른다.
    갱신(시각, 어긋남 = null, 세기 = 1) {
      균일.mulTime.value = 시각;
      균일.mulAmp.value = 세기;
      균일.mulDrag.value = 어긋남 ? 어긋남.옆끌림 : 0;
    },
  };
  재질.userData.잔결걸림 = true;
  재질.userData.잔결손잡이 = 손잡이;
  return 손잡이;
}

// ── 재질 ref 에 그대로 물릴 수 있는 콜백을 만든다 ───────────
//   `바닥셰이딩` 손잡이로 램버트↔툰을 바꾸면 재질이 **새로 생긴다.**
//   그때 ref 콜백이 다시 불리므로, 새 재질에도 자동으로 걸린다.
export function 물잔결참조(참조상자) {
  return (재질) => {
    if (!재질) return;
    참조상자.current = 잔결걸기(재질);
  };
}
