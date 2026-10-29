"""오답 지문 — 「같은 오답을 반복하나」를 원문 없이 알기 위한 해시.

[승인된 데이터 처리 경계]
  interaction_events.payload_json 에는 플레이어가 친 답 **원문**이 있다. 지문은 그 원문을
  읽을 수 있는 곳(서버 쪽 신뢰 구간)에서만 만든다. 이 클래스는 비밀 키 없이는 만들어지지
  않으며, 키는 저장소·로그·보고서에 남기지 않는다(.env 로만 받는다).
  키를 받지 못하면 지문이 없고, 반복 특성은 unobservable 이 된다.

[지문을 만들지 않는 것]
  **정답(correct)** 의 답. 4자리 숫자 같은 짧은 정답은 지문으로부터 거꾸로 맞혀 볼 수 있다.

[세션마다 다르다]
  play_session_id 를 섞어 해시하므로, 같은 오답이라도 다른 플레이어 사이에서는 이어지지 않는다.
"""

import hashlib
import hmac

MIN_KEY_BYTES = 16


def normalize_answer(value: str) -> str:
    # backend services/puzzle_runtime.normalize_answer 와 같다 — 채점과 같은 기준으로 묶는다.
    return "".join(value.split()).casefold()


class AnswerFingerprinter:
    def __init__(self, key: bytes) -> None:
        if not isinstance(key, bytes) or len(key) < MIN_KEY_BYTES:
            raise ValueError(f"fingerprint key must be at least {MIN_KEY_BYTES} bytes")
        self._key = key

    def __repr__(self) -> str:  # 키를 찍지 않는다
        return "AnswerFingerprinter(<key hidden>)"

    def fingerprint(self, play_session_id: str, answer: str) -> str:
        message = f"{play_session_id}\x1f{normalize_answer(answer)}".encode()
        return hmac.new(self._key, message, hashlib.sha256).hexdigest()[:32]
