// ═══════════════════════════════════════════════════════════════
//  미리보기.js — 팔레트 버튼에 넣을 에셋 썸네일
// ═══════════════════════════════════════════════════════════════
// [왜]
//   팔레트가 이름만 늘어놓고 있어서, 「덤불」과 「수풀」이 어떻게 다른지
//   놓아 보기 전에는 알 수 없었다. 눈으로 고를 수 있어야 한다(사용자 지시).
//
// [왜 렌더러를 따로 만드나]
//   본 화면 렌더러를 빌려 쓰면 그 프레임의 렌더 타깃·상태를 건드리게 되고,
//   계기판이 읽는 `gl.info` 통계도 오염된다(삼각형 수가 튄다).
//   썸네일은 **딱 한 번** 굽고 버리면 그만이라, 작은 렌더러를 따로 만들어
//   쓰고 곧바로 `dispose` 한다. WebGL 컨텍스트를 오래 붙들지 않는다.
//
// [색을 어떻게 보여 주나]
//   표본의 꼭짓점 색은 대개 **비율**이다(흰색 = 인스턴스 색 그대로).
//   그래서 `기본색` 이 있으면 그 색을 곱해 준다 — 팔레트에서 본 색이
//   실제로 놓이는 색과 같아야 한다.

import * as THREE from "three";

// 한 벌 구워 두고 돌려쓴다. 두 번 부르면 이미 구운 것을 돌려준다.
let 구운것 = null;

export function 미리보기굽기(에셋목록, 에셋표본, { 크기 = 46 } = {}) {
  if (구운것) return 구운것;
  구운것 = new Map();

  let 렌더러;
  try {
    렌더러 = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true, // toDataURL 을 쓰려면 켜야 한다
    });
  } catch {
    return 구운것; // WebGL 을 하나 더 못 여는 환경 — 썸네일 없이 간다
  }
  렌더러.setSize(크기, 크기, false);
  렌더러.setPixelRatio(2); // 작은 그림이라 두 배로 떠야 글자처럼 또렷하다
  렌더러.setClearColor(0x000000, 0);

  const 씬 = new THREE.Scene();
  // 빛 — 정면에서만 때리면 실루엣이 납작해진다. 위·앞·뒤 셋으로 세운다.
  씬.add(new THREE.AmbientLight(0xffffff, 0.55));
  const 해 = new THREE.DirectionalLight(0xffffff, 1.15);
  해.position.set(1.2, 1.8, 1.4);
  씬.add(해);
  const 뒷빛 = new THREE.DirectionalLight(0xbcd0e8, 0.4);
  뒷빛.position.set(-1.4, 0.6, -1.2);
  씬.add(뒷빛);

  const 카메라 = new THREE.PerspectiveCamera(32, 1, 0.01, 100);
  const 재질 = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.DoubleSide, // 풀·꽃처럼 한 겹짜리도 보여야 한다
  });

  for (const 정의 of 에셋목록) {
    try {
      const 표본들 = 에셋표본(정의.키);
      if (!표본들?.length) continue;
      // 첫 번째 표본을 대표로 쓴다 — 같은 물건의 변주라 하나면 충분하다
      const g = 표본들[0];
      // ★ 표본에 꼭짓점 색이 없으면 `vertexColors` 를 꺼야 한다.
      //   켜 두면 three 가 `USE_COLOR` 를 켜고 없는 속성을 **(0,0,0)** 으로
      //   읽어 통째로 검게 나온다(돌 표본이 그렇다 — 무리 쪽에서는
      //   `배치.js` 의 `흰색깔기` 가 막아 주지만 여기는 그 길을 안 지난다).
      const 메시 = new THREE.Mesh(g, 재질);
      메시.scale.set(
        정의.기본폭비 ?? 1,
        1,
        정의.기본깊이비 ?? 1,
      );
      // 색 — 표본은 비율만 굽혀 있으므로 기본색을 곱해 준다
      메시.material = 재질.clone();
      메시.material.vertexColors = !!g.attributes.color;
      메시.material.color = new THREE.Color(정의.기본색 ?? 0xffffff);
      메시.material.needsUpdate = true;
      씬.add(메시);

      // 물건이 화면을 꽉 채우게 카메라를 물린다.
      //   ※ 표본마다 크기가 제각각(밑동 원점·중심 원점이 섞여 있다)이라
      //     **실제 바운딩 박스**를 보고 맞춰야 한다. 안 그러면 어떤 건
      //     점으로 보이고 어떤 건 화면 밖으로 나간다.
      const 상자 = new THREE.Box3().setFromObject(메시);
      const 중심 = 상자.getCenter(new THREE.Vector3());
      const 크 = 상자.getSize(new THREE.Vector3());
      const 반지름 = Math.max(0.001, Math.max(크.x, 크.y, 크.z) * 0.5);
      const 거리 = (반지름 / Math.sin((카메라.fov * Math.PI) / 360)) * 1.25;
      // 살짝 위에서 비스듬히 — 정면 직각은 도면처럼 보여 부피가 안 읽힌다
      카메라.position.set(
        중심.x + 거리 * 0.62,
        중심.y + 거리 * 0.42,
        중심.z + 거리 * 0.66,
      );
      카메라.lookAt(중심);
      카메라.updateProjectionMatrix();

      렌더러.render(씬, 카메라);
      구운것.set(정의.키, 렌더러.domElement.toDataURL("image/png"));
      씬.remove(메시);
      메시.material.dispose();
    } catch {
      // 한 벌이 실패해도 나머지는 굽는다
    }
  }

  재질.dispose();
  렌더러.dispose();
  렌더러.forceContextLoss?.();
  return 구운것;
}
