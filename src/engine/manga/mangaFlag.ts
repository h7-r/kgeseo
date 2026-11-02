/**
 * 만화 화풍 스위치 — 주소에 `?만화=off` 가 없으면 켜진다(나주맵과 같은 스위치 이름).
 * 엔진 쪽(글꼴 등 로드 때 정해지는 것)도 읽어야 해서 엔진에 둔다. app/runtimeFlags 가 다시 내보낸다.
 */
const query = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();

export const IS_MANGA_STYLE = query.get("만화") !== "off";
