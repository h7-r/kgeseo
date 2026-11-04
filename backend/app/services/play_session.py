from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.anonymous_session import AnonymousSession
from app.models.play_session import PlaySession
from app.schemas.case_content import CaseClientContent
from app.services.case_content import (
    CaseClientContentJSONDecodeError,
    CaseClientContentNotFoundError,
    CaseClientContentValidationError,
    InvalidClientCaseIdError,
    load_case_client_content,
)
from app.services.hint_balance import hint_economy_config
from app.services.pinned_content import (
    ContentCaseMismatchError,
    ContentPin,
    PinnedContent,
)

ClientContentLoader = Callable[[str], CaseClientContent]
# 고정 세션을 새로 만들 때 같은 DB 트랜잭션에서 게시 상태를 확인한다. 허용하지 않으면 PinnedContentError를 던진다.
# 운영 구현은 `app.services.content_release.require_published_for_new_session`이다.
PublicationGuard = Callable[[AsyncSession, ContentPin], Awaitable[None]]


# Router가 "익명 세션을 찾지 못했다"는 상황을 구분할 수 있도록
# Service 전용 예외를 만든다.
class AnonymousSessionNotFoundError(Exception):
    pass


# 익명 세션은 존재하지만 이미 만료된 경우를 구분하기 위한 예외
class AnonymousSessionExpiredError(Exception):
    pass


class PlaySessionNotFoundError(Exception):
    pass


class PlaySessionInvalidCaseIdError(Exception):
    pass


class PlaySessionCaseNotFoundError(Exception):
    pass


class PlaySessionCaseContentUnavailableError(Exception):
    pass


async def create_play_session(
    db: AsyncSession,
    anonymous_session_id: str,
    case_id: str,
    *,
    client_content_loader: ClientContentLoader | None = None,
    pinned_content: PinnedContent | None = None,
    publication_guard: PublicationGuard | None = None,
    initial_hint_balance: int | None = None,
) -> PlaySession:
    """
    새로운 PlaySession을 생성하고 DB에 저장한다.

    `pinned_content`(검증을 마친 버전 고정 묶음)를 주면 그 묶음의 Client 콘텐츠로 상태를 만들고,
    같은 행에 `content_version` · `content_fingerprint`를 함께 저장한다(같은 INSERT · 같은 commit).
    주지 않으면 지금처럼 버전 없는(레거시) 세션을 만든다.

    고정 세션은 `publication_guard`가 필수다. INSERT와 같은 트랜잭션에서 게시 상태를 확인하고(공유 잠금을
    commit까지 유지), 신규 세션을 받지 않는 상태면 아무것도 저장하지 않고 그 예외를 그대로 알린다.

    `initial_hint_balance`는 회차 시작 힌트 잔액 N(PM v0.4.8 §4)이다. 주지 않으면 앱 설정
    `HINT_INITIAL_BALANCE`(기본 3)를 쓴다. 처음부터 다시 하면 새 회차라 다시 N으로 시작한다.

    처리 순서:
    1. AnonymousSession 존재 확인
    2. AnonymousSession 만료 확인
    3. Client Content 검증 및 Entry Zone 확인
    4. 초기 게임 상태 생성
    5. PlaySession 생성
    6. DB 저장
    """

    if initial_hint_balance is None:
        initial_hint_balance = hint_economy_config().initial_balance
    if (
        isinstance(initial_hint_balance, bool)
        or not isinstance(initial_hint_balance, int)
        or initial_hint_balance < 0
    ):
        raise ValueError("initial_hint_balance must be a non-negative integer")

    if pinned_content is not None:
        if client_content_loader is not None:
            raise ValueError("pass either client_content_loader or pinned_content")
        if pinned_content.pin.case_id != case_id:
            raise ContentCaseMismatchError(pinned_content.pin.label())
        if publication_guard is None:
            raise ValueError("pinned_content requires publication_guard")

    # Primary Key인 anonymous_session_id를 이용해
    # anonymous_sessions 테이블에서 해당 세션을 찾는다.
    anonymous_session = await db.get(
        AnonymousSession,
        anonymous_session_id,
    )

    # 존재하지 않는 익명 세션 ID라면
    # 게임 플레이를 시작할 수 없다.
    if anonymous_session is None:
        raise AnonymousSessionNotFoundError()

    # 현재 UTC 시간을 구한다.
    now_utc = datetime.now(timezone.utc)

    # MySQL DATETIME은 timezone 자체를 저장하지 않으므로
    # DB에서 사용하는 UTC-naive 형태로 변환한다.
    now_db = now_utc.replace(tzinfo=None)

    # 현재 시간이 익명 세션의 만료 시각 이상이면
    # 이미 사용할 수 없는 세션이다.
    if now_db >= anonymous_session.expires_at:
        raise AnonymousSessionExpiredError()

    if pinned_content is not None:
        loader = pinned_content.client_content_loader()
    else:
        loader = client_content_loader or load_case_client_content
    try:
        client_content = loader(case_id)
    except InvalidClientCaseIdError as error:
        await db.rollback()
        raise PlaySessionInvalidCaseIdError() from error
    except CaseClientContentNotFoundError as error:
        await db.rollback()
        raise PlaySessionCaseNotFoundError() from error
    except (
        CaseClientContentJSONDecodeError,
        CaseClientContentValidationError,
    ) as error:
        await db.rollback()
        raise PlaySessionCaseContentUnavailableError() from error
    except Exception:
        await db.rollback()
        raise

    if pinned_content is not None:
        try:
            await publication_guard(db, pinned_content.pin)
        except BaseException:
            await db.rollback()
            raise

    # 새 게임을 시작할 때의 초기 진행 상태
    initial_state = {
        "current_zone_id": client_content.entry_zone_id,
        "completed_puzzle_ids": [],
        "completed_inspect_ids": [],
        "acquired_clue_ids": [],
        "acquired_item_ids": [],
        "consumed_item_ids": [],
        "completed_scene_ids": [],
        "hint_levels": {},
        "attempt_counts": {},
        "flags": {},
        "object_states": {},
    }

    # 실제 DB에 저장할 PlaySession ORM 객체 생성
    play_session = PlaySession(
        # 한 번의 플레이마다 새로운 UUID를 발급한다.
        id=str(uuid4()),
        # 어떤 익명 사용자가 시작한 플레이인지 연결
        anonymous_session_id=anonymous_session_id,
        # 어떤 사건을 플레이하는지 저장
        case_id=case_id,
        # 최초 게임 상태
        state_json=initial_state,
        # 생성 직후이므로 created_at / updated_at은 동일하다.
        created_at=now_db,
        updated_at=now_db,
        # 아직 게임을 완료하지 않았으므로 NULL
        completed_at=None,
        # 버전 고정 세션이면 시작할 때 쓴 묶음의 버전 · fingerprint(레거시는 둘 다 NULL)
        content_version=pinned_content.pin.content_version if pinned_content else None,
        content_fingerprint=(
            pinned_content.pin.content_fingerprint if pinned_content else None
        ),
        # 회차 시작 힌트 잔액 · 도움 사용 수
        hint_balance=initial_hint_balance,
        help_used=0,
    )

    # INSERT 대상으로 등록
    db.add(play_session)

    try:
        # 실제 MySQL에 저장
        await db.commit()

        # 저장된 최신 값을 ORM 객체에 다시 반영
        await db.refresh(play_session)

    except Exception:
        # commit 도중 오류가 발생하면
        # 현재 DB 작업을 되돌린다.
        await db.rollback()
        raise

    # Router가 응답을 만들 수 있도록 생성된 객체 반환
    return play_session


async def get_play_session(
    db: AsyncSession,
    play_session_id: str,
) -> PlaySession:
    """저장된 PlaySession을 ID로 조회한다."""

    play_session = await db.get(PlaySession, play_session_id)

    if play_session is None:
        raise PlaySessionNotFoundError()

    return play_session
