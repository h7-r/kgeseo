"""G1~G3 승인 이력 영속 저장소 v0.1 (팀 검토 대기, 내부 서비스 전용 · HTTP 경로 없음).

`app.services.approval_history`의 계약(PM v0.4.3 `ReviewRecord` · `gate_decisions`)을 그대로 쓰고,
메모리 `ApprovalLog`와 같은 규칙으로 MySQL 테이블 `content_reviews`에 저장한다.

[추가만 한다] `append_review`만 있다. 고치거나 지우는 함수는 없다.
- 같은 review_id는 두 번 저장하지 않는다(`DuplicateReviewError`, PK로 보장 · 동시 요청도 한 건만).
- `supersedes`는 이미 저장된 기록만 가리킬 수 있다(`UnknownSupersedesError`, FK로도 보장).
- 철회 · 반려는 기존 기록을 바꾸지 않고, 직전 기록을 `supersedes`로 가리키는 새 미승인 기록(사유 필수)을
  추가해서 한다. 최종 결정은 판정할 때 관문마다 가장 늦은 기록이다(`gate_decisions`).
- 승인 기록을 만드는 HTTP · 관리자 경로는 없다. 이 함수는 검증된 게시 절차(내부 서비스)만 부른다.

[조회] `load_approval_source`는 한 (subject_id, version)의 기록을 읽어 게이트가 쓰는 동기
`ApprovalSource`로 돌려준다. 읽는 동안 공유 잠금을 잡으므로, 같은 트랜잭션 안에서 게시 판정을 끝낼 때까지
그 key에 새 기록(철회 포함)이 끼어들지 않는다. 트랜잭션은 부르는 쪽이 끝낸다.
- DB 오류 · 저장값이 계약을 어긴 행이면 읽은 기록을 쓰지 않고, 부르면 `ApprovalSourceUnavailableError`를
  던지는 출처를 돌려준다(게이트는 APPROVALS FAIL).
- 미리 읽지 않은 key를 물으면 같은 오류다(다른 버전 · 다른 케이스의 기록을 빌려 쓰지 않는다).
- 다른 fingerprint의 승인은 `gate_decisions`가 쓰지 않는다(target_hash 비교).
"""

from collections.abc import Sequence
from datetime import datetime, timezone

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.content_review import ContentReview
from app.services.approval_history import (
    ApprovalSource,
    ApprovalSourceUnavailableError,
    DuplicateReviewError,
    ReviewRecord,
    UnknownSupersedesError,
)

MAX_SUBJECT_ID_LENGTH = 128
_REVIEWED_AT_FORMAT = "%Y-%m-%dT%H:%M:%S.%fZ"


class InvalidReviewSubjectError(ValueError):
    pass


async def append_review(
    db: AsyncSession, subject_id: str, subject_version: int, record: ReviewRecord
) -> None:
    """기록 한 건을 추가하고 commit한다. 실패하면 rollback하고 예외를 그대로 알린다."""

    if not isinstance(record, ReviewRecord):
        raise TypeError("append_review only accepts ReviewRecord")
    _check_subject(subject_id, subject_version)
    try:
        if await _exists(db, record.review_id):
            raise DuplicateReviewError(record.review_id)
        if record.supersedes is not None and not await _exists(db, record.supersedes):
            raise UnknownSupersedesError(record.supersedes)
        db.add(_to_row(subject_id, subject_version, record))
        await db.commit()
    except IntegrityError as error:
        # 확인과 저장 사이에 같은 review_id가 먼저 저장된 경우(동시 요청)
        await db.rollback()
        if await _exists(db, record.review_id):
            raise DuplicateReviewError(record.review_id) from error
        raise UnknownSupersedesError(record.supersedes) from error
    except BaseException:
        await db.rollback()
        raise


async def load_approval_source(
    db: AsyncSession, subject_id: str, subject_version: int
) -> ApprovalSource:
    try:
        rows = (
            await db.execute(
                select(ContentReview)
                .where(
                    ContentReview.subject_id == subject_id,
                    ContentReview.subject_version == subject_version,
                )
                .order_by(ContentReview.reviewed_at, ContentReview.review_id)
                .with_for_update(read=True)
            )
        ).scalars()
        records = tuple(_to_record(row) for row in rows)
    except (SQLAlchemyError, ValidationError, ValueError):
        return _unavailable_source
    return _preloaded_source(subject_id, subject_version, records)


def _preloaded_source(
    subject_id: str, subject_version: int, records: Sequence[ReviewRecord]
) -> ApprovalSource:
    def source(requested_id: str, requested_version: int) -> Sequence[ReviewRecord]:
        if (requested_id, requested_version) != (subject_id, subject_version):
            raise ApprovalSourceUnavailableError()
        return records

    return source


def _unavailable_source(
    subject_id: str, subject_version: int
) -> Sequence[ReviewRecord]:
    raise ApprovalSourceUnavailableError()


def _check_subject(subject_id: str, subject_version: int) -> None:
    if (
        not isinstance(subject_id, str)
        or not subject_id.strip()
        or len(subject_id) > MAX_SUBJECT_ID_LENGTH
        or isinstance(subject_version, bool)
        or not isinstance(subject_version, int)
        or subject_version < 1
    ):
        raise InvalidReviewSubjectError("subject")


async def _exists(db: AsyncSession, review_id: str) -> bool:
    found = await db.scalar(
        select(ContentReview.review_id).where(ContentReview.review_id == review_id)
    )
    return found is not None


def _to_row(
    subject_id: str, subject_version: int, record: ReviewRecord
) -> ContentReview:
    return ContentReview(
        review_id=record.review_id,
        subject_id=subject_id,
        subject_version=subject_version,
        gate=record.gate,
        target_hash=record.target_hash,
        decision=record.decision,
        reviewer=record.reviewer,
        reviewed_at=datetime.strptime(record.reviewed_at, _REVIEWED_AT_FORMAT),
        reason=record.reason,
        supersedes=record.supersedes,
        recorded_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )


def _to_record(row: ContentReview) -> ReviewRecord:
    # 저장값도 계약 검증을 다시 거친다(DB에서 고쳐진 행은 ValidationError → 출처 사용 불가).
    reviewed_at = row.reviewed_at
    return ReviewRecord(
        review_id=row.review_id,
        gate=row.gate,
        target_hash=row.target_hash,
        decision=row.decision,
        reviewer=row.reviewer,
        reviewed_at=reviewed_at.strftime("%Y-%m-%dT%H:%M:%S.")
        + f"{reviewed_at.microsecond // 1000:03d}Z",
        reason=row.reason,
        supersedes=row.supersedes,
    )
