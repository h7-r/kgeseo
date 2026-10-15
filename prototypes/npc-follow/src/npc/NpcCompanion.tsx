import { useCallback, useRef } from 'react'
import type { RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { createFollowState, resumeFollow, stepFollow } from './followLogic'
import type { FollowTargetPose } from './followLogic'
import { hoverOffset } from './hover'
import { NPC_COLLISION_RADIUS } from './collision'
import type { CollisionWorld } from './collision'

// 관찰용으로 표시하는 우회 경유점 최대 개수
const PATH_MARKER_COUNT = 6

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
  // 관통하면 안 되는 장애물. 없으면 장애물을 무시한다.
  collisionWorld?: CollisionWorld | null
}

export function NpcCompanion({
  targetPose,
  start = [0, 1.3, 0],
  showAnchor = false,
  frozen = false,
  bodyRef,
  collisionWorld = null,
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
  const pathMarkers = useRef<(THREE.Mesh | null)[]>([])
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
      stepFollow(follow, targetPose.current, dt, collisionWorld)
    }
    wasFrozen.current = frozen

    const mesh = body.current
    if (mesh) {
      mesh.position.copy(follow.position)
      mesh.position.y += hoverOffset(clock.elapsedTime)
    }

    // 실제 목표(장애물 앞으로 당겨진 위치)를 표시
    anchorMarker.current?.position.set(follow.goal.x, groundY, follow.goal.z)

    const waypoint = waypointMarker.current
    if (waypoint) {
      waypoint.visible = showAnchor && follow.detourSide !== 0
      waypoint.position.set(follow.steerTarget.x, groundY, follow.steerTarget.z)
    }

    // 장애물 우회 경로의 경유점 (목표 제외)
    const detouring = follow.path.status === 'detour'
    pathMarkers.current.forEach((marker, index) => {
      if (!marker) return
      const point = follow.path.points[index]
      const isWaypoint = index < follow.path.points.length - 1
      marker.visible = showAnchor && detouring && isWaypoint && point !== undefined
      if (point) marker.position.set(point.x, groundY, point.z)
    })
  })

  return (
    <>
      <mesh ref={attachBody} position={start}>
        <sphereGeometry args={[NPC_COLLISION_RADIUS, 32, 32]} />
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
      {Array.from({ length: PATH_MARKER_COUNT }, (_, index) => (
        <mesh
          key={index}
          ref={(marker) => {
            pathMarkers.current[index] = marker
          }}
          rotation={[-Math.PI / 2, 0, 0]}
          visible={false}
        >
          <circleGeometry args={[0.09, 16]} />
          <meshBasicMaterial color="#ff9f5a" transparent opacity={0.85} />
        </mesh>
      ))}
    </>
  )
}
