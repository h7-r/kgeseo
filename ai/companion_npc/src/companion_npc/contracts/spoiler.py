"""정답 누설 검사 — 문장 안에 정답이 들어 있는가.

[어디서 돌리나]
  accepted_answers 가 필요하므로 **서버 쪽에서만** 돌린다.
    · 팩을 만들 때: 승인 힌트·지식 조각 전부 (ScenarioPack.safety_audit 에 결과 기록)
    · 발화 직후: 생성된 문장 (NpcUtterance.safety 에 결과 기록)
  정답 문자열을 LLM 이나 클라이언트에 건네는 일은 없다.

[한계]
  글자 단위 비교다. 띄어쓰기·대소문자·문장부호를 지워서 찾으므로 "V-A-L-V-E" 는 잡지만,
  뜻으로 돌려 말하거나("손잡이 달린 그 부품") 한 글자씩 흘리는 건 못 잡는다.
  의미 수준 검사는 파이프라인 설계요청 §8 H3 처럼 별도 검사기로 둔다(P4).
"""

import re
import unicodedata

_STRIP = re.compile(r"[\s\W_]+", re.UNICODE)


def normalize(text: str) -> str:
    return _STRIP.sub("", unicodedata.normalize("NFKC", text).casefold())


def find_answer_leaks(texts: dict[str, str], forbidden_terms: list[str]) -> list[str]:
    """금지어가 들어 있는 문장의 key 목록. 비어 있으면 통과.

    forbidden_terms = accepted_answers + 사람이 정한 별칭. 예: 정답 "VALVE" 라면
    "밸브" 도 같은 뜻이므로 함께 넣어야 한다 — 이 함수는 번역을 모른다.
    """

    terms = [t for t in (normalize(x) for x in forbidden_terms) if t]
    return [
        key for key, text in texts.items() if any(t in normalize(text) for t in terms)
    ]
