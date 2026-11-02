import { useRef } from 'react'
import type { RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { FollowTargetPose } from './followLogic'
import { isNpcTargetable } from './targeting'

interface NpcInteractionSensorProps {
  npc: RefObject<THREE.Object3D | null> // 조준 대상 NPC 메시
  occluders: RefObject<THREE.Object3D | null> // 시선을 가리는 벽·장애물 묶음
  playerPose: RefObject<FollowTargetPose>
  enabled: boolean
  // 판정이 바뀔 때만 호출된다 (매 프레임 React 상태를 갱신하지 않도록)
  onChange: (targetable: boolean) => void
}

// 매 프레임 조준 판정을 돌리고, 결과가 바뀌면 알린다.
export function NpcInteractionSensor({
  npc,
  occluders,
  playerPose,
  enabled,
  onChange,
}: NpcInteractionSensorProps) {
  const raycaster = useRef(new THREE.Raycaster())
  const last = useRef(false)

  useFrame(({ camera }) => {
    const target = npc.current
    const targetable =
      enabled &&
      target !== null &&
      isNpcTargetable({
        camera,
        raycaster: raycaster.current,
        npc: target,
        occluders: occluders.current,
        playerPosition: playerPose.current.position,
      })

    if (targetable !== last.current) {
      last.current = targetable
      onChange(targetable)
    }
  })

  return null
}
