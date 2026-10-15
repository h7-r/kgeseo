import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Grid, PointerLockControls } from '@react-three/drei'
import type { ThreeElements } from '@react-three/fiber'
import * as THREE from 'three'

// NPC 로직 관찰용 더미 조작 값 (실제 게임 플레이어 시스템 아님)
const EYE_HEIGHT = 1.6
const MOVE_SPEED = 3
const THIRD_PERSON_DISTANCE = 4
const PLAYER_START: [number, number, number] = [0, 0, 5]
const UP = new THREE.Vector3(0, 1, 0)

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

function PlayerDummy({ mode }: { mode: CameraMode }) {
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

    if (move.current.lengthSq() > 0) {
      move.current.normalize()
      body.position.addScaledVector(
        move.current,
        MOVE_SPEED * Math.min(delta, 0.05),
      )
    }

    // 더미가 카메라 수평 방향을 바라보도록 회전
    body.rotation.y = Math.atan2(forward.current.x, forward.current.z)

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

function TestWorld({ mode }: { mode: CameraMode }) {
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

      {/* 벽 */}
      <Box position={[-2, 1, -2]} scale={[0.5, 2, 5]} />

      {/* 장애물 */}
      <Box position={[2, 0.5, -1]} />

      {/* NPC 더미 */}
      <mesh position={[0, 1.3, 0]}>
        <sphereGeometry args={[0.35, 32, 32]} />
        <meshStandardMaterial color="#8de5ff" />
      </mesh>

      {/* 관찰용 플레이어 더미 */}
      <PlayerDummy mode={mode} />
      <PointerLockControls />
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'KeyV' && !event.repeat) {
        setMode((current) => (current === 'first' ? 'third' : 'first'))
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh' }}>
      <Canvas camera={{ position: [0, EYE_HEIGHT, 5], fov: 70 }}>
        <color attach="background" args={['#202733']} />
        <TestWorld mode={mode} />
      </Canvas>

      <div style={hudStyle}>
        <strong>NPC Follow Prototype</strong>
        <div>
          카메라 모드:{' '}
          <strong style={{ color: '#70e099' }}>{MODE_LABEL[mode]}</strong>
        </div>
        <div>화면 클릭: 마우스 시점 회전 시작</div>
        <div>WASD: 이동 · V: 1인칭/3인칭 전환 · ESC: 잠금 해제</div>
      </div>

      {mode === 'first' && <div style={crosshairStyle}>+</div>}
    </div>
  )
}
