import { useCallback, useRef } from 'react'
import type { RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { createFollowState, resumeFollow, stepFollow } from './followLogic'
import type { FollowTargetPose } from './followLogic'
import { hoverOffset } from './hover'

interface NpcCompanionProps {
  // 매 프레임 대상(플레이어)이 갱신해 주는 자세. 더미든 실제 플레이어든 상관없다.
  targetPose: RefObject<FollowTargetPose>
  start?: [number, number, number]
  // 관찰용 목표 위치·우회 경유점 표시
  showAnchor?: boolean
  // true인 동안 추적을 멈추고 현재 위치에 고정한다 (부유는 계속)
  frozen?: boolean
  // 상호작용 판정 등 외부에서 NPC 메시를 참조할 때 사용
  bodyRef?: RefObject<THREE.Mesh | null>
}

export function NpcCompanion({
  targetPose,
  start = [0, 1.3, 0],
  showAnchor = false,
  frozen = false,
  bodyRef,
}: NpcCompanionProps) {
  const body = useRef<THREE.Mesh>(null)
  // 내부 참조와 외부 참조(bodyRef)를 함께 연결
  const attachBody = useCallback(
    (mesh: THREE.Mesh | null) => {
      body.current = mesh
      if (bodyRef) bodyRef.current = mesh
    },
    [bodyRef],
  )
  const wasFrozen = useRef(frozen)
  const anchorMarker = useRef<THREE.Mesh>(null)
  const waypointMarker = useRef<THREE.Mesh>(null)
  const state = useRef(createFollowState(new THREE.Vector3(...start)))

  useFrame(({ clock }, delta) => {
    // 탭 전환 등으로 생긴 큰 delta에 순간이동하지 않도록 제한
    const dt = Math.min(delta, 0.05)
    const follow = state.current
    const groundY = targetPose.current.position.y + 0.02

    if (frozen) {
      follow.velocity.set(0, 0, 0)
    } else {
      // 고정이 풀린 첫 프레임: 플레이어의 현재 위치 기준으로 추적을 새로 시작
      if (wasFrozen.current) resumeFollow(follow, targetPose.current)
      stepFollow(follow, targetPose.current, dt)
    }
    wasFrozen.current = frozen

    const mesh = body.current
    if (mesh) {
      mesh.position.copy(follow.position)
      mesh.position.y += hoverOffset(clock.elapsedTime)
    }

    anchorMarker.current?.position.set(follow.anchor.x, groundY, follow.anchor.z)

    const waypoint = waypointMarker.current
    if (waypoint) {
      waypoint.visible = showAnchor && follow.detourSide !== 0
      waypoint.position.set(follow.steerTarget.x, groundY, follow.steerTarget.z)
    }
  })

  return (
    <>
      <mesh ref={attachBody} position={start}>
        <sphereGeometry args={[0.35, 32, 32]} />
        <meshStandardMaterial color="#8de5ff" />
      </mesh>
      <mesh
        ref={anchorMarker}
        rotation={[-Math.PI / 2, 0, 0]}
        visible={showAnchor}
      >
        <ringGeometry args={[0.12, 0.16, 24]} />
        <meshBasicMaterial color="#8de5ff" transparent opacity={0.6} />
      </mesh>
      <mesh ref={waypointMarker} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <circleGeometry args={[0.07, 16]} />
        <meshBasicMaterial color="#ffd36e" transparent opacity={0.8} />
      </mesh>
    </>
  )
}
