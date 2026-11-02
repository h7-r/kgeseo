import * as THREE from 'three'
import { INTERACTION_CONFIG } from './interaction'

const SCREEN_CENTER = new THREE.Vector2(0, 0)
const npcPosition = new THREE.Vector3()
const projected = new THREE.Vector3()
const candidates: THREE.Object3D[] = []

export interface TargetingInput {
  camera: THREE.Camera
  raycaster: THREE.Raycaster
  npc: THREE.Object3D // 조준 대상 NPC 메시
  occluders: THREE.Object3D | null // 시선을 가리는 벽·장애물 묶음
  playerPosition: THREE.Vector3 // 플레이어 발 위치
  maxDistance?: number
}

// 화면 중앙 조준점으로 NPC를 바라보는지 판정한다.
// 조건: 수평 거리 이내 + NPC 중심이 화면 안 + 중앙 광선이 가림 없이 NPC에 먼저 닿음
export function isNpcTargetable({
  camera,
  raycaster,
  npc,
  occluders,
  playerPosition,
  maxDistance = INTERACTION_CONFIG.maxDistance,
}: TargetingInput): boolean {
  npc.getWorldPosition(npcPosition)

  // 부유 오프셋이 영향을 주지 않도록 수평 거리로 판정
  const distance = Math.hypot(
    npcPosition.x - playerPosition.x,
    npcPosition.z - playerPosition.z,
  )
  if (distance > maxDistance) return false

  // NPC 중심이 카메라 앞쪽 화면 안에 있는지
  projected.copy(npcPosition).project(camera)
  const onScreen =
    projected.z < 1 && Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1
  if (!onScreen) return false

  candidates.length = 0
  candidates.push(npc)
  if (occluders) candidates.push(occluders)

  raycaster.setFromCamera(SCREEN_CENTER, camera)
  const hits = raycaster.intersectObjects(candidates, true)
  // 가장 먼저 닿은 물체가 NPC여야 한다 (벽에 가려지면 불가)
  return hits.length > 0 && hits[0].object === npc
}
