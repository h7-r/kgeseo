import { useCallback, useEffect, useRef, useState } from 'react'
import type { ComponentRef, CSSProperties, RefObject } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Grid, PointerLockControls } from '@react-three/drei'
import type { ThreeElements } from '@react-three/fiber'
import * as THREE from 'three'
import { NpcCompanion } from './npc/NpcCompanion'
import { NpcDialog } from './npc/NpcDialog'
import { NpcInteractionSensor } from './npc/NpcInteractionSensor'
import { NPC_GREETING } from './npc/interaction'
import { useNpcInteraction } from './npc/useNpcInteraction'
import type { FollowTargetPose } from './npc/followLogic'
import type { NpcDialogEndReason } from './npc/interaction'
import { usePointerRelock } from './usePointerRelock'

// NPC 로직 관찰용 더미 조작 값 (실제 게임 플레이어 시스템 아님)
const EYE_HEIGHT = 1.6
const MOVE_SPEED = 3
const THIRD_PERSON_DISTANCE = 4
const PLAYER_START: [number, number, number] = [0, 0, 5]
const UP = new THREE.Vector3(0, 1, 0)
// 마우스 잠금은 3D 화면 클릭으로만 시작한다 (대화창 버튼 클릭은 제외)
const SCENE_ID = 'scene'
// 아무 요소와도 일치하지 않는 선택자: 대화 중 화면 클릭 잠금을 끄는 데 쓴다
const NO_CLICK_LOCK = '[data-no-click-lock]'

type PointerLockHandle = ComponentRef<typeof PointerLockControls>

type CameraMode = 'first' | 'third'

const MODE_LABEL: Record<CameraMode, string> = {
  first: '1인칭',
  third: '3인칭 (관찰)',
}

function Box(props: ThreeElements['mesh']) {
  return (
    <mesh {...props}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#888888" />
    </mesh>
  )
}

function PlayerDummy({
  mode,
  poseRef,
  inputEnabled,
}: {
  mode: CameraMode
  // false면 이동 입력을 무시한다 (대화 중)
  inputEnabled: boolean
  // NPC 등 외부 시스템에 매 프레임 자세를 공개하는 통로
  poseRef: RefObject<FollowTargetPose>
}) {
  const player = useRef<THREE.Group>(null)
  const keys = useRef(new Set<string>())

  // 매 프레임 재사용하는 임시 벡터
  const look = useRef(new THREE.Vector3())
  const forward = useRef(new THREE.Vector3())
  const right = useRef(new THREE.Vector3())
  const move = useRef(new THREE.Vector3())
  const head = useRef(new THREE.Vector3())

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => keys.current.add(event.code)
    const onKeyUp = (event: KeyboardEvent) => keys.current.delete(event.code)
    const onBlur = () => keys.current.clear()

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  useFrame(({ camera }, delta) => {
    const body = player.current
    if (!body) return

    // 카메라 회전은 PointerLockControls(마우스)가 담당하고, 여기서는 수평 방향만 추출
    camera.getWorldDirection(look.current)
    forward.current.set(look.current.x, 0, look.current.z)
    if (forward.current.lengthSq() < 1e-6) forward.current.set(0, 0, -1)
    forward.current.normalize()
    right.current.crossVectors(forward.current, UP).normalize()

    move.current.set(0, 0, 0)
    if (keys.current.has('KeyW')) move.current.add(forward.current)
    if (keys.current.has('KeyS')) move.current.sub(forward.current)
    if (keys.current.has('KeyD')) move.current.add(right.current)
    if (keys.current.has('KeyA')) move.current.sub(right.current)

    if (inputEnabled && move.current.lengthSq() > 0) {
      move.current.normalize()
      body.position.addScaledVector(
        move.current,
        MOVE_SPEED * Math.min(delta, 0.05),
      )
    }

    // 더미가 카메라 수평 방향을 바라보도록 회전
    body.rotation.y = Math.atan2(forward.current.x, forward.current.z)

    poseRef.current.position.copy(body.position)
    poseRef.current.yaw = body.rotation.y

    head.current.set(body.position.x, EYE_HEIGHT, body.position.z)

    if (mode === 'first') {
      camera.position.copy(head.current)
    } else {
      // 시선 반대 방향으로 물러나 더미가 화면 중앙에 오도록 배치
      camera.position
        .copy(head.current)
        .addScaledVector(look.current, -THIRD_PERSON_DISTANCE)
      camera.position.y = Math.max(camera.position.y, 0.3)
    }
  })

  return (
    <group ref={player} position={PLAYER_START}>
      <mesh position={[0, 0.85, 0]} visible={mode === 'third'}>
        <capsuleGeometry args={[0.3, 1.1, 8, 16]} />
        <meshStandardMaterial color="#70e099" />
      </mesh>
      {/* 정면 방향 표시 */}
      <mesh position={[0, 1.4, 0.3]} visible={mode === 'third'}>
        <boxGeometry args={[0.15, 0.1, 0.15]} />
        <meshStandardMaterial color="#2f8f57" />
      </mesh>
    </group>
  )
}

function TestWorld({
  mode,
  talking,
  onTargetChange,
  controlsRef,
}: {
  mode: CameraMode
  talking: boolean
  onTargetChange: (targetable: boolean) => void
  controlsRef: RefObject<PointerLockHandle | null>
}) {
  const playerPose = useRef<FollowTargetPose>({
    position: new THREE.Vector3(...PLAYER_START),
    yaw: Math.PI,
  })
  const npcBody = useRef<THREE.Mesh>(null)
  const occluders = useRef<THREE.Group>(null)

  return (
    <>
      <ambientLight intensity={1.5} />
      <directionalLight position={[5, 10, 5]} intensity={2} />

      {/* 바닥 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[20, 20]} />
        <meshStandardMaterial color="#747d89" />
      </mesh>

      <Grid
        position={[0, 0.01, 0]}
        args={[20, 20]}
        cellColor="#aab3c0"
        sectionColor="#d1d5db"
      />

      {/* 시선을 가리는 물체: NPC 상호작용 판정에서 가림 검사 대상 */}
      <group ref={occluders}>
        {/* 벽 */}
        <Box position={[-2, 1, -2]} scale={[0.5, 2, 5]} />

        {/* 장애물 */}
        <Box position={[2, 0.5, -1]} />
      </group>

      {/* 관찰용 플레이어 더미 (자세를 먼저 갱신하도록 NPC보다 앞에 둔다) */}
      <PlayerDummy mode={mode} poseRef={playerPose} inputEnabled={!talking} />

      {/* NPC: 플레이어 자세만 전달받아 측후방을 따라다닌다. 대화 중에는 제자리 고정 */}
      <NpcCompanion
        targetPose={playerPose}
        showAnchor={mode === 'third'}
        frozen={talking}
        bodyRef={npcBody}
      />

      {/* 1인칭 조준점으로 NPC를 바라보는지 판정 */}
      <NpcInteractionSensor
        npc={npcBody}
        occluders={occluders}
        playerPose={playerPose}
        enabled={mode === 'first' && !talking}
        onChange={onTargetChange}
      />

      {/* 컨트롤은 항상 연결해 둔다. 대화 중에는 잠금이 풀려 시점이 움직이지 않고,
          화면 클릭 잠금만 꺼서 대화창 주변을 눌러도 다시 잠기지 않게 한다. */}
      <PointerLockControls
        ref={controlsRef}
        selector={talking ? NO_CLICK_LOCK : `#${SCENE_ID}`}
      />
    </>
  )
}

const hudStyle: CSSProperties = {
  position: 'absolute',
  top: 16,
  left: 16,
  padding: '10px 14px',
  borderRadius: 6,
  background: 'rgba(0, 0, 0, 0.45)',
  color: 'white',
  fontFamily: 'sans-serif',
  fontSize: 14,
  lineHeight: 1.6,
  pointerEvents: 'none',
}

const promptStyle: CSSProperties = {
  position: 'absolute',
  top: 'calc(50% + 28px)',
  left: '50%',
  transform: 'translateX(-50%)',
  padding: '4px 10px',
  borderRadius: 4,
  background: 'rgba(0, 0, 0, 0.55)',
  color: 'white',
  fontFamily: 'sans-serif',
  fontSize: 14,
  pointerEvents: 'none',
}

const relockNoticeStyle: CSSProperties = {
  position: 'absolute',
  left: '50%',
  bottom: 40,
  transform: 'translateX(-50%)',
  maxWidth: 'calc(100vw - 32px)',
  padding: '8px 14px',
  borderRadius: 6,
  background: 'rgba(0, 0, 0, 0.6)',
  color: '#ffd36e',
  fontFamily: 'sans-serif',
  fontSize: 14,
  pointerEvents: 'none',
}

const crosshairStyle: CSSProperties = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  color: 'white',
  pointerEvents: 'none',
}

export default function App() {
  const [mode, setMode] = useState<CameraMode>('first')
  const controls = useRef<PointerLockHandle>(null)
  const getLockTarget = useCallback(() => controls.current?.domElement, [])
  const relock = usePointerRelock(getLockTarget)
  const { requestRelock, requestClickHint } = relock
  // 닫기 버튼: 클릭 처리 중이므로 바로 재잠금을 요청한다.
  // ESC: 브라우저의 잠금 해제 키와 충돌하므로 재요청하지 않고 클릭 안내만 띄운다.
  const onDialogEnd = useCallback(
    (reason: NpcDialogEndReason) => {
      if (reason === 'button') requestRelock()
      else requestClickHint()
    },
    [requestRelock, requestClickHint],
  )
  // 대화 종료 처리는 끝낸 입력(버튼/ESC)에 따라 onDialogEnd에서 나뉜다
  const npc = useNpcInteraction({
    enabled: mode === 'first',
    onEnd: onDialogEnd,
  })
  const { talking } = npc

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // 대화 중에는 카메라 전환도 막는다
      if (event.code === 'KeyV' && !event.repeat && !talking) {
        setMode((current) => (current === 'first' ? 'third' : 'first'))
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [talking])

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh' }}>
      <Canvas id={SCENE_ID} camera={{ position: [0, EYE_HEIGHT, 5], fov: 70 }}>
        <color attach="background" args={['#202733']} />
        <TestWorld
          mode={mode}
          talking={talking}
          onTargetChange={npc.reportTarget}
          controlsRef={controls}
        />
      </Canvas>

      <div style={hudStyle}>
        <strong>NPC Follow Prototype</strong>
        <div>
          카메라 모드:{' '}
          <strong style={{ color: '#70e099' }}>{MODE_LABEL[mode]}</strong>
        </div>
        <div>화면 클릭: 마우스 시점 회전 시작</div>
        <div>WASD: 이동 · V: 1인칭/3인칭 전환 · ESC: 잠금 해제</div>
        <div>NPC 조준 후 E: 대화 · ESC: 대화 닫기</div>
      </div>

      {mode === 'first' && !talking && <div style={crosshairStyle}>+</div>}
      {npc.canInteract && <div style={promptStyle}>E · 대화하기</div>}
      {talking && (
        <NpcDialog line={NPC_GREETING} onClose={() => npc.endTalk('button')} />
      )}
      {/* 실제 잠금 상태(document.pointerLockElement)가 풀려 있을 때만 표시 */}
      {!talking && relock.showClickHint && (
        <div style={relockNoticeStyle}>
          화면을 클릭하여 시점 조작을 재개하세요
        </div>
      )}
    </div>
  )
}
