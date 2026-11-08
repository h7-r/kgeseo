import { DESTINATIONS, DOKDO, type Destination } from "./destinationData";
import {
  DOKDO_SIDE_OFFSET,
  KOREA_REGION_PATHS,
  MAP_HEIGHT,
  MAP_WIDTH,
  mapX,
  mapY,
  NAJU_PATH,
} from "./koreaMapGeometry";

/** 안내판 외곽선이 따는 자물쇠 윤곽. 24 칸 기준. */
export const LOCK_ICON_PATH =
  "M7 10V5.6L9.6 3h4.8L17 5.6V10h-2.2V6.5L13.5 5.2h-3L9.2 6.5V10ZM4.5 10h15l1 1v9l-1 1h-15l-1-1v-9ZM10.8 13.2h2.4l-.5 4.6h-1.4Z";
/** 창에서 쓰는 얇은 선 자물쇠. 24 칸 기준. */
export const LOCK_LINE_PATH = "M8 10V6.5L10 4h4l2 2.5V10M5.5 10h13l1 1v8.5l-1 1h-13l-1-1V11ZM12 14v3";

interface DestinationMapProps {
  /** 목록이나 이름표에 커서가 올라간 지역. 지도와 목록이 함께 밝아진다. */
  linkedId: string | null;
  onLink: (id: string | null) => void;
  onPress: (destination: Destination) => void;
}

interface MapTagProps {
  destination: Destination;
  isLinked: boolean;
  onLink: (id: string | null) => void;
  onPress: () => void;
}

function MapTag({ destination, isLinked, onLink, onPress }: MapTagProps) {
  const { id, tag, isOpen, name } = destination;
  const x = mapX(destination.lon),
    y = mapY(destination.lat);
  const isTagWest = tag.x + tag.w < x;
  const anchorX = isTagWest ? tag.x + tag.w : tag.x;
  const anchorY = tag.y + tag.h / 2;
  const lineBendX = anchorX + (isTagWest ? 18 : -18);

  return (
    <g
      className={`dest-map-tag${isOpen ? " is-open" : ""}${isLinked ? " is-linked" : ""}`}
      data-dest-button
      role="button"
      aria-label={isOpen ? `${name} 선택` : `${name} 잠김`}
      onClick={onPress}
      onPointerEnter={() => onLink(id)}
      onPointerLeave={() => onLink(null)}
    >
      <polyline
        className="dest-map-tag__line"
        pathLength={1}
        points={`${x},${y} ${lineBendX},${anchorY} ${anchorX},${anchorY}`}
      />
      <circle className="dest-map-tag__ping" cx={x} cy={y} r={7} />
      <circle className="dest-map-tag__dot" cx={x} cy={y} r={isOpen ? 5 : 3.5} />
      <rect className="dest-map-tag__box" x={tag.x} y={tag.y} width={tag.w} height={tag.h} rx={tag.h / 2} />
      {/* 누르는 자리만 위아래로 넓힌다 — 태블릿에서 이름표가 34px 라 손가락에 작았다(보이는 모양은 그대로) */}
      <rect
        className="dest-map-tag__hit"
        x={tag.x - 6}
        y={tag.y - tag.h * 0.25}
        width={tag.w + 12}
        height={tag.h * 1.5}
      />
      {isOpen ? (
        <text className="dest-map-tag__name" x={tag.x + tag.w / 2} y={anchorY + 1}>
          {name}
        </text>
      ) : (
        <>
          <svg x={tag.x + 14} y={anchorY - 10} width={20} height={20} viewBox="0 0 24 24">
            <path className="dest-map-tag__lock" d={LOCK_LINE_PATH} />
          </svg>
          <text className="dest-map-tag__name" x={tag.x + 64} y={anchorY + 1}>
            {name}
          </text>
        </>
      )}
    </g>
  );
}

const ALL_REGIONS_PATH = KOREA_REGION_PATHS.map(({ path }) => path).join("");

/** 시도 경계 지도와 목적지 이름표. 경계선을 타고 빛 띠가 아래에서 위로 올라간다. */
export default function DestinationMap({ linkedId, onLink, onPress }: DestinationMapProps) {
  const naju = DESTINATIONS[0];
  const najuX = mapX(naju.lon),
    najuY = mapY(naju.lat);

  return (
    <svg className="dest-map" viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} aria-label="대한민국 지도">
      <defs>
        <linearGradient id="dest-scan-gradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.82" stopColor="#fff" stopOpacity="0.85" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id="dest-scan-mask" maskUnits="userSpaceOnUse" x="0" y="0" width={MAP_WIDTH} height={MAP_HEIGHT}>
          <rect className="dest-map__scan" x="0" y="0" width={MAP_WIDTH} height="260" fill="url(#dest-scan-gradient)" />
        </mask>
      </defs>

      {KOREA_REGION_PATHS.map(({ name, path }) => (
        <path key={name} className={`dest-map__region${name === "전남" ? " is-home" : ""}`} d={path} pathLength={1} />
      ))}
      <path className="dest-map__laser" d={ALL_REGIONS_PATH} mask="url(#dest-scan-mask)" />

      <circle className="dest-map__island" cx={mapX(DOKDO.lon) + DOKDO_SIDE_OFFSET} cy={mapY(DOKDO.lat)} r={3.5} />

      <circle className="dest-map__pulse" cx={najuX} cy={najuY} r={24} />
      <path className="dest-map__naju" d={NAJU_PATH} />
      <circle
        className="dest-map__naju-hit"
        data-dest-button
        role="button"
        aria-label="나주 선택"
        cx={najuX}
        cy={najuY}
        r={30}
        onClick={() => onPress(naju)}
        onPointerEnter={() => onLink(naju.id)}
        onPointerLeave={() => onLink(null)}
      />

      {DESTINATIONS.map((destination) => (
        <MapTag
          key={destination.id}
          destination={destination}
          isLinked={linkedId === destination.id}
          onLink={onLink}
          onPress={() => onPress(destination)}
        />
      ))}
    </svg>
  );
}
