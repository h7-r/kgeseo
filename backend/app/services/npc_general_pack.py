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

from pydantic import ValidationError
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.gate_review import ApprovalTarget
from app.schemas.npc_content import GeneralLinePack
from app.services.approval_history import ApprovalSource
from app.services.npc_case_access import _records
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
