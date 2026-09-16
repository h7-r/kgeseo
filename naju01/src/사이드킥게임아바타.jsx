// Synty Sidekick Free Starter Pack을 NAJU 게임 공간에서 검증하기 위한 별도 런타임.
// 기존 Meshy/게임 리그 파일은 수정하지 않는다.
import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { 미터 } from "./공간도면.js";

const 캐릭터파일 = "/models/sidekick-naju-test.glb";
const DEG = Math.PI / 180;

function 첫스킨메시(root) {
  let result = null;
  root.traverse((object) => {
    if (!result && object.isSkinnedMesh) result = object;
  });
  return result;
}

function SidekickGameAvatar({ 보이기, 크기 = 미터, 거리 = 11, 눈높이 = 1.62 }) {
  const root = useRef();
  const 눌림 = useRef(new Set());
  const 위상 = useRef(0);
  const { camera } = useThree();
  const gltf = useGLTF(캐릭터파일);
  const 모델 = useMemo(() => clone(gltf.scene), [gltf.scene]);

  const { 본, 휴식회전, 바닥높이 } = useMemo(() => {
    const skin = 첫스킨메시(모델);
    const bones = skin
      ? Object.fromEntries(skin.skeleton.bones.map((bone) => [bone.name, bone]))
      : {};
    const rest = Object.fromEntries(
      Object.entries(bones).map(([name, bone]) => [name, bone.quaternion.clone()]),
    );
    모델.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = true;
      object.receiveShadow = true;
      object.frustumCulled = false;
    });
    모델.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(모델);
    return { 본: bones, 휴식회전: rest, 바닥높이: bounds.min.y };
  }, [모델]);

  const 계산 = useMemo(
    () => ({
      전방: new THREE.Vector3(),
      회전: new THREE.Quaternion(),
      오일러: new THREE.Euler(0, 0, 0, "XYZ"),
    }),
    [],
  );

  useEffect(() => {
    const down = (event) => 눌림.current.add(event.code);
    const up = (event) => 눌림.current.delete(event.code);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  useFrame((_, delta) => {
    const group = root.current;
    if (!group) return;
    group.visible = 보이기;
    if (!보이기) return;

    const 전방 = 계산.전방;
    camera.getWorldDirection(전방);
    전방.y = 0;
    if (전방.lengthSq() < 0.00001) 전방.set(0, 0, -1);
    전방.normalize();

    const keys = 눌림.current;
    const moving = ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].some(
      (key) => keys.has(key),
    );
    const running = moving && (keys.has("ShiftLeft") || keys.has("ShiftRight"));
    const motion = moving ? (running ? "Run" : "Walk") : "Idle";
    const frequency = motion === "Run" ? 2.15 : motion === "Walk" ? 1.35 : 0.22;
    위상.current += delta * Math.PI * 2 * frequency;
    const cycle = Math.sin(위상.current);
    const opposite = Math.sin(위상.current + Math.PI);
    const secondary = Math.sin(위상.current * 2);

    const pose = (name, x = 0, y = 0, z = 0, speed = 12) => {
      const bone = 본[name];
      const rest = 휴식회전[name];
      if (!bone || !rest) return;
      계산.오일러.set(x * DEG, y * DEG, z * DEG, "XYZ");
      계산.회전.setFromEuler(계산.오일러).premultiply(rest);
      bone.quaternion.slerp(계산.회전, 1 - Math.exp(-delta * speed));
    };

    // 원본 A/T 포즈의 팔을 자연스럽게 내린 뒤 보행 스윙을 더한다.
    const armSwing = motion === "Run" ? 24 * cycle : motion === "Walk" ? 13 * cycle : 1.5 * cycle;
    const elbowBend = motion === "Run" ? 35 : motion === "Walk" ? 12 : 7;
    pose("upperarm_l", 0, 67, -armSwing);
    pose("upperarm_r", 0, -67, armSwing);
    pose("lowerarm_l", 0, 0, -elbowBend - Math.max(0, -cycle) * 9);
    pose("lowerarm_r", 0, 0, elbowBend + Math.max(0, cycle) * 9);

    const legSwing = motion === "Run" ? 30 * cycle : motion === "Walk" ? 18 * cycle : 0;
    const leftKnee = motion === "Run" ? 15 + Math.max(0, -cycle) * 30 : motion === "Walk" ? 5 + Math.max(0, -cycle) * 15 : 0;
    const rightKnee = motion === "Run" ? 15 + Math.max(0, cycle) * 30 : motion === "Walk" ? 5 + Math.max(0, cycle) * 15 : 0;
    pose("thigh_l", 0, 0, legSwing);
    pose("thigh_r", 0, 0, -legSwing);
    pose("calf_l", 0, 0, -leftKnee);
    pose("calf_r", 0, 0, rightKnee);

    const torsoTurn = motion === "Run" ? 5.5 * opposite : motion === "Walk" ? 2.5 * opposite : 0.7 * cycle;
    const forwardLean = motion === "Run" ? 7 : 0;
    pose("spine_01", forwardLean * 0.35, 0, torsoTurn * 0.35);
    pose("spine_03", forwardLean * 0.65, 0, torsoTurn * 0.65);
    pose("neck_01", -forwardLean * 0.22, 0, -torsoTurn * 0.25);
    pose("head", -forwardLean * 0.18, 0, -torsoTurn * 0.2);

    const bob = motion === "Run" ? Math.abs(secondary) * 0.035 : motion === "Walk" ? Math.abs(secondary) * 0.015 : secondary * 0.004;
    group.position.copy(camera.position).addScaledVector(전방, 거리);
    group.position.y = camera.position.y - 눈높이 - 바닥높이 * 크기 + bob * 크기;
    group.rotation.set(0, Math.atan2(전방.x, 전방.z), 0);
    group.scale.setScalar(크기);

    if (import.meta.env.DEV) {
      window.__SIDEKICK_DEBUG = { motion, phase: 위상.current, boneCount: Object.keys(본).length };
    }
  });

  return (
    <group name="NAJU-sidekick-test-avatar" ref={root} visible={보이기}>
      <primitive object={모델} />
    </group>
  );
}

useGLTF.preload(캐릭터파일);

export default SidekickGameAvatar;
