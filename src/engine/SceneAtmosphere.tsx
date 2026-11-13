import { useLayoutEffect } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";

interface SceneAtmosphereProps {
  /** 이 씬이 지금 보이는 씬인가 — 켜진 씬만 배경 · 안개를 건다 */
  enabled: boolean;
  background: THREE.ColorRepresentation;
  fogColor: THREE.ColorRepresentation;
  fogNear: number;
  fogFar: number;
}

/**
 * 켜진 씬의 배경 · 안개를 scene 에 직접 건다.
 * 예전에는 `<color attach="background">` · `<fog attach="fog">` 를 켜진 씬만 냈는데, 두 씬이 같은 커밋에서 바뀌면(기차 씬이 이미
 * 마운트된 채 타고 내릴 때) 뒤에 떼는 쪽이 「붙이기 전 값(없음)」으로 되돌려 방금 붙인 것을 지웠다 — 두 번째 탑승부터 기차 안의
 * 배경 · 안개가 사라졌다(11/13 확인). 여기서는 떼지 않는다 — 다음에 켜지는 씬이 제 값으로 덮어쓴다.
 */
export default function SceneAtmosphere({ enabled, background, fogColor, fogNear, fogFar }: SceneAtmosphereProps) {
  const scene = useThree((state) => state.scene);
  useLayoutEffect(() => {
    if (!enabled) return;
    scene.background = new THREE.Color(background);
    scene.fog = new THREE.Fog(fogColor, fogNear, fogFar);
  }, [enabled, scene, background, fogColor, fogNear, fogFar]);
  return null;
}
