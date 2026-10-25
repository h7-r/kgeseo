"""P4-B2 실행 준비 — 요청 인자 · 답 정제 · 비용 · 전송 문 · 예산 차단 · 공통 사례 · 공개 가능 검사 · 기록 · 재현 정보.

실제 요청 · SDK 설치 · 모델 다운로드 없이 돈다(가짜 클라이언트 · 오프라인 전송).
"""

import json
import re
import socket
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from conftest import BACKEND_CASES
from pydantic import ValidationError

from companion_npc.contracts.spoiler import normalize
from companion_npc.llm_net.openai_chat import (
    ALLOW_ENV,
    OpenAIChatTransport,
    classify,
    network_allowed,
)
from companion_npc.speech.compare import OfflineEchoTransport
from companion_npc.speech.evaluate import load_sources
from companion_npc.speech.guard import SAFE_PHRASES
from companion_npc.speech.llm import (
    CLOSERS,
    OPENERS,
    BudgetLedger,
    BudgetLimit,
    ChatResponse,
    LLMConfig,
    LLMGenerator,
    TransportError,
    actual_cost,
    build_messages,
    build_request,
    clean_reply,
)
from companion_npc.speech.p4b2 import (
    P4B2Config,
    audit_input,
    build_common_cases,
    load_private_texts,
    local_preflight,
    planned_requests,
    reproduction,
    run_p4b2,
    summary_is_clean,
    verify_file_sha256,
)

ROOT = Path(__file__).resolve().parents[1]
FAKE_KEY = "sk-test" + "1" * 24
pytestmark = pytest.mark.skipif(
    not (BACKEND_CASES / "case_001.client.json").is_file(), reason="backend not found"
)


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def refuse(*args, **kwargs):
        raise AssertionError("network access attempted")

    monkeypatch.setattr(socket.socket, "connect", refuse)
    monkeypatch.setattr(socket, "create_connection", refuse)
    monkeypatch.delenv(ALLOW_ENV, raising=False)


def _raw(name):
    data = json.loads((ROOT / "experiments" / "p4" / name).read_text(encoding="utf-8"))
    return {k: v for k, v in data.items() if not k.startswith("_")}


@pytest.fixture(scope="module")
def gpt():
    return P4B2Config.model_validate(_raw("p4b2_gpt.json"))


@pytest.fixture(scope="module")
def qwen():
    return P4B2Config.model_validate(_raw("p4b2_qwen.json"))


@pytest.fixture(scope="module")
def sources(gpt):
    return load_sources(gpt, ROOT)


@pytest.fixture(scope="module")
def private(gpt):
    return load_private_texts(ROOT, gpt.private_files)


@pytest.fixture(scope="module")
def payload(sources):
    from datetime import datetime

    cases, _ = build_common_cases(
        sources, datetime.fromisoformat("2026-10-26T12:00:00+09:00"), []
    )
    from companion_npc.speech.generators import TemplateGenerator
    from companion_npc.speech.guard import SpeechGuard
    from companion_npc.speech.pipeline import speak

    c = next(c for c in cases if c.plan.kind == "hint")
    merged, terms = sources[c.source]
    out = speak(c.context, c.plan, merged, TemplateGenerator(), SpeechGuard(merged.pack, terms), now=datetime.fromisoformat("2026-10-26T12:00:00+09:00"))  # fmt: skip
    return out.payload


# ── 1. 설정 · 재현 정보 ─────────────────────────────────────────
def test_configs_are_valid_unapproved_and_within_caps(gpt, qwen):
    for c in (gpt, qwen):
        assert c.execution_approved is False
        assert planned_requests(c) == 92 <= c.generator.budget.max_requests == 100
        assert c.generator.missing_for_run() == []
        assert c.expected_cases == 36 and c.arms == ["select", "free"]
    g = gpt.generator
    assert (
        g.model == "gpt-6-luna"
        and g.reasoning_effort == "none"
        and g.budget.max_usd == 2.0
    )
    assert (
        g.prices.source.startswith("https://developers.openai.com/")
        and g.prices.checked_at
    )
    assert gpt.model_record.sdk == "openai==3.29.0"
    q = qwen.generator
    assert local_preflight(q) == []
    assert (
        qwen.model_record.file == "Qwen3-4B-Q4_K_M.gguf"
        and qwen.model_record.license == "apache-2.0"
    )
    assert len(qwen.model_record.file_sha256) == 64
    assert (
        qwen.model_record.runtime is None
        and qwen.model_record.verified_locally is False
    )  # 설치 때 채운다


def test_requirements_llm_pins_sdk_separately():
    text = (ROOT / "requirements-llm.txt").read_text(encoding="utf-8")
    assert "openai==3.29.0" in text.splitlines()
    assert "openai" not in (ROOT / "requirements.txt").read_text(encoding="utf-8")


def test_plan_over_cap_is_rejected():
    raw = _raw("p4b2_gpt.json")
    raw["plan"] = raw["plan"] | {"repeat_cases": 20}
    with pytest.raises(ValidationError, match="requests > cap"):
        P4B2Config.model_validate(raw)


def test_local_server_must_be_localhost():
    base = {"generator": "qwen_local", "provider": "openai_compatible_local", "model": "m", "budget": {"max_usd": 0, "max_requests": 1}}  # fmt: skip
    for url in (
        "http://192.168.0.5:8080/v1",
        "http://0.0.0.0:8080/v1",
        "https://example.com/v1",
    ):
        with pytest.raises(ValidationError, match="localhost"):
            LLMConfig.model_validate(base | {"base_url": url})
    ok = LLMConfig.model_validate(
        base | {"base_url": "http://127.0.0.1:8080/v1", "disable_thinking": True}
    )
    assert local_preflight(ok) == []
    assert "disable_thinking must be true for Qwen3" in local_preflight(ok.model_copy(update={"disable_thinking": False}))  # fmt: skip


def test_reproduction_info_has_no_secret(gpt):
    info = reproduction(gpt, _raw("p4b2_gpt.json"), ROOT)
    assert (
        info["generator_config"]["model"] == "gpt-6-luna"
        and len(info["source_sha256"]) == 64
    )
    assert info["model_record"]["sdk"] == "openai==3.29.0"
    assert "openai" in info["packages"]  # 설치 전에는 None
    dumped = json.dumps(info)
    assert (
        "sk-" not in dumped
        and info["generator_config"]["api_key_env"] == "OPENAI_API_KEY"
    )


# ── 2. 요청 인자 · 답 정제 · 비용 ──────────────────────────────────
def test_openai_request_arguments(gpt, payload):
    for mode in ("select", "free"):
        cfg = gpt.generator.model_copy(update={"prompt_mode": mode})
        req = build_request(build_messages(payload, mode), cfg)
        assert req["model"] == "gpt-6-luna" and req["reasoning_effort"] == "none"
        assert req["max_completion_tokens"] == 256 and req["store"] is False
        assert req["temperature"] == 0.7  # reasoning_effort=none 일 때만 보낸다
        fmt = req["response_format"]
        assert fmt["type"] == "json_schema" and fmt["json_schema"]["strict"] is True
        assert fmt["json_schema"]["schema"]["additionalProperties"] is False
        assert "extra_body" not in req and "top_k" not in req
    effort = gpt.generator.model_copy(update={"reasoning_effort": "low"})
    req = build_request(build_messages(payload), effort)
    assert (
        "temperature" not in req and "top_p" not in req
    )  # 추론을 켜면 샘플링 인자를 빼야 한다


def test_local_request_arguments(qwen, payload):
    cfg = qwen.generator.model_copy(update={"prompt_mode": "free"})
    messages = build_messages(payload, "free", no_think=cfg.disable_thinking)
    req = build_request(messages, cfg)
    assert messages[0]["content"].endswith("/no_think")
    assert "reasoning_effort" not in req and "store" not in req
    assert req["extra_body"] == {
        "top_k": 20,
        "min_p": 0.0,
        "chat_template_kwargs": {"enable_thinking": False},
    }
    assert req["temperature"] == 0.7 and req["top_p"] == 0.8


def test_clean_reply_strips_thinking_and_fences():
    assert (
        clean_reply('<think>\n\n</think>\n{"text": "a", "used": []}')
        == '{"text": "a", "used": []}'
    )
    assert clean_reply('```json\n{"x": 1}\n```') == '{"x": 1}'
    for bad in ("<think> 정답은 … {", '{"text": "a"} </think>'):
        with pytest.raises(TransportError) as error:
            clean_reply(bad)
        assert error.value.kind == "format"


def test_select_mode_can_only_choose_safe_words(gpt, payload):
    norm_safe = {normalize(p) for p in SAFE_PHRASES}
    assert all(
        normalize(p) in norm_safe for p in OPENERS + CLOSERS if p
    )  # 전부 검증기의 안전 문구
    cfg = gpt.generator.model_copy(update={"prompt_mode": "select"})
    ledger = BudgetLedger(cfg.budget)

    class Reply:
        def __init__(self, text):
            self.text = text

        def complete(self, messages, config, api_key):
            return ChatResponse(self.text, tokens_in=10, tokens_out=5)

    gen = LLMGenerator(
        cfg,
        ledger,
        Reply('{"opener": "좋아요.", "closer": "힘내세요."}'),
        env={"OPENAI_API_KEY": FAKE_KEY},
    )
    draft = gen.generate(payload)
    assert draft.text == f"좋아요. {payload.approved_hint.text} 힘내세요."
    assert draft.used_labels == (payload.approved_hint.label,)
    for bad in (
        '{"opener": "정답은 X 예요.", "closer": ""}',
        '{"text": "자유 문장"}',
        "not json",
    ):
        with pytest.raises(TransportError):
            LLMGenerator(
                cfg, ledger, Reply(bad), env={"OPENAI_API_KEY": FAKE_KEY}
            ).generate(payload)


def test_truncated_or_refused_replies_are_not_used(gpt, payload):
    cfg = gpt.generator.model_copy(update={"prompt_mode": "free"})
    for response in (
        ChatResponse(
            '{"text": "a", "us', tokens_in=1, tokens_out=1, finish_reason="length"
        ),
        ChatResponse("", tokens_in=1, tokens_out=1, refusal="cannot help"),
        ChatResponse('{"text": "a"}', tokens_in=1, tokens_out=1),  # 스키마 필드 누락
    ):
        transport = SimpleNamespace(complete=lambda m, c, k, r=response: r)
        gen = LLMGenerator(
            cfg, BudgetLedger(cfg.budget), transport, env={"OPENAI_API_KEY": FAKE_KEY}
        )
        with pytest.raises(TransportError):
            gen.generate(payload)
        assert gen.last_error_kind == "format"


def test_actual_cost_uses_cached_price_and_counts_reasoning_once(gpt):
    cfg = gpt.generator
    r = ChatResponse(
        "x", tokens_in=1000, tokens_out=200, cached_tokens=400, reasoning_tokens=50
    )
    expected = (600 * 0.10 + 400 * 0.01 + 200 * 0.50) / 1e6
    assert actual_cost(r, cfg) == pytest.approx(expected)
    assert actual_cost(ChatResponse("x"), cfg) is None  # 사용량이 없으면 모른다


# ── 3. 전송 문 · 오류 분류 · 예산 ────────────────────────────────
def _fake_client(response=None, error=None, calls=None):
    def create(**kwargs):
        calls.append(kwargs)
        if error:
            raise error
        return response

    def factory(**kwargs):
        calls.append({"client": {k: v for k, v in kwargs.items() if k != "api_key"}, "has_key": bool(kwargs.get("api_key"))})  # fmt: skip
        return SimpleNamespace(
            chat=SimpleNamespace(completions=SimpleNamespace(create=create))
        )

    return factory


def _sdk_response(text='{"text": "좋아요.", "used": []}'):
    usage = SimpleNamespace(prompt_tokens=900, completion_tokens=40, prompt_tokens_details=SimpleNamespace(cached_tokens=0), completion_tokens_details=SimpleNamespace(reasoning_tokens=0))  # fmt: skip
    choice = SimpleNamespace(
        message=SimpleNamespace(content=text, refusal=None), finish_reason="stop"
    )
    return SimpleNamespace(choices=[choice], usage=usage)


def test_network_gate_needs_both_approval_and_env(gpt):
    assert not network_allowed(False, {ALLOW_ENV: "1"})
    assert not network_allowed(True, {})
    assert network_allowed(True, {ALLOW_ENV: "1"})
    calls = []
    for approved, env in ((False, {ALLOW_ENV: "1"}), (True, {})):
        t = OpenAIChatTransport(
            approved, _fake_client(_sdk_response(), calls=calls), env=env
        )
        with pytest.raises(TransportError) as error:
            t.complete([{"role": "user", "content": "x"}], gpt.generator, FAKE_KEY)
        assert error.value.kind == "unavailable"
    assert calls == []  # 클라이언트를 만들지도 않았다
    assert "openai" not in sys.modules  # SDK 를 불러오지 않았다


def test_transport_maps_usage_and_disables_sdk_retries(gpt):
    calls = []
    t = OpenAIChatTransport(
        True, _fake_client(_sdk_response(), calls=calls), env={ALLOW_ENV: "1"}
    )
    r = t.complete(build_messages_stub(), gpt.generator, FAKE_KEY)
    assert (
        r.tokens_in,
        r.tokens_out,
        r.cached_tokens,
        r.reasoning_tokens,
        r.finish_reason,
    ) == (900, 40, 0, 0, "stop")
    assert (
        calls[0]["client"] == {"timeout": 30, "max_retries": 0} and calls[0]["has_key"]
    )
    assert calls[1]["reasoning_effort"] == "none"
    assert FAKE_KEY not in json.dumps(calls, ensure_ascii=False)


def build_messages_stub():
    return [{"role": "system", "content": "s"}, {"role": "user", "content": "{}"}]


def test_error_classification():
    def err(name, **attrs):
        return (
            type(name, (Exception,), {})()
            if not attrs
            else type(name, (Exception,), attrs)()
        )

    assert classify(err("APITimeoutError")) == "timeout"
    assert classify(err("APIConnectionError")) == "connection"
    assert classify(err("RateLimitError")) == "rate_limit"
    assert classify(err("RateLimitError", code="insufficient_quota")) == "quota"
    assert classify(err("AuthenticationError")) == "auth"
    assert classify(err("BadRequestError")) == "client"
    assert classify(err("InternalServerError")) == "server"
    assert classify(err("Weird", status_code=503)) == "server"


def test_sdk_error_message_is_dropped(gpt):
    class AuthenticationError(Exception):
        pass

    calls = []
    t = OpenAIChatTransport(True, _fake_client(error=AuthenticationError(f"bad key {FAKE_KEY}"), calls=calls), env={ALLOW_ENV: "1"})  # fmt: skip
    with pytest.raises(TransportError) as error:
        t.complete(build_messages_stub(), gpt.generator, FAKE_KEY)
    assert (
        error.value.kind == "auth"
        and FAKE_KEY not in str(error.value)
        and error.value.__cause__ is None
    )


def _run(config, sources, private, transport, tmp_path, **kw):
    return run_p4b2(config, sources, transport, tmp_path, private_texts=private, env={"OPENAI_API_KEY": FAKE_KEY}, **kw)  # fmt: skip


def test_dry_run_full_plan_and_same_inputs(gpt, sources, private, tmp_path):
    result = _run(gpt, sources, private, OfflineEchoTransport(), tmp_path)
    s = result["summary"]
    assert s["stop_reason"] is None and s["sent_requests"] == 92
    assert s["phase_counts"] == {
        "smoke": 4,
        "arm": 72,
        "repeat": 16,
        "check_in_baseline": 4,
    }
    assert s["input_mismatch_between_arms"] == []
    assert s["check_in_baseline"]["all_template"] is True
    assert s["ledger"]["estimated_usd"] < 0.05  # 92 요청 보수적 상한
    assert (
        s["consistency"]["free"]["cases"] == 8
        and s["consistency"]["free"]["runs_per_case"] == 3
    )
    assert summary_is_clean(s, [t for _, terms in sources for t in terms] + private)


def test_budget_cap_stops_the_run(gpt, sources, private, tmp_path):
    cfg = gpt.model_copy(update={"generator": gpt.generator.model_copy(update={"budget": BudgetLimit(max_usd=2.0, max_requests=10)})})  # fmt: skip
    s = _run(cfg, sources, private, OfflineEchoTransport(), tmp_path)["summary"]
    assert s["stop_reason"] == "BudgetExceeded" and s["sent_requests"] == 10
    money = gpt.model_copy(update={"generator": gpt.generator.model_copy(update={"budget": BudgetLimit(max_usd=0.0015, max_requests=100)})})  # fmt: skip
    s = _run(money, sources, private, OfflineEchoTransport(), tmp_path)["summary"]
    assert (
        s["stop_reason"] == "BudgetExceeded"
        and s["ledger"]["charged_for_cap_usd"] <= 0.0015
    )


def test_quota_error_stops_and_estimate_is_kept(gpt, sources, private, tmp_path):
    class Quota:
        calls = 0

        def complete(self, messages, config, api_key):
            Quota.calls += 1
            raise TransportError("quota")

    s = _run(gpt, sources, private, Quota(), tmp_path)["summary"]
    assert s["stop_reason"] == "transport:quota" and Quota.calls == 1
    assert (
        s["ledger"]["actual_unknown_requests"] == 1
        and s["ledger"]["charged_for_cap_usd"] > 0
    )  # 과금됐을 수 있다 → 추정 유지


def test_timeouts_are_retried_and_each_attempt_counts(gpt, sources, private, tmp_path):
    class Flaky:
        n = 0

        def complete(self, messages, config, api_key):
            Flaky.n += 1
            if Flaky.n <= 2:
                raise TransportError("timeout")
            return OfflineEchoTransport().complete(messages, config, api_key)

    s = _run(gpt, sources, private, Flaky(), tmp_path, sleep=lambda x: None)["summary"]
    assert s["stop_reason"] is None and s["sent_requests"] == 94  # 92 + 실패 시도 2


def test_records_and_raw_stay_in_restricted_path(gpt, sources, private, tmp_path):
    _run(gpt, sources, private, OfflineEchoTransport(), tmp_path)
    base = tmp_path / "runs" / "restricted" / "p4b2_gpt_dryrun"
    assert {p.name for p in base.iterdir()} == {
        "records.jsonl",
        "raw.jsonl",
        "rating_form.csv",
        "rating_key.json",
    }
    form = (base / "rating_form.csv").read_text(encoding="utf-8-sig")
    assert (
        "gpt_rag" not in form and "select" not in form.split("\n", 1)[1]
    )  # 군 · 생성기를 가렸다
    key = json.loads((base / "rating_key.json").read_text(encoding="utf-8"))
    assert len(key) == 72 + 16 and all("generator" in k for k in key)
    assert FAKE_KEY not in (base / "raw.jsonl").read_text(encoding="utf-8")


# ── 4. 공통 사례 · 공개 가능 검사 ─────────────────────────────────
def test_common_cases_are_36_and_exclude_answer_bearing_inputs(sources, private):
    from datetime import datetime

    cases, audit = build_common_cases(
        sources, datetime.fromisoformat("2026-10-26T12:00:00+09:00"), private
    )
    assert len(cases) == 36 == audit["included"]
    assert {e["item_id"].split("/")[1] for e in audit["excluded"]} == {
        "player_alias_probe"
    }
    assert all(c.plan.kind != "check_in" for c in cases)
    assert audit["kinds"] == {"clarify": 8, "nudge": 8, "hint": 20}


def test_audit_catches_answers_ids_private_and_personal_data(sources, private):
    merged, terms = sources[0]
    assert audit_input("평범한 문장", merged, terms, private) == []
    assert "answer_or_alias" in audit_input(f"혹시 {terms[0]}?", merged, terms, private)
    assert "internal_id" in audit_input(
        merged.pack.puzzles[0].puzzle_id, merged, terms, private
    )
    assert "private_fixture_text" in audit_input(private[0], merged, terms, private)
    assert "personal_data_pattern" in audit_input(
        "연락처 010-1234-5678", merged, terms, private
    )
    assert "personal_data_pattern" in audit_input(
        "메일 someone@example.com", merged, terms, private
    )


def test_verify_file_sha256(tmp_path):
    f = tmp_path / "x.bin"
    f.write_bytes(b"abc")
    assert verify_file_sha256(
        f, "BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD"
    )
    assert not verify_file_sha256(f, "0" * 64)


# ── 5. 범위 ──────────────────────────────────────────────────
def test_only_llm_net_may_reach_the_network():
    for path in (ROOT / "src" / "companion_npc").rglob("*.py"):
        if "llm_net" in path.parts:
            continue
        text = path.read_text(encoding="utf-8")
        for banned in (
            "import openai",
            "import httpx",
            "import requests",
            "urllib.request",
            "http.client",
        ):
            assert banned not in text, (path, banned)
    source = (ROOT / "src" / "companion_npc" / "llm_net" / "openai_chat.py").read_text(
        encoding="utf-8"
    )
    assert "import openai" not in source  # 승인된 실행에서만 importlib 로 불러온다


def test_restricted_outputs_are_git_ignored():
    for probe in ("runs/restricted/p4b2_gpt/raw.jsonl", "runs/restricted/p4b2_gpt/cache/x.json", "runs/restricted/p4b2_gpt/ledger.json", "models/Qwen3-4B-Q4_K_M.gguf"):  # fmt: skip
        assert (
            subprocess.run(
                ["git", "check-ignore", "-q", probe], cwd=ROOT, check=False
            ).returncode
            == 0
        ), probe


def test_client_error_stops_the_run(gpt, sources, private, tmp_path):
    class BadRequest:
        calls = 0

        def complete(self, messages, config, api_key):
            BadRequest.calls += 1
            raise TransportError(
                "client"
            )  # 예: 지원하지 않는 인자 → 모든 요청에 되풀이된다

    s = _run(gpt, sources, private, BadRequest(), tmp_path)["summary"]
    assert s["stop_reason"] == "transport:client" and BadRequest.calls == 1


def test_smoke_phase_can_run_alone(gpt, sources, private, tmp_path):
    s = _run(
        gpt, sources, private, OfflineEchoTransport(), tmp_path, phases=("smoke",)
    )["summary"]
    assert s["sent_requests"] == 4 and s["phase_counts"] == {
        "smoke": 4,
        "check_in_baseline": 4,
    }


# ── 6. 외부 전송용 가상 사건 평가 세트 (p4b2-fictional/1.0) ─────────────────
from companion_npc.speech.p4b2 import (  # noqa: E402
    ExternalTransferPolicy,
    external_transfer_problems,
    ledger_path,
)


@pytest.fixture(scope="module")
def fictional():
    return P4B2Config.model_validate(_raw("p4b2_gpt_fictional.json"))


@pytest.fixture(scope="module")
def fictional_sources(fictional):
    return load_sources(fictional, ROOT)


@pytest.fixture(scope="module")
def policy():
    return ExternalTransferPolicy.model_validate(_raw("external_transfer.json"))


def test_external_transfer_policy_blocks_real_case(gpt, qwen, fictional, policy):
    assert "case_001" in policy.denied_cases and "case_001" not in policy.allowed_cases
    problems = external_transfer_problems(gpt, policy)  # 원래 36건(case_001 포함)
    assert any("case_001" in p for p in problems)
    assert external_transfer_problems(fictional, policy) == []
    assert external_transfer_problems(qwen, policy) == []  # 로컬은 외부 전송이 아니다
    renamed = fictional.model_copy(update={"cases": [c.model_copy(update={"cases_dir": "../../backend/app/content/cases"}) for c in fictional.cases]})  # fmt: skip
    assert any(
        "test fixture path" in p for p in external_transfer_problems(renamed, policy)
    )


def test_fictional_set_keeps_36_and_the_kind_mix(fictional, fictional_sources, private):
    from datetime import datetime

    now = datetime.fromisoformat(fictional.now)
    cases, audit = build_common_cases(fictional_sources, now, private)
    assert fictional.eval_set == "p4b2-fictional/1.0" and len(cases) == 36
    assert audit["kinds"] == {
        "clarify": 8,
        "nudge": 8,
        "hint": 20,
    }  # 원래 세트와 같은 분포
    assert {c.case_id for c in cases} == {
        "case_fixture_archive",
        "case_fixture_lighthouse",
    }
    assert sum(c.case_id == "case_fixture_lighthouse" for c in cases) == 17


def test_fictional_payloads_carry_nothing_from_the_real_case(
    fictional, fictional_sources, sources, private
):
    """외부 전송 페이로드 재검증 — 모든 사건의 정답 · 별칭, 실제 사건의 문구 · 이름, 내부 ID, 세션 값이 없어야 한다."""

    from datetime import datetime

    from companion_npc.contracts.spoiler import find_answer_leaks
    from companion_npc.speech.p4b2 import _model_input_text

    now = datetime.fromisoformat(fictional.now)
    real = next(m for m, _ in sources if m.pack.case_id == "case_001")
    # 실제 사건의 한국어 문구(사건 소개 · 힌트 · 지식)는 8자 겹침, 이름 · 설명은 통째로 비교한다.
    # (영어 일반어 겹침 — 예: 'cabinet' — 은 사건 내용이 아니다: docs/08 §9.8)
    real_texts = [k.text for k in real.pack.knowledge] + [
        h.text for h in real.pack.hints
    ]
    hangul = [t for t in real_texts if re.search("[가-힣]", t)]
    real_windows = {
        normalize(t)[i : i + 8]
        for t in hangul
        for i in range(max(len(normalize(t)) - 7, 1))
    }
    real_names = {normalize(o.object_name) for o in real.pack.objects} | {
        normalize(z.zone_name) for z in real.pack.zones
    }
    real_names |= {normalize(t) for t in real_texts if t not in hangul}
    real_names |= {
        normalize(z.description)
        for z in real.pack.zones
        if getattr(z, "description", None)
    }
    all_terms = [t for _, terms in sources + fictional_sources for t in terms]
    cases, _ = build_common_cases(fictional_sources, now, private)
    for c in cases:
        merged, terms = fictional_sources[c.source]
        text, _ = _model_input_text(merged, terms, c, now)
        norm = normalize(text)
        assert not find_answer_leaks({"x": text}, all_terms), c.item_id
        assert not any(w in norm for w in real_windows), c.item_id
        assert not any(n and n in norm for n in real_names), c.item_id
        assert audit_input(text, merged, terms, private) == [], c.item_id
        assert (
            c.context.request_id not in text and c.context.play_session_id not in text
        )


def test_lighthouse_fixture_is_new_test_content(fictional_sources, sources):
    npc = json.loads((ROOT / "tests" / "fixtures" / "npc" / "case_fixture_lighthouse.npc.json").read_text(encoding="utf-8"))  # fmt: skip
    assert npc["publication"]["approved_by"] == "test-fixture"
    assert all(h["approved_by"] == "test-fixture" for h in npc["hints"])
    light = next(
        m for m, _ in fictional_sources if m.pack.case_id == "case_fixture_lighthouse"
    )
    real = next(m for m, _ in sources if m.pack.case_id == "case_001")
    assert not {o.object_name for o in light.pack.objects} & {
        o.object_name for o in real.pack.objects
    }
    assert not {z.zone_name for z in light.pack.zones} & {
        z.zone_name for z in real.pack.zones
    }


def test_eval_sets_are_distinguishable(
    gpt, fictional, sources, fictional_sources, private, tmp_path
):
    a = _run(gpt, sources, private, OfflineEchoTransport(), tmp_path)["summary"]
    b = _run(fictional, fictional_sources, private, OfflineEchoTransport(), tmp_path)[
        "summary"
    ]
    assert (a["eval_set"], b["eval_set"]) == ("p4b2-mixed/0.1", "p4b2-fictional/1.0")
    assert (
        a["eval_set_manifest"]["item_ids_sha256"]
        != b["eval_set_manifest"]["item_ids_sha256"]
    )
    assert b["eval_set_manifest"]["by_case"] == {
        "case_fixture_archive": 19,
        "case_fixture_lighthouse": 17,
    }


class BadRequestError(Exception):
    status_code, code, type, param = (
        400,
        "unsupported_parameter",
        "invalid_request_error",
        "temperature",
    )
    message = "Unsupported parameter: temperature (key " + FAKE_KEY + ")"


def test_bad_request_cause_is_recorded_and_run_stops(
    fictional, fictional_sources, private, tmp_path
):
    calls = []
    transport = OpenAIChatTransport(
        True, _fake_client(error=BadRequestError(), calls=calls), env={ALLOW_ENV: "1"}
    )
    s = run_p4b2(fictional, fictional_sources, transport, tmp_path, private_texts=private, env={"OPENAI_API_KEY": FAKE_KEY}, dry_run=False)["summary"]  # fmt: skip
    assert s["stop_reason"] == "transport:client" and s["sent_requests"] == 1
    assert s["stop_detail"] == {"kind": "client", "status_code": 400, "code": "unsupported_parameter", "type": "invalid_request_error", "param": "temperature"}  # fmt: skip
    errors = (
        tmp_path / "runs" / "restricted" / "p4b2_gpt_fictional" / "errors.jsonl"
    ).read_text(encoding="utf-8")
    assert (
        "Unsupported parameter" in errors and FAKE_KEY not in errors
    )  # 원인은 제한 경로에 · 키는 가림
    assert "Unsupported parameter" not in json.dumps(
        s, ensure_ascii=False
    )  # 요약에는 메시지 본문 없음


class NotFoundError(Exception):
    status_code = 404


def test_model_access_check_does_not_generate(fictional):
    calls = []

    def factory(**kw):
        return SimpleNamespace(
            models=SimpleNamespace(retrieve=lambda m: calls.append(m) or SimpleNamespace(id=m, owned_by="system")),
            chat=SimpleNamespace(completions=SimpleNamespace(create=lambda **k: calls.append("create"))),
        )  # fmt: skip

    t = OpenAIChatTransport(True, factory, env={ALLOW_ENV: "1"})
    assert t.check_model_access(fictional.generator, FAKE_KEY) == {
        "model": "gpt-6-luna",
        "owned_by": "system",
    }
    assert calls == ["gpt-6-luna"]  # 생성 요청 없음

    def denied(**kw):
        def retrieve(m):
            raise NotFoundError()

        return SimpleNamespace(models=SimpleNamespace(retrieve=retrieve))

    with pytest.raises(TransportError) as error:
        OpenAIChatTransport(True, denied, env={ALLOW_ENV: "1"}).check_model_access(
            fictional.generator, FAKE_KEY
        )
    assert error.value.kind == "client" and error.value.detail["status_code"] == 404
    with pytest.raises(TransportError):
        OpenAIChatTransport(False, factory, env={ALLOW_ENV: "1"}).check_model_access(
            fictional.generator, FAKE_KEY
        )


def test_budget_ledger_is_shared_across_config_versions(
    fictional, fictional_sources, private, tmp_path
):
    v2 = fictional.model_copy(
        update={"config_version": "2", "exp_id": "p4b2_gpt_fictional_v2"}
    )
    assert ledger_path(tmp_path, fictional) == ledger_path(tmp_path, v2)
    small = fictional.generator.model_copy(
        update={"budget": BudgetLimit(max_usd=2.0, max_requests=6)}
    )

    def run(c):
        c = c.model_copy(update={"generator": small})
        return run_p4b2(c, fictional_sources, OfflineEchoTransport(), tmp_path, private_texts=private, env={"OPENAI_API_KEY": FAKE_KEY}, dry_run=False, phases=("smoke",))["summary"]  # fmt: skip

    first, second = run(fictional), run(v2)
    assert first["sent_requests"] == 4  # 연결 확인 4건
    assert (
        second["stop_reason"] == "BudgetExceeded" and second["sent_requests"] == 6
    )  # 판을 바꿔도 장부가 이어진다


def test_cli_refuses_overwrite_and_unapproved_execution(monkeypatch):
    from companion_npc.speech.__main__ import main

    cfg = str(ROOT / "experiments" / "p4" / "p4b2_gpt.json")
    if (ROOT / "experiments" / "results" / "p4b2_gpt_dryrun" / "summary.json").exists():
        assert (
            main(["--mode", "p4b2", "--config", cfg, "--publish"]) == 2
        )  # 다른 평가 세트 결과를 덮어쓰지 않음
    monkeypatch.setenv(ALLOW_ENV, "1")
    fict = str(ROOT / "experiments" / "p4" / "p4b2_gpt_fictional.json")
    assert (
        main(["--mode", "p4b2", "--config", fict, "--execute"]) == 2
    )  # execution_approved=false
    assert "openai" not in sys.modules
