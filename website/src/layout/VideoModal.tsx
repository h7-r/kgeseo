import { createPortal } from "react-dom";

import Player from "@/layout/videoPlayer/Player";
import { useVideoModalRequest } from "@/state/videoModal";

/**
 * 원·카드를 누르면 그 자리에서 커지며 뜨는 큰 영상 플레이어. App 에 한 번만 놓는다.
 * 1920 무대는 transform 으로 줄어 있어 그 안에서는 fixed 가 무대 기준이 된다 — body 에 포털로 그린다.
 */
export default function VideoModal() {
  const request = useVideoModalRequest();
  if (!request) return null;
  // 새로 열 때마다(다른 영상·다른 장면) 상태를 처음부터.
  return createPortal(<Player key={`${request.video.src}@${request.startTime}`} request={request} />, document.body);
}
