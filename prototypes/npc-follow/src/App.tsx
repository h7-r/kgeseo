
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Grid } from '@react-three/drei'
import type { ThreeElements } from '@react-three/fiber'

function Box(props: ThreeElements['mesh']) {
  return (
    <mesh {...props}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#888888" />
    </mesh>
  )
}

function TestWorld() {
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

      <OrbitControls makeDefault />
    </>
  )
}

export default function App() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <Canvas camera={{ position: [5, 5, 7], fov: 60 }}>
        <color attach="background" args={['#202733']} />
        <TestWorld />
      </Canvas>
    </div>
  )
}
