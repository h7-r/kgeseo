import "three";

declare module "three" {
  // 툰 재질도 flatShading 을 읽어 각진 면으로 그리지만 타입 정의에서 빠져 있다.
  interface MeshToonMaterial {
    flatShading: boolean;
  }
}
