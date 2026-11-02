"""G1~G3 게시 승인 이력 v0.4.3 (PM v0.4.3, 팀 검토 대기 · DB 저장소 없음 · 라우터 미연결).

[기록 한 건 — `ReviewRecord`]
    review_id    UUID v4(소문자 정규형)
    gate         G1 · G2 · G3
    target_hash  "sha256:" + 64자 소문자 hex (공식 content_fingerprint 와 같은 형식)
    decision     approved · revise · escalate · rejected · hold
    reviewer     100자 이하
    reviewed_at  ISO 8601 UTC 밀리초 문자열("2026-10-29T03:04:05.123Z")
    reason       미승인(approved 가 아닌 결정) · 재승인에서 필수
    supersedes   직전 유효 기록의 review_id. 재승인에서 필수

[판정 — `gate_decisions`]
- 지금 다시 계산한 fingerprint 와 `target_hash` 가 같은 기록만 본다(다른 해시는 이전 내용의 기록).
- 관문마다 (reviewed_at, review_id) 순으로 정렬해 마지막 기록이 최종 결정이다.
- 이력이 계약을 어기면(사유 누락 · supersedes 불일치 · review_id 중복) 그 관문은 FAIL(`invalid history`).
- 세 관문 모두 최종 결정이 approved 일 때만 PASS. revise · escalate · rejected · hold 는 FAIL.

[저장 — `ApprovalLog`] append-only 메모리 저장소. 수정 · 삭제 메서드가 없고, 같은 review_id 를 두 번 받지 않으며,
`supersedes` 는 이미 있는 기록만 가리킬 수 있다. 영속 저장(DB)은 아직 없다 — 테이블 · Alembic 마이그레이션이
필요하다(이번 단계에서 만들지 않는다).

[신뢰 경계] 콘텐츠 JSON 안의 `approvals`(`NpcApprovalRecord`)는 쓰지 않는다. 승인은 검증된 게시 절차가 넘기는
이 기록만 본다.

[이전 형식] v0.4.2 까지의 `ApprovalRecord(gate, decision, target_hash, approver, decided_at)` 는 review_id ·
reason · supersedes 가 없고 결정이 둘뿐이라 변환하지 않는다. 그런 객체가 오면 호환되지 않는 기록으로 FAIL 이다.
"""

import re
from collections.abc import Callable, Iterable, Sequence
from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

Gate = Literal["G1", "G2", "G3"]
GATES: tuple[Gate, ...] = ("G1", "G2", "G3")
ReviewDecision = Literal["approved", "revise", "escalate", "rejected", "hold"]

TARGET_HASH_PATTERN = r"^sha256:[0-9a-f]{64}$"
REVIEWED_AT_PATTERN = r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$"
MAX_REVIEWER_LENGTH = 100

NonBlank = Annotated[str, StringConstraints(min_length=1)]


class ReviewRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    review_id: str
    gate: Gate
    target_hash: str = Field(pattern=TARGET_HASH_PATTERN)
    decision: ReviewDecision
    reviewer: NonBlank = Field(max_length=MAX_REVIEWER_LENGTH)
    reviewed_at: str = Field(pattern=REVIEWED_AT_PATTERN)
    reason: str | None = None
    supersedes: str | None = None

    @model_validator(mode="after")
    def validate_record(self) -> "ReviewRecord":
        if not _is_uuid4(self.review_id):
            raise ValueError("review_id must be a lowercase UUID v4")
        if self.supersedes is not None and not _is_uuid4(self.supersedes):
            raise ValueError("supersedes must be a lowercase UUID v4")
        if not self.reviewer.strip():
            raise ValueError("reviewer must not be blank")
        _parse_reviewed_at(self.reviewed_at)
        if self.reason is not None and not self.reason.strip():
            raise ValueError("reason must be omitted or not blank")
        # 미승인 결정은 늘 사유가 있어야 한다. 재승인 조건은 이력 안에서만 알 수 있다(gate_decisions).
        if self.decision != "approved" and self.reason is None:
            raise ValueError("reason is required for a non-approved decision")
        return self

    @property
    def order_key(self) -> tuple[datetime, str]:
        return _parse_reviewed_at(self.reviewed_at), self.review_id


def _is_uuid4(value: str) -> bool:
    try:
        parsed = UUID(value)
    except (ValueError, AttributeError, TypeError):
        return False
    return parsed.version == 4 and str(parsed) == value


def _parse_reviewed_at(value: str) -> datetime:
    if re.fullmatch(REVIEWED_AT_PATTERN, value) is None:
        raise ValueError("reviewed_at must be ISO 8601 UTC with milliseconds")
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ")


# --- 판정 ---


def gate_decisions(records: Iterable[object], fingerprint: str) -> tuple[str, ...]:
    """FAIL 이유 목록(관문 · 이유 코드만). 비어 있으면 PASS."""

    items = list(records)
    if any(not isinstance(item, ReviewRecord) for item in items):
        return ("incompatible approval record",)
    reviews: list[ReviewRecord] = items  # type: ignore[assignment]
    known_ids = [r.review_id for r in reviews]
    if len(known_ids) != len(set(known_ids)):
        return ("duplicate review_id",)

    reasons: list[str] = []
    for gate in GATES:
        current = sorted(
            (r for r in reviews if r.gate == gate and r.target_hash == fingerprint),
            key=lambda r: r.order_key,
        )
        if not current:
            stale = any(r.gate == gate for r in reviews)
            reasons.append(f"{gate}:{'stale target_hash' if stale else 'missing'}")
            continue
        if not _valid_history(current, set(known_ids)):
            reasons.append(f"{gate}:invalid history")
            continue
        final = current[-1].decision
        if final != "approved":
            reasons.append(f"{gate}:{final}")
    return tuple(reasons)


def _valid_history(history: Sequence[ReviewRecord], known_ids: set[str]) -> bool:
    for index, record in enumerate(history):
        previous = history[index - 1] if index else None
        if previous is None:
            # 이 해시의 첫 기록은 이전 내용의 기록을 가리킬 수 있다(있는 기록이어야 한다).
            if record.supersedes is not None and record.supersedes not in known_ids:
                return False
            continue
        if record.supersedes is not None and record.supersedes != previous.review_id:
            return False
        if record.decision == "approved" and (
            record.reason is None or record.supersedes is None
        ):
            # 재승인: 사유와 직전 기록 ID 가 모두 필요하다.
            return False
    return True


# --- append-only 저장 ---


class DuplicateReviewError(ValueError):
    pass


class UnknownSupersedesError(ValueError):
    pass


ApprovalSource = Callable[[str, int], Sequence[ReviewRecord]]


class ApprovalLog:
    """(case_id, content_version) 별 승인 기록. 추가만 할 수 있다."""

    def __init__(self) -> None:
        self._records: dict[tuple[str, int], list[ReviewRecord]] = {}
        self._ids: set[str] = set()

    def append(self, case_id: str, content_version: int, record: ReviewRecord) -> None:
        if not isinstance(record, ReviewRecord):
            raise TypeError("ApprovalLog only accepts ReviewRecord")
        if record.review_id in self._ids:
            raise DuplicateReviewError(record.review_id)
        if record.supersedes is not None and record.supersedes not in self._ids:
            raise UnknownSupersedesError(record.supersedes)
        self._records.setdefault((case_id, content_version), []).append(record)
        self._ids.add(record.review_id)

    def records(self, case_id: str, content_version: int) -> tuple[ReviewRecord, ...]:
        return tuple(self._records.get((case_id, content_version), ()))

    def source(self) -> ApprovalSource:
        return self.records
