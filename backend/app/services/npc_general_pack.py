"""공식 일반 대사 팩 공급 · DB 승인 판정 v0.1 (PM v0.4.12, 팀 검토 대기).

[파일] 공식 팩은 코드 저장소의 `backend/content/npc_general/<pack_id>/v<pack_version>.json`에 둔다(비밀 정보 없음).
테스트 팩은 테스트 코드 안에서만 만든다(이 경로를 쓰지 않는다).

[공급] 설정 `NPC_GENERAL_PACK`(`<pack_id>/v<pack_version>`)을 운영자가 명시적으로 넣었을 때만 그 파일을 읽는다.
비어 있으면(기본) 일반 팩이 없다. 파일이 없거나 · 형식이 틀리거나 · 파일 안의 pack_id · 버전이 설정과 다르면 공급하지 않는다
(fail closed, 오류 로그에는 설정 값 · 이유 코드만).
일반 팩의 게시 · 중단 상태 계약은 아직 없다. 그래서 「승인됨 = 게시됨」으로 보지 않고, 공급은 설정으로만 켠다.
멈추는 방법은 설정을 비우고 재시작하거나(공급 중단), 승인을 철회하는 것(다음 요청부터 반영)이다.

[승인] `npc_approval_reviews`의 `(dialogue_pack, pack_id, pack_version)` 기록만 본다. 판정은 기존처럼
`gate_decisions()`가 팩 fingerprint(`general_pack_fingerprint`)의 G1~G3로 한다(`general_pack_approved`).
케이스 승인(`case_content`)과 섞지 않는다. DB 오류 · 계약을 어긴 행이면 승인 없음(fail closed).
읽기 방식 · 잠금 순서는 케이스 판정(`npc_case_access`)과 같다: 계산 전에는 잠금 없이, 확정 트랜잭션에서는 공유 잠금으로
승인 대상 행 → 이력 순서로 다시 읽는다(케이스 판정 다음에 읽는다).
"""

import logging
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from pydantic import ValidationError
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.npc_publication import PUBLICATION_STATUSES
from app.repositories.npc_publication import NpcPublicationRepository
from app.schemas.gate_review import ApprovalTarget
from app.schemas.npc_content import GeneralLinePack
from app.services.approval_history import ApprovalSource
from app.services.dialogue_pack_policy import PublishedCase
from app.services.hint import server_hint_text
from app.services.npc_case_access import _records
from app.services.pinned_content import (
    ContentPin,
    PinnedContentError,
    PinnedContentStore,
)
from app.services.publication_approval import snapshot_source

logger = logging.getLogger(__name__)

GENERAL_PACK_ROOT = Path(__file__).resolve().parents[2] / "content" / "npc_general"
_PACK_SETTING = re.compile(r"^([a-z0-9_]{1,64})/v([1-9][0-9]{0,8})$")


@dataclass(frozen=True)
class GeneralPackAccess:
    # 팩 승인 출처. None이면 팩 대사는 모두 미승인
    approval_source: ApprovalSource | None
    # 판정 근거(읽은 승인 기록 ID). 확정 때 다시 읽은 값과 다르면 다시 계산한다.
    basis: tuple = ()


NO_PACK_APPROVAL = GeneralPackAccess(None, basis=("unavailable",))

GeneralPackReader = Callable[..., Awaitable[GeneralPackAccess]]


class GeneralPackLoadError(ValueError):
    """공식 팩을 읽지 못했다. 메시지는 이유 코드만 담는다."""


def general_pack_path(setting: str, root: Path = GENERAL_PACK_ROOT) -> Path:
    match = _PACK_SETTING.fullmatch(setting)
    if match is None:
        raise GeneralPackLoadError("invalid_setting")
    return root / match[1] / f"v{match[2]}.json"


def load_general_pack(setting: str, root: Path = GENERAL_PACK_ROOT) -> GeneralLinePack:
    path = general_pack_path(setting, root)
    try:
        raw = path.read_bytes()
    except OSError as error:
        raise GeneralPackLoadError("file_missing") from error
    try:
        pack = GeneralLinePack.model_validate_json(raw)
    except ValidationError as error:
        raise GeneralPackLoadError("invalid_pack") from error
    if f"{pack.pack_id}/v{pack.pack_version}" != setting:
        raise GeneralPackLoadError("id_mismatch")
    return pack


@lru_cache(maxsize=4)
def configured_general_pack(setting: str) -> GeneralLinePack | None:
    """설정한 공식 팩. 설정이 비었거나 읽지 못하면 None(공급 없음)."""

    if not setting:
        return None
    try:
        return load_general_pack(setting)
    except GeneralPackLoadError as error:
        logger.error("general pack not supplied: setting=%s reason=%s", setting, error)
        return None


async def read_general_pack_access(
    db: AsyncSession, pack: GeneralLinePack, *, lock: bool
) -> GeneralPackAccess:
    try:
        target = ApprovalTarget(
            target_type="dialogue_pack",
            target_id=pack.pack_id,
            content_version=pack.pack_version,
        )
    except ValidationError:
        return NO_PACK_APPROVAL
    try:
        records = await _records(db, target, lock=lock)
    except (SQLAlchemyError, ValidationError, ValueError):
        logger.warning(
            "general pack approval unavailable: pack_id=%s pack_version=%s",
            pack.pack_id,
            pack.pack_version,
        )
        return NO_PACK_APPROVAL
    return GeneralPackAccess(
        snapshot_source(target, records),
        basis=tuple(record.review_id for record in records),
    )


async def read_published_cases(
    db: AsyncSession, store: PinnedContentStore
) -> tuple[PublishedCase, ...] | None:
    """일반 팩 정책 검사(GEN-LEAK · GEN-CASE)의 대조 대상인 게시 케이스(PM v0.4.14 §A).

    범위: 게시 DB(`npc_publication_states`)에서 published · suspended · blocked인 버전(진행 중 세션에 제공되는 버전,
    팀 결정 11/4). 레거시 `case_001`은 게시 체계 밖이라 넣지 않는다. 내용은 메모리 저장소의 검증된 게시본에서 읽는다.
    DB를 읽지 못하거나, 한 버전이라도 저장소에 없거나 fingerprint가 다르면 None(전체를 확인할 수 없음 → UNVERIFIED).
    잠금 없이 마지막 commit 값을 읽는다. 게시 확정 직후 저장소 등록 전에는 None이다(그동안 일반 팩은 쓰지 않는다).
    """

    try:
        states = await NpcPublicationRepository(db).all_states()
    except Exception:
        logger.warning("published cases unavailable for general pack policy")
        await db.rollback()
        return None
    cases = []
    for state in states:
        if state.status not in PUBLICATION_STATUSES:
            logger.warning(
                "unknown publication status: case_id=%s content_version=%s",
                state.case_id,
                state.content_version,
            )
            return None
        try:
            bundle = store.get(
                ContentPin(
                    state.case_id, state.content_version, state.content_fingerprint
                )
            )
        except PinnedContentError:
            logger.warning(
                "published case not in store: case_id=%s content_version=%s",
                state.case_id,
                state.content_version,
            )
            return None
        cases.append(
            PublishedCase(
                case_id=state.case_id,
                content_version=state.content_version,
                runtime=bundle.server(),
                npc=bundle.npc(),
                hint_source=bundle.hint_source(server_hint_text),
            )
        )
    return tuple(cases)


async def published_cases_from_files(
    sessions: Any, root: str
) -> tuple[PublishedCase, ...] | None:
    """관리 명령용: 게시 루트 원본으로 임시 저장소를 채운 뒤 `read_published_cases`와 같은 규칙으로 읽는다(읽기 전용).

    게시 루트가 비었거나 원본을 읽지 못한 버전이 있으면 None이다(게시 케이스가 0개면 빈 목록).
    """

    from pathlib import Path as _Path

    from app.services.content_release import sync_published_content
    from app.services.npc_publication import NpcPublicationService

    store = PinnedContentStore()
    if root:
        try:
            await sync_published_content(
                NpcPublicationService(sessions), store, _Path(root)
            )
        except Exception:
            logger.warning("published content sync failed for general pack policy")
            return None
    async with sessions() as db:
        cases = await read_published_cases(db, store)
        await db.rollback()
    return cases
