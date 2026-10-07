import { useEffect, useRef } from "react";
import * as THREE from "three";

import { trainDoors } from "@/station/layout/trainDoors";

interface TrainDoorMarkerProps {
  car: number;
  position: [number, number, number];
}

/**
 * 문 자리에 심는 보이지 않는 표식. 실제로 그려진 월드 좌표를 문 목록에 등록한다.
 * 그려지기 전에 읽으면 원점이 나오므로 값이 잡힐 때까지 몇 번 다시 잰다.
 */
export default function TrainDoorMarker({ car, position }: TrainDoorMarkerProps) {
  const ref = useRef<THREE.Object3D>(null);
  const [px, py, pz] = position;

  useEffect(() => {
    const marker = ref.current;
    if (!marker) return;
    let triesLeft = 20;
    const measure = () => {
      marker.updateWorldMatrix(true, false);
      const world = new THREE.Vector3();
      marker.getWorldPosition(world);
      if (Number.isFinite(world.x) && (world.x !== 0 || world.z !== 0)) {
        trainDoors.register(car, { x: world.x, z: world.z });
        return true;
      }
      return --triesLeft <= 0;
    };
    const id = setInterval(() => {
      if (measure()) clearInterval(id);
    }, 200);
    measure();
    return () => {
      clearInterval(id);
      trainDoors.unregister(car);
    };
  }, [car, px, py, pz]);

  return <object3D ref={ref} position={[px, py, pz]} />;
}
