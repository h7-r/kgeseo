from companion_npc.contracts.spoiler import find_answer_leaks


def test_detects_answer_through_case_and_punctuation():
    texts = {"a": "정답은 v-a-l-v-e 같아요", "b": "쪽지를 다시 보세요"}
    assert find_answer_leaks(texts, ["VALVE"]) == ["a"]


def test_alias_must_be_given_explicitly():
    # 번역은 모른다 — 별칭을 넣어야 잡는다 (spoiler.py 의 한계 참조)
    texts = {"a": "그건 밸브예요"}
    assert find_answer_leaks(texts, ["VALVE"]) == []
    assert find_answer_leaks(texts, ["VALVE", "밸브"]) == ["a"]


def test_empty_terms_never_match():
    assert find_answer_leaks({"a": "아무 말"}, ["", "  "]) == []
