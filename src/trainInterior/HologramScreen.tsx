import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";

import { exposeDevHook } from "@/debug/devHooks";
import { useSavedControls } from "@/engine/leva/savedControls";
import { playerView } from "@/engine/playerView";

import {
  DESTINATIONS,
  drawPanel,
  isInside,
  PANEL_HEIGHT,
  PANEL_WIDTH,
  RESET_RECT,
  rowRect,
  SELECT_RECT,
} from "./hologramPanel";
import { NAJU_ENTER_EVENT, type NajuEnterDetail } from "@/station/najuEnter";

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/**
 * 저장값 위에 코드로 더하는 높이(≈4 px). Y 는 저장값이 기본값을 이기고, 슬라이더 한 칸(0.02)도 이보다 크다.
 * fov 60 · 5.5 유닛 거리에서 1 유닛 ≈ 157 px 이라 0.0075 유닛 ≈ 1 px.
 */
const LIFT = 0.03;
/** 이 안이면 [E] 로 떠날 수 있다 */
const NEAR_DISTANCE = 13;

interface HologramScreenProps {
  /**
   * 기차 씬이 지금 켜져 있나. 씬이 숨어도 이 컴포넌트는 살아 있고, useFrame 과 R3F 레이캐스트는
   * visible 을 보지 않는다. 스크린 자리가 역 방 안 좌표라 로비에서 허공을 클릭해 나주로 넘어가던 일을 막는다.
   */
  enabled?: boolean;
}

/** 텔레포트 장치가 쏘는 목적지 선택 홀로그램. 카드를 클릭해 고르고 [E] 로 떠난다. */
export default function HologramScreen({ enabled = true }: HologramScreenProps) {
  const controls = useSavedControls("홀로그램 스크린", {
    visible: { value: true, label: "보이기" },
    x: { value: -16.4, min: -26, max: 26, step: 0.1, label: "X" },
    // 0.1 유닛이 화면에서 약 19 px 이라 잔조정용으로 눈금을 줄였다.
    y: { value: 5.0, min: 0, max: 12, step: 0.02, label: "Y" },
    z: { value: 4.0, min: -5, max: 6, step: 0.1, label: "Z" },
    // 4~7 유닛 거리에서 판 전체가 시야(fov 60)에 들어오는 가로
    width: { value: 4.6, min: 1, max: 16, step: 0.1, label: "폭" },
    rotationX: { value: 0, min: -90, max: 90, step: 1, label: "회전X" },
    rotationY: { value: 180, min: -180, max: 180, step: 1, label: "회전Y" },
    color: { value: "#25bdff", label: "색" },
    brightness: { value: 1.15, min: 0.2, max: 3, step: 0.05, label: "밝기" },
    /** 홀로그램 미세 떨림 */
    flicker: { value: 0.06, min: 0, max: 0.4, step: 0.01, label: "깜빡임" },
    // 장치에서 스크린으로 쏘아 올라오는 빛
    showBeam: { value: true, label: "빔보이기" },
    beamColor: { value: "#24a6de", label: "빔색" },
    /** 스크린 아래로 뻗는 길이 */
    beamLength: { value: 0.3, min: 0, max: 14, step: 0.1, label: "빔길이" },
    beamIntensity: { value: 0.25, min: 0, max: 2, step: 0.05, label: "빔세기" },
    /** 아래로 갈수록 넓어지는 정도 */
    beamSpread: { value: 2.1, min: 0.2, max: 8, step: 0.1, label: "빔퍼짐" },
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isNear, setIsNear] = useState(false);
  const { camera } = useThree();
  const nearRef = useRef(false);
  const selectedRef = useRef<string | null>(null);
  const enabledRef = useRef(enabled);
  useLayoutEffect(() => {
    selectedRef.current = selectedId;
    enabledRef.current = enabled;
  });

  // 바로 넘어가지 않고 진입 연출(암전 + 안내)을 먼저 돌린다. 연출이 끝나면 그쪽이 같은 출처 /naju01/ 로 옮긴다.
  const goToNaju = useCallback(() => {
    if (typeof window === "undefined") return;
    exposeDevHook("destinationSelect", "naju");
    // 아바타 종류(사이드킥)만 이어서 넘긴다 — naju 기본은 Meshy 캐릭터.
    const avatar = new URLSearchParams(location.search).get("avatar");
    const query = avatar === "sidekick" ? "?avatar=sidekick" : "";
    window.dispatchEvent(new CustomEvent<NajuEnterDetail>(NAJU_ENTER_EVENT, { detail: { query } }));
  }, []);

  const canvas = useMemo(() => {
    const element = document.createElement("canvas");
    element.width = PANEL_WIDTH;
    element.height = PANEL_HEIGHT;
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
    const g = canvas.getContext("2d");
    if (!g) return;
    drawPanel(g, { selectedId, isNear });
    panelTexture.needsUpdate = true;
  }, [canvas, panelTexture, selectedId, isNear]);

  // 장소 이동은 되돌릴 수 없어 두 박자로 한다 — 카드를 클릭해 고르고, 근처에서 [E].
  // 근처이기만 하면 넘어가게 했을 때 다른 일로 [E] 를 누르다 나주로 넘어가 버렸다.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "KeyE" || e.repeat) return;
      if (!enabledRef.current) return;
      if (nearRef.current && selectedRef.current) goToNaju();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goToNaju]);

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
      // 꺼진 씬에서 근처로 남아 있으면 [E] 가 그대로 먹는다.
      if (nearRef.current) {
        nearRef.current = false;
        setIsNear(false);
      }
      return;
    }
    const t = clock.elapsedTime;
    // 사람이 선 자리에서 잰다. 카메라로 재면 3인칭에서 캐릭터 뒤 9.33 유닛만큼 어긋난다.
    const person = playerView.ready ? playerView.eye : camera.position;
    const distance = Math.hypot(person.x - controls.x, person.y - controls.y, person.z - controls.z);
    const near = distance < NEAR_DISTANCE;
    if (nearRef.current !== near) {
      nearRef.current = near;
      setIsNear(near);
    }
    const shimmer = 1 - controls.flicker * (0.5 + 0.5 * Math.sin(t * 37.0)) * (0.5 + 0.5 * Math.sin(t * 5.3));
    if (panelRef.current) panelRef.current.material.opacity = Math.min(1, controls.brightness * shimmer);
    // 스캔 바가 위로 흐른다
    if (scanRef.current) {
      const h = controls.width * (PANEL_HEIGHT / PANEL_WIDTH);
      scanRef.current.position.y = ((t * 0.5) % 1) * h - h / 2;
      scanRef.current.material.opacity = 0.12 * controls.brightness;
    }
  });

  const handlePointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!e.uv) return;
      e.stopPropagation();
      const cx = e.uv.x * PANEL_WIDTH;
      const cy = (1 - e.uv.y) * PANEL_HEIGHT;
      for (let i = 0; i < DESTINATIONS.length; i++) {
        if (isInside(rowRect(i), cx, cy)) {
          const destination = DESTINATIONS[i];
          if (destination.isOpen) setSelectedId((previous) => (previous === destination.id ? null : destination.id));
          return;
        }
      }
      if (isInside(SELECT_RECT, cx, cy)) {
        if (selectedId) goToNaju();
        return;
      }
      if (isInside(RESET_RECT, cx, cy)) setSelectedId(null);
    },
    [selectedId, goToNaju],
  );

  if (!controls.visible) return null;
  const height = controls.width * (PANEL_HEIGHT / PANEL_WIDTH);

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
            color={controls.beamColor}
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

      {/* 손잡이는 pointerdown 하나만. click 까지 걸면 한 번 누를 때 토글이 두 번 돈다.
          click 은 누른 뒤 시점이 움직여 커서가 판 밖으로 나가면 아예 안 온다.
          visible=false 는 클릭을 안 막아 꺼진 씬에서는 레이캐스트 자체를 막는다. */}
      <mesh
        ref={panelRef}
        onPointerDown={enabled ? handlePointerDown : undefined}
        raycast={enabled ? undefined : () => null}
      >
        <planeGeometry args={[controls.width, height]} />
        <meshBasicMaterial
          map={panelTexture}
          color={controls.color}
          transparent
          opacity={controls.brightness}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>

      <mesh ref={scanRef} position={[0, 0, 0.01]}>
        <planeGeometry args={[controls.width, 0.12]} />
        <meshBasicMaterial
          color={controls.color}
          transparent
          opacity={0.12}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          depthTest={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
