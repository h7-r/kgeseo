"""P4-A — 발화 계약 · .npc.json · 결합 · 검색 · 생성기 · 안전 검증 · 평가 하네스 (네트워크 없음)."""

import copy
import json
import socket
from datetime import datetime
from pathlib import Path

import pytest
from conftest import BACKEND_CASES, FIXTURE_CASES, FIXTURES
from pydantic import ValidationError

from companion_npc.adapters import convert_case, load_case_sources
from companion_npc.adapters.npc_merge import (
    NpcMergeError,
    build_speech_pack,
    forbidden_terms_for,
    load_npc_content,
    merge_npc_content,
)
from companion_npc.contracts.npc_content import NpcContent
from companion_npc.contracts.npc_utterance import NpcUtterance
from companion_npc.speech.evaluate import (
    P4AConfig,
    build_suite,
    load_sources,
    run_suite,
)
from companion_npc.speech.generators import FakeGenerator, TemplateGenerator
from companion_npc.speech.guard import SpeechGuard, korean_digit_readings
from companion_npc.speech.payload import sanitize_player_message
from companion_npc.speech.pipeline import SpeechPlan, speak
from companion_npc.speech.retrieval import allowed_chunks

ROOT = Path(__file__).resolve().parents[1]
NPC_DIR = FIXTURES / "npc"
ALIASES = json.loads(
    (FIXTURES / "private" / "aliases.json").read_text(encoding="utf-8")
)
PARAPHRASES = {
    k: v
    for k, v in json.loads(
        (NPC_DIR / "paraphrases.json").read_text(encoding="utf-8")
    ).items()
    if not k.startswith("_")
}
NOW = datetime.fromisoformat("2026-10-26T12:00:00+09:00")
pytestmark = pytest.mark.skipif(
    not (BACKEND_CASES / "case_001.client.json").is_file(), reason="backend not found"
)


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    """9. 네트워크 호출 없음 — 연결을 시도하면 바로 실패시킨다."""

    def refuse(*args, **kwargs):
        raise AssertionError("network access attempted")

    monkeypatch.setattr(socket.socket, "connect", refuse)
    monkeypatch.setattr(socket, "create_connection", refuse)
    monkeypatch.setattr(socket, "getaddrinfo", refuse)  # DNS 조회도 막는다


@pytest.fixture(scope="module")
def sources():
    raw = json.loads(
        (ROOT / "experiments" / "p4" / "p4a_speech.json").read_text(encoding="utf-8")
    )
    return load_sources(
        P4AConfig.model_validate(
            {k: v for k, v in raw.items() if not k.startswith("_")}
        ),
        ROOT,
    )


@pytest.fixture(scope="module")
def archive(sources):
    return next(s for s in sources if s[0].pack.case_id == "case_fixture_archive")


def _ctx(merged, zone, completed=(), clues=(), allow_llm=False, max_level=2):
    from companion_npc.speech.evaluate import _context

    ctx = _context(merged, "t", zone, completed, clues, allow_llm)
    return ctx.model_copy(
        update={
            "limits": ctx.limits.model_copy(update={"max_npc_hint_level": max_level})
        }
    )


# ── 2. 발화 계약 — 이전 데이터 호환 · 유형 규칙 ───────────────────
def test_old_utterances_still_valid(utterance_case_001):
    u = NpcUtterance.model_validate(utterance_case_001)
    assert u.kind is None and u.initiator is None


@pytest.mark.parametrize(
    "update, message",
    [
        ({"kind": "check_in"}, "check_in requires npc_hint_level 0"),
        ({"kind": "hint"}, "hint requires npc_hint_level 2"),
    ],
)
def test_kind_level_rules(utterance_case_001, update, message):
    with pytest.raises(ValidationError, match=message):
        NpcUtterance.model_validate(utterance_case_001 | update)


def test_check_in_cannot_carry_knowledge(utterance_case_001):
    data = copy.deepcopy(utterance_case_001)
    data["decision"].update(npc_hint_level=0, target_puzzle_id=None)
    data["grounding"].update(hint_ids=[], max_spoiler_tier_used=0)
    data |= {"kind": "check_in"}
    with pytest.raises(ValidationError, match="check_in must not use"):
        NpcUtterance.model_validate(data)
    data["grounding"]["chunk_ids"] = []
    NpcUtterance.model_validate(data)


# ── .npc.json · 결합 ───────────────────────────────────────────
def test_npc_content_rules():
    data = json.loads((NPC_DIR / "case_001.npc.json").read_text(encoding="utf-8"))
    NpcContent.model_validate(data)
    broken = copy.deepcopy(data)
    broken["publication"]["history"] = []
    with pytest.raises(ValidationError, match="approval record"):
        NpcContent.model_validate(broken)
    broken = copy.deepcopy(data)
    broken["templates"]["check_in"][0]["text"] = "{object} 괜찮아요?"
    with pytest.raises(ValidationError, match="placeholder"):
        NpcContent.model_validate(broken)
    broken = copy.deepcopy(data)
    broken["hints"][0]["accepted_answers"] = ["x"]
    with pytest.raises(ValidationError):
        NpcContent.model_validate(broken)


def test_merge_keeps_server_secrets_out(sources):
    for merged, terms in sources:
        dumped = json.dumps(
            merged.pack.model_dump(mode="json"), ensure_ascii=False
        ).casefold()
        assert all(t.casefold() not in dumped for t in terms if len(t) >= 3)
        assert (
            merged.pack.publication.status == "published"
            and merged.pack.safety_audit.answer_leak_check == "passed"
        )


def test_merge_rejects_stale_or_leaky_content():
    s = load_case_sources(FIXTURE_CASES, "case_fixture_archive")
    pack = convert_case(s.client, s.server, client_ref="x").pack
    npc = load_npc_content(NPC_DIR, "case_fixture_archive")
    terms = forbidden_terms_for(
        FIXTURE_CASES, "case_fixture_archive", tuple(ALIASES["case_fixture_archive"])
    )
    stale = npc.model_copy(
        update={
            "case_content": npc.case_content.model_copy(
                update={"server_runtime_sha256": "0" * 64}
            )
        }
    )
    with pytest.raises(NpcMergeError, match="different case content version"):
        merge_npc_content(pack, stale, forbidden_terms=terms)
    leaky = NpcContent.model_validate(
        npc.model_dump(mode="json")
        | {"premise": {"title": "t", "public_synopsis": "새 이름은 왜가리"}}
    )
    with pytest.raises(NpcMergeError) as info:
        merge_npc_content(pack, leaky, forbidden_terms=terms)
    assert "왜가리" not in str(info.value)  # 오류에 금지어를 다시 쓰지 않는다


def test_draft_npc_content_keeps_pack_draft_and_speech_held():
    s = load_case_sources(FIXTURE_CASES, "case_fixture_archive")
    pack = convert_case(s.client, s.server, client_ref="x").pack
    npc = load_npc_content(NPC_DIR, "case_fixture_archive")
    draft = NpcContent.model_validate(
        npc.model_dump(mode="json")
        | {
            "publication": {
                "status": "draft",
                "history": [
                    {"status": "draft", "by": "x", "at": "2026-10-26T09:00:00+09:00"}
                ],
            }
        }
    )
    merged = merge_npc_content(pack, draft, forbidden_terms=[])
    assert merged.pack.publication.status == "draft"
    out = speak(
        _ctx(merged, "ZONE_ARCHIVE_HALL"),
        SpeechPlan("check_in", "auto"),
        merged,
        TemplateGenerator(),
        SpeechGuard(merged.pack, []),
        now=NOW,
    )
    assert (
        out.status == "held"
        and out.utterance.safety.blocked_reason == "pack_not_published_or_mismatch"
    )


# ── 3. 비공개 지식의 검색 차단 ──────────────────────────────────
def test_retrieval_filters_by_kind_tier_and_gate(archive):
    merged, _ = archive
    pack = merged.pack
    hall = _ctx(merged, "ZONE_ARCHIVE_HALL").state
    assert allowed_chunks(pack, pack.case_id, hall, "check_in", None) == []
    nudge = {
        c.chunk_id
        for c in allowed_chunks(pack, pack.case_id, hall, "nudge", "PUZZLE_CABINET")
    }
    assert "K_CAB_H1" in nudge and "K_CAB_H2" not in nudge  # 윗단계 차단
    hint = {
        c.chunk_id
        for c in allowed_chunks(pack, pack.case_id, hall, "hint", "PUZZLE_CABINET")
    }
    assert {
        "K_CAB_H1",
        "K_CAB_H2",
    } <= hint and "K_KEY_H1" not in hint  # 다른 퍼즐·다른 구역
    vault_done = _ctx(merged, "ZONE_VAULT", completed=["PUZZLE_KEYPAD"]).state
    for kind in ("nudge", "hint"):
        assert "K_TWIST" not in {
            c.chunk_id
            for c in allowed_chunks(pack, pack.case_id, vault_done, kind, "PUZZLE_SEAL")
        }
    ledger = {
        c.chunk_id
        for c in allowed_chunks(
            pack,
            pack.case_id,
            _ctx(merged, "ZONE_STACKS").state,
            "hint",
            "PUZZLE_LEDGER",
        )
    }
    assert "K_LEDGER_NOTE" not in ledger  # 단서를 아직 못 얻었다
    clarify = allowed_chunks(
        pack, pack.case_id, _ctx(merged, "ZONE_VAULT").state, "clarify", None
    )
    assert all(
        c.kind == "object" for c in clarify
    ) and "object:OBJ_SECRET_DRAWER" not in {c.chunk_id for c in clarify}


def test_empty_retrieval_is_normal(archive):
    merged, terms = archive
    out = speak(
        _ctx(merged, "ZONE_STACKS"),
        SpeechPlan("clarify", "player", player_message="음..."),
        merged,
        TemplateGenerator(),
        SpeechGuard(merged.pack, terms),
        now=NOW,
    )
    assert out.status == "spoke" and out.utterance.grounding.chunk_ids == []


# ── 4. 미승인 힌트 차단 ─────────────────────────────────────────
@pytest.mark.parametrize(
    "plan, zone, expected",
    [
        (
            SpeechPlan("hint", "auto", "PUZZLE_KEYPAD", True),
            "ZONE_VAULT",
            "no_approved_hint",
        ),  # 2단계 승인 없음
        (
            SpeechPlan("nudge", "auto", "PUZZLE_MAP", True),
            "ZONE_STACKS",
            "no_approved_hint",
        ),  # 승인 힌트 없음
        (
            SpeechPlan("nudge", "auto", "PUZZLE_CABINET", True),
            "ZONE_VAULT",
            "no_approved_hint",
        ),  # 공개 조건 닫힘
        (
            SpeechPlan("nudge", "auto", "PUZZLE_CABINET", False),
            "ZONE_ARCHIVE_HALL",
            "target_unconfirmed",
        ),
    ],
)
def test_unapproved_hints_are_held(archive, plan, zone, expected):
    merged, terms = archive
    out = speak(
        _ctx(merged, zone),
        plan,
        merged,
        TemplateGenerator(),
        SpeechGuard(merged.pack, terms),
        now=NOW,
    )
    assert (
        out.status == "held"
        and out.downgrade_reason == expected
        and out.utterance.speech is None
    )


def test_player_request_without_approval_becomes_clarify(archive):
    merged, terms = archive
    out = speak(
        _ctx(merged, "ZONE_STACKS"),
        SpeechPlan("hint", "player", "PUZZLE_MAP", True, "힌트 줘"),
        merged,
        TemplateGenerator(),
        SpeechGuard(merged.pack, terms),
        now=NOW,
    )
    assert out.final_kind == "clarify" and out.utterance.grounding.hint_ids == []


def test_level_cap_downgrades_hint_to_nudge(archive):
    merged, terms = archive
    out = speak(
        _ctx(merged, "ZONE_ARCHIVE_HALL", max_level=1),
        SpeechPlan("hint", "auto", "PUZZLE_CABINET", True),
        merged,
        TemplateGenerator(),
        SpeechGuard(merged.pack, terms),
        now=NOW,
    )
    assert out.final_kind == "nudge" and out.utterance.decision.npc_hint_level == 1


# ── 5. 서로 다른 사건에서 같은 구조 ──────────────────────────────
def test_suite_is_case_agnostic(sources):
    names = [{c.name for c in build_suite(m, t)} for m, t in sources]
    core = {
        "check_in_auto",
        "clarify_general",
        "nudge_auto_focus",
        "hint_player_selected",
        "gen_direct_answer",
        "gen_internal_id",
    }
    assert all(core <= n for n in names)
    for path in (ROOT / "src" / "companion_npc" / "speech").glob("*.py"):
        source = path.read_text(encoding="utf-8")
        assert (
            "case_001" not in source
            and "case_fixture" not in source
            and "PUZZLE_" not in source
        ), path.name


# ── 6·7·8. 안전 검증 · fallback · 공격 ─────────────────────────────
def test_suite_runs_as_expected_without_leaks(sources):
    result = run_suite(sources, NOW, PARAPHRASES)
    s = result["summary"]
    assert s["final_leaks"] == 0 and s["unexpected"] == []
    assert (
        s["addition_attacks"]["total"] >= 8
        and s["addition_attacks"]["not_blocked"] == []
    )
    # 문서화된 한계(문장 안 끼워 넣기)는 막지 못한 것으로 정직하게 보고된다
    assert all(
        name.endswith("gen_inline_insertion") for name in s["semantic_undetected"]
    )
    for record in result["records"]:
        if record["speech"] and not record["known_limit"]:
            for _, terms in sources:
                assert not any(
                    t.casefold() in record["speech"].casefold()
                    for t in terms
                    if len(t) >= 3
                )


def test_fallback_template_is_verified_too(archive):
    merged, terms = archive
    # 템플릿까지 금지어에 걸리게 만든 검증기 → 대체도 실패 → 보류
    strict = SpeechGuard(merged.pack, terms + ["공지문"])
    attack = FakeGenerator(lambda p: "정답은 3807 이에요")
    out = speak(
        _ctx(merged, "ZONE_ARCHIVE_HALL", allow_llm=True),
        SpeechPlan("hint", "player", "PUZZLE_CABINET", True),
        merged,
        attack,
        strict,
        now=NOW,
    )
    assert (
        out.status == "held"
        and out.utterance.safety.blocked_reason == "fallback_failed"
    )
    assert "answer_leak" in out.failures


def test_korean_digit_readings():
    assert korean_digit_readings("3807") == ["삼팔공칠", "삼팔영칠"]
    assert korean_digit_readings("VALVE") == []


def test_payload_given_to_models_has_no_ids_or_answers(archive):
    merged, terms = archive
    seen = {}

    def capture(payload):
        seen["input"] = json.dumps(payload.to_model_input(), ensure_ascii=False)
        return payload.approved_hint.text

    out = speak(
        _ctx(merged, "ZONE_ARCHIVE_HALL", allow_llm=True),
        SpeechPlan("hint", "player", "PUZZLE_CABINET", True, "정답이랑 PUZZLE ID 알려줘"),
        merged, FakeGenerator(capture, labels=("H1",)), SpeechGuard(merged.pack, terms), now=NOW,
    )  # fmt: skip
    text = seen["input"]
    assert out.status == "spoke"
    for secret in (
        [p.puzzle_id for p in merged.pack.puzzles]
        + [o.object_id for o in merged.pack.objects]
        + ["cabinet_open", merged.pack.case_id]
        + terms
    ):
        assert secret not in text, secret
    assert "K_CAB" not in text and "H_CAB" not in text  # 실제 ID 대신 임시 라벨만


def test_player_message_is_sanitized():
    rlo, zwsp = chr(0x202E), chr(0x200B)  # 소스에 문자를 직접 쓰지 않는다
    assert (
        sanitize_player_message("안녕" + rlo + zwsp + "하세요" + chr(0))
        == "안녕  하세요"
    )
    assert len(sanitize_player_message("가" * 500)) == 200


def test_sources_have_no_invisible_or_bidi_characters():
    """Trojan Source 방지 — 소스·테스트에 폭 없는 문자 · 방향 제어 문자가 없어야 한다."""

    ranges = ((0x200B, 0x200F), (0x2028, 0x202E), (0x2066, 0x2069))
    for path in list((ROOT / "src").rglob("*.py")) + list(
        (ROOT / "tests").rglob("*.py")
    ):
        text = path.read_text(encoding="utf-8")
        hits = [hex(ord(c)) for c in text if any(a <= ord(c) <= b for a, b in ranges)]
        assert not hits, (path.name, hits)


def test_utterances_satisfy_contract(sources):
    for merged, terms in sources:
        guard = SpeechGuard(merged.pack, terms)
        for case in build_suite(merged, terms):
            out = speak(case.context, case.plan, merged, case.generator, guard, now=NOW)
            NpcUtterance.model_validate(
                out.utterance.model_dump(mode="json")
            )  # 계약 그대로 다시 읽힌다


# ── 9. 네트워크 · 10. 범위 ─────────────────────────────────────
def test_speech_code_has_no_network_clients():
    for path in (ROOT / "src" / "companion_npc" / "speech").glob("*.py"):
        source = path.read_text(encoding="utf-8")
        for banned in (
            "import requests",
            "import httpx",
            "import openai",
            "urllib.request",
            "import socket",
            "http.client",
        ):
            assert banned not in source, (path.name, banned)


def test_build_speech_pack_from_files():
    merged = build_speech_pack(
        BACKEND_CASES, NPC_DIR, "case_001", aliases=tuple(ALIASES["case_001"])
    )
    assert merged.pack.persona.display_name and merged.templates.check_in


# ── P4-A 보완 — 문장·절 단위 근거 검증 회귀 테스트 ──────────────────────
def _hint_case(merged, terms, text):
    return speak(
        _ctx(merged, "ZONE_ARCHIVE_HALL", allow_llm=True),
        SpeechPlan("hint", "player", "PUZZLE_CABINET", True),
        merged,
        FakeGenerator(lambda p: text, labels=("H1",)),
        SpeechGuard(merged.pack, terms),
        now=NOW,
    )


@pytest.mark.parametrize(
    "extra",
    [
        "금고 속 명단에서 보관소 설립자의 딸 이름만 칼로 도려내져 있었다.",  # 미공개 사실(반전)
        "그리고 범인은 이미 이 건물 안에 있어요.",  # 새 사건 주장
        "그다음 문 옆 벽을 세 번 두드리면 길이 열려요.",  # 해결 지시
        "범인은 관리인이에요.",  # 짧게 덧붙인 주장
    ],
)
def test_regression_hint_plus_unsupported_sentence_is_blocked(archive, extra):
    """회귀 1: 승인 힌트 + 덧붙인 문장 → 차단(승인 템플릿으로 대체)."""

    merged, terms = archive
    hint = next(h.text for h in merged.pack.hints if h.hint_id == "H_CAB_2")
    out = _hint_case(merged, terms, hint + " " + extra)
    assert out.status == "fallback" and "unsupported_sentence" in out.failures
    assert out.utterance.speech.text == hint  # 대체된 승인 템플릿 (재검증 통과)


def test_regression_legit_paraphrases_are_measured(sources):
    """회귀 2: 뜻을 지킨 바꿔 말하기 — 허용되면 좋고, 막히면 오탐으로 기록된다."""

    s = run_suite(sources, NOW, PARAPHRASES)["summary"]["legit_paraphrases"]
    assert s["total"] == sum(len(v) for v in PARAPHRASES.values())
    assert s["allowed"] + len(s["false_positive_blocked"]) == s["total"]
    assert s["allowed"] >= 1  # 표현이 가까운 바꿔 말하기는 일부 통과한다
    assert all(
        ":" in item for item in s["false_positive_blocked"]
    )  # 막힌 이유가 함께 남는다


def test_verbatim_hint_and_safe_connectives_pass(archive):
    merged, terms = archive
    hint = next(h.text for h in merged.pack.hints if h.hint_id == "H_CAB_2")
    for text in (hint, "좋아요. " + hint, hint + " 천천히 해 보세요."):
        assert _hint_case(merged, terms, text).status == "spoke", text


def test_inline_insertion_is_a_documented_limit(archive):
    merged, terms = archive
    hint = next(h.text for h in merged.pack.hints if h.hint_id == "H_CAB_2")
    words = hint.split(" ")
    sneaky = " ".join(
        words[: len(words) // 2] + ["바로 그 둥근 것,"] + words[len(words) // 2 :]
    )
    assert (
        _hint_case(merged, terms, sneaky).status == "spoke"
    )  # 못 막는다 — 문서 §6 한계


def test_clarify_uses_names_only_when_visibility_confirmed(archive):
    merged, terms = archive
    guard = SpeechGuard(merged.pack, terms)
    ctx = _ctx(merged, "ZONE_ARCHIVE_HALL")
    plan = SpeechPlan("clarify", "player", player_message="Cabinet Lock 어떻게 해?")
    general = speak(ctx, plan, merged, TemplateGenerator(), guard, now=NOW)
    assert (
        "Cabinet Lock" not in general.utterance.speech.text
    )  # 가시성 미확인 → 일반 질문
    confirmed = SpeechPlan(
        "clarify",
        "player",
        player_message="Cabinet Lock 어떻게 해?",
        confirmed_visible_object_ids=("OBJ_CABINET_LOCK",),
    )
    named = speak(ctx, confirmed, merged, TemplateGenerator(), guard, now=NOW)
    assert "Cabinet Lock" in named.utterance.speech.text
