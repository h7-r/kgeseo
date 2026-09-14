// ═══════════════════════════════════════════════════════════════
//  미리보기.js — 팔레트 버튼에 넣을 에셋 썸네일
// ═══════════════════════════════════════════════════════════════
// [왜]
//   팔레트가 이름만 늘어놓고 있어서, 「덤불」과 「수풀」이 어떻게 다른지
//   놓아 보기 전에는 알 수 없었다. 눈으로 고를 수 있어야 한다(사용자 지시).
//
// [왜 본 화면 렌더러를 쓰나 — 예전에는 따로 만들었다]
//   처음에는 작은 `WebGLRenderer` 를 따로 만들어 굽고 버렸다. 계기판이 읽는
//   `gl.info` 를 안 건드리려던 것이다. 그런데 그건 **WebGL 컨텍스트를 하나 더
//   여는 일**이다. 브라우저는 동시에 열 수 있는 컨텍스트 수가 정해져 있어,
//   한계에 걸리면 **가장 오래된 것(=본 화면)을 죽인다.** 그러면 화면이
//   통째로 꺼진다. 썸네일 하나 보자고 치를 값이 아니다.
//   지금은 본 렌더러에 **렌더 타깃**을 물려 굽는다. 컨텍스트는 늘 하나다.
//   `gl.info` 는 다음 프레임에 씬이 `reset()` 하므로 오염이 남지 않는다.
//
// [색을 어떻게 보여 주나]
//   표본의 꼭짓점 색은 대개 **비율**이다(흰색 = 인스턴스 색 그대로).
//   그래서 `기본색` 이 있으면 그 색을 곱해 준다 — 팔레트에서 본 색이
//   실제로 놓이는 색과 같아야 한다.

import * as THREE from "three";

// 한 벌 구워 두고 돌려쓴다. 두 번 부르면 이미 구운 것을 돌려준다.
let 구운것 = null;

export function 미리보기굽기(에셋목록, 에셋표본, 렌더러, { 크기 = 46 } = {}) {
  if (구운것) return 구운것;
  구운것 = new Map();
  if (!렌더러) return 구운것; // 아직 렌더러가 없다 — 썸네일 없이 간다

  const 배 = 2; // 작은 그림이라 두 배로 떠야 또렷하다
  const 타깃 = new THREE.WebGLRenderTarget(크기 * 배, 크기 * 배, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    // ★ 렌더 타깃은 기본이 **선형**이라, 그대로 읽어 PNG 로 만들면 통째로
    //   어두워진다(실측: 바위 #5e594f → #1d1914). 캔버스로 그릴 때와 같은
    //   sRGB 로 적어 달라고 못 박는다.
    colorSpace: THREE.SRGBColorSpace,
  });
  // 읽어 낸 픽셀을 그림으로 만들 2D 캔버스 — WebGL 이 아니다
  const 캔 = document.createElement("canvas");
  캔.width = 크기 * 배;
  캔.height = 크기 * 배;
  const 붓 = 캔.getContext("2d");
  const 픽셀 = new Uint8Array(크기 * 배 * 크기 * 배 * 4);
  const 이미지 = 붓.createImageData(크기 * 배, 크기 * 배);
  const 옛타깃 = 렌더러.getRenderTarget();

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

      렌더러.setRenderTarget(타깃);
      렌더러.setClearColor(0x000000, 0);
      렌더러.clear();
      렌더러.render(씬, 카메라);
      렌더러.readRenderTargetPixels(타깃, 0, 0, 캔.width, 캔.height, 픽셀);
      // WebGL 은 아래에서 위로 읽는다 — 뒤집어야 똑바로 선다
      const 줄바이트 = 캔.width * 4;
      for (let y = 0; y < 캔.height; y++) {
        const 원 = (캔.height - 1 - y) * 줄바이트;
        이미지.data.set(픽셀.subarray(원, 원 + 줄바이트), y * 줄바이트);
      }
      붓.putImageData(이미지, 0, 0);
      구운것.set(정의.키, 캔.toDataURL("image/png"));
      씬.remove(메시);
      메시.material.dispose();
    } catch {
      // 한 벌이 실패해도 나머지는 굽는다
    }
  }

  재질.dispose();
  타깃.dispose();
  렌더러.setRenderTarget(옛타깃); // 본 화면이 쓰던 타깃을 돌려준다
  return 구운것;
}
