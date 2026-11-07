import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import { isPointerActive } from "@/engine/input";
import { useSavedControls } from "@/engine/leva/savedControls";
import { toRadians } from "@/engine/math";
import { playerView } from "@/engine/playerView";

import { setHologramAimed } from "./hologramAim";
import {
  drawHologramPanel,
  HOLOGRAM_ACCENT_COLOR,
  HOLOGRAM_CANVAS_HEIGHT,
  HOLOGRAM_CANVAS_WIDTH,
} from "./hologramPanel";
import OutlineMorph from "./OutlineMorph";

/** 저장값 위에 더하는 높이(화면에서 ≈4 px). 저장된 Y 가 기본값을 이겨 기본값을 고쳐서는 안 올라간다. */
const LIFT = 0.03;
/** 이 안에서 겨누면 목적지 창이 열린다 */
const NEAR_DISTANCE = 13;
const SCREEN_CENTER = new THREE.Vector2(0, 0);
const aimRaycaster = new THREE.Raycaster();

interface HologramScreenProps {
  /**
   * 기차 씬이 지금 켜져 있나. 씬이 숨어도 이 컴포넌트는 살아 있고, useFrame 과 R3F 레이캐스트는
   * visible 을 보지 않는다. 스크린 자리가 역 방 안 좌표와 겹쳐, 끄지 않으면 로비 허공 클릭에 나주로 넘어간다.
   */
  enabled?: boolean;
}

/** 텔레포트 장치가 쏘는 안내판 홀로그램. 겨누고 클릭이나 [E] 를 누르면 목적지 창이 열린다(useGameKeys). */
export default function HologramScreen({ enabled = true }: HologramScreenProps) {
  const controls = useSavedControls("홀로그램 스크린", {
    visible: { value: true, label: "보이기" },
    x: { value: -16.4, min: -26, max: 26, step: 0.1, label: "X" },
    // 0.1 유닛이 화면에서 약 19 px 이라 잔조정이 되게 눈금을 잘게 둔다.
    y: { value: 5.0, min: 0, max: 12, step: 0.02, label: "Y" },
    z: { value: 4.0, min: -5, max: 6, step: 0.1, label: "Z" },
    // 안내판이라 크지 않아도 된다. 고르는 일은 화면 창에서 한다.
    width: { value: 6.4, min: 1, max: 16, step: 0.1, label: "폭" },
    rotationX: { value: 0, min: -90, max: 90, step: 1, label: "회전X" },
    rotationY: { value: 180, min: -180, max: 180, step: 1, label: "회전Y" },
    brightness: { value: 1.15, min: 0.2, max: 3, step: 0.05, label: "밝기" },
    /** 홀로그램 미세 떨림 */
    flicker: { value: 0.06, min: 0, max: 0.4, step: 0.01, label: "깜빡임" },
    // 장치에서 스크린으로 쏘아 올라오는 빛
    showBeam: { value: true, label: "빔보이기" },
    /** 스크린 아래로 뻗는 길이 */
    beamLength: { value: 0.3, min: 0, max: 14, step: 0.1, label: "빔길이" },
    beamIntensity: { value: 0.25, min: 0, max: 2, step: 0.05, label: "빔세기" },
    /** 아래로 갈수록 넓어지는 정도 */
    beamSpread: { value: 2.1, min: 0.2, max: 8, step: 0.1, label: "빔퍼짐" },
  });

  const [isAimed, setIsAimed] = useState(false);
  const { camera } = useThree();
  const pointer = useThree((state) => state.pointer);

  const canvas = useMemo(() => {
    const element = document.createElement("canvas");
    element.width = HOLOGRAM_CANVAS_WIDTH;
    element.height = HOLOGRAM_CANVAS_HEIGHT;
    return element;
  }, []);
  const panelTexture = useMemo(() => {
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
  }, [canvas]);
  useEffect(() => () => panelTexture.dispose(), [panelTexture]);
  useEffect(() => {
    // 역에 있는 동안은 그릴 필요가 없다. 이 컴포넌트는 씬이 숨어도 살아 있다.
    if (!enabled) return;
    const g = canvas.getContext("2d");
    if (!g) return;
    drawHologramPanel(g, isAimed);
    panelTexture.needsUpdate = true;
  }, [canvas, panelTexture, enabled, isAimed]);

  // 아래가 밝고 위가 투명한 세로 그라데이션
  const beamMap = useMemo(() => {
    const element = document.createElement("canvas");
    element.width = 16;
    element.height = 128;
    const g = element.getContext("2d");
    if (g) {
      const gradient = g.createLinearGradient(0, 128, 0, 0);
      gradient.addColorStop(0, "rgba(255,255,255,0.9)");
      gradient.addColorStop(0.5, "rgba(255,255,255,0.28)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gradient;
      g.fillRect(0, 0, 16, 128);
    }
    const texture = new THREE.CanvasTexture(element);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, []);
  useEffect(() => () => beamMap.dispose(), [beamMap]);

  const panelRef = useRef<THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>>(null);
  const scanRef = useRef<THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>>(null);

  useFrame(({ clock }) => {
    if (!enabled) {
      // 꺼진 씬에서 겨눈 채로 남아 있으면 역에서 [E] 가 창을 연다.
      setHologramAimed(false);
      setIsAimed(false);
      return;
    }
    const t = clock.elapsedTime;
    const panel = panelRef.current;
    // 사람이 선 자리에서 잰다. 카메라로 재면 3인칭에서 캐릭터 뒤 9.33 유닛만큼 어긋난다.
    const person = playerView.ready ? playerView.eye : camera.position;
    const isNear = Math.hypot(person.x - controls.x, person.y - controls.y, person.z - controls.z) < NEAR_DISTANCE;
    let hit = false;
    if (panel && isNear) {
      // 잠겨 있으면 화면 가운데 점, 풀려 있으면 마우스 자리로 겨눈다.
      aimRaycaster.setFromCamera(isPointerActive() ? SCREEN_CENTER : pointer, camera);
      hit = aimRaycaster.intersectObject(panel, false).length > 0;
    }
    setHologramAimed(hit);
    setIsAimed(hit);

    const shimmer = 1 - controls.flicker * (0.5 + 0.5 * Math.sin(t * 37.0)) * (0.5 + 0.5 * Math.sin(t * 5.3));
    if (panel) panel.material.opacity = Math.min(1, controls.brightness * shimmer);
    // 스캔 바가 위로 흐른다
    if (scanRef.current) {
      const h = controls.width * (HOLOGRAM_CANVAS_HEIGHT / HOLOGRAM_CANVAS_WIDTH);
      scanRef.current.position.y = ((t * 0.5) % 1) * h - h / 2;
      // 글자 위를 지나가므로 있는 듯 없는 듯해야 한다.
      scanRef.current.material.opacity = 0.025 * controls.brightness;
    }
  });

  if (!controls.visible) return null;
  const height = controls.width * (HOLOGRAM_CANVAS_HEIGHT / HOLOGRAM_CANVAS_WIDTH);

  return (
    <group
      position={[controls.x, controls.y + LIFT, controls.z]}
      rotation={[toRadians(controls.rotationX), toRadians(controls.rotationY), 0]}
    >
      {/* 스크린 아래로 뻗어 장치 쪽으로 좁아지는 빔 */}
      {controls.showBeam && (
        <mesh position={[0, -height / 2 - controls.beamLength / 2, -0.05]} scale={[controls.beamSpread, 1, 1]}>
          <planeGeometry args={[controls.width * 0.5, controls.beamLength]} />
          <meshBasicMaterial
            map={beamMap}
            color={HOLOGRAM_ACCENT_COLOR}
            transparent
            opacity={controls.beamIntensity}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            depthTest={false}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
      )}

      {/* 어두운 유리판이라 일반 혼합이다. 더하기 혼합은 어두운 색을 못 내 회색 벽 위에서 글자가 묻힌다.
          깊이를 써야 만화 후처리가 판 뒤 기둥의 펜선을 글자 위에 긋지 않는다. */}
      <mesh ref={panelRef} raycast={enabled ? undefined : () => null}>
        <planeGeometry args={[controls.width, height]} />
        <meshBasicMaterial
          map={panelTexture}
          transparent
          opacity={controls.brightness}
          // 판 바깥 여백이 깊이를 쓰면 뒤 창유리가 네모나게 잘린다.
          alphaTest={0.02}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>

      <OutlineMorph enabled={enabled} position={[controls.width * 0.235, 0, 0.02]} size={height * 0.42} />

      <mesh ref={scanRef} position={[0, 0, 0.01]}>
        <planeGeometry args={[controls.width, 0.12]} />
        <meshBasicMaterial
          color={HOLOGRAM_ACCENT_COLOR}
          transparent
          opacity={0.025}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          depthTest={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
