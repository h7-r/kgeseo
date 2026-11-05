import { KOREA_REGIONS, MAP_PROJECTION, NAJU_RING } from "./koreaMapData";

// 지도 좌표. 창의 SVG 와 객차 안내판의 캔버스가 같은 경로 문자열을 쓴다.

/** 지도 한 장의 크기. 경계 데이터를 이만큼 줄여 앉힌다. */
export const MAP_WIDTH = 680;
export const MAP_HEIGHT = 720;
const MAP_X = 55;
const MAP_Y = 108;
const MAP_ZOOM = 0.56;

/** 크게 넣으려고 먼 섬을 본토 가까이 당겨 그린다(데이터 좌표 단위). 지도의 흔한 삽입 표기다. */
const JEJU_SHIFT_Y = -90;
const DOKDO_SIDE_SHIFT_X = -218;
/** 이 x 보다 동쪽 고리가 울릉도·독도다 */
const DOKDO_SIDE_FROM_X = 890;

export const mapX = (lon: number) =>
  MAP_X + (lon - MAP_PROJECTION.lon0) * MAP_PROJECTION.cosLat * MAP_PROJECTION.scale * MAP_ZOOM;
export const mapY = (lat: number) => MAP_Y + (MAP_PROJECTION.lat0 - lat) * MAP_PROJECTION.scale * MAP_ZOOM;
/** 동쪽으로 당겨 그린 섬의 이름·점을 찍을 때 더한다 */
export const DOKDO_SIDE_OFFSET = DOKDO_SIDE_SHIFT_X * MAP_ZOOM;

function ringToPath(ring: readonly number[], dx: number, dy: number) {
  let path = "";
  for (let i = 0; i < ring.length; i += 2) {
    const x = MAP_X + (ring[i] + dx) * MAP_ZOOM,
      y = MAP_Y + (ring[i + 1] + dy) * MAP_ZOOM;
    path += `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return `${path}Z`;
}

export const KOREA_REGION_PATHS: readonly { name: string; path: string }[] = KOREA_REGIONS.map(({ name, rings }) => ({
  name,
  path: rings
    .map((ring) =>
      ringToPath(ring, ring[0] > DOKDO_SIDE_FROM_X ? DOKDO_SIDE_SHIFT_X : 0, name === "제주" ? JEJU_SHIFT_Y : 0),
    )
    .join(""),
}));

export const NAJU_PATH = ringToPath(NAJU_RING, 0, 0);
