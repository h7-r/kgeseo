interface TrainBackdropProps {
  /** 판을 세울 거리 */
  x?: number;
  z?: number;
  y?: number;
  width?: number;
  height?: number;
  color?: string;
  floorColor?: string;
  floorY?: number;
}

/**
 * 기차 저편 어둠판. 물체가 없는 자리로 캔버스 바탕색이 비치는 것을 막는다.
 * 안개색이 밝은 회청색이라 fog 를 받으면 멀리서 다시 파래진다 — 조명·안개를 둘 다 끈다.
 */
export default function TrainBackdrop({
  x = 34,
  z = -1,
  y = 14,
  width = 160,
  height = 80,
  color = "#15181D",
  floorColor = "#101318",
  floorY = -2.2,
}: TrainBackdropProps) {
  return (
    <>
      {/* plane 은 +Z 를 보므로 -90° 돌려 -X 를 보게 한다 */}
      <mesh position={[x, y, z]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial color={color} toneMapped={false} fog={false} />
      </mesh>
      {/* 선로 저편 바닥 — 아래로 새는 여백도 막는다 */}
      <mesh position={[(16 + x) / 2 + 6, floorY, z]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[x - 16 + 24, width]} />
        <meshBasicMaterial color={floorColor} toneMapped={false} fog={false} />
      </mesh>
    </>
  );
}
