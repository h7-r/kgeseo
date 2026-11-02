"""HTTP 경계에서 세션별 콘텐츠 로더를 고른다 v0.1 (팀 검토 대기).

- 레거시 세션(버전 칼럼 둘 다 NULL): 기존 기본 로더
- 고정 세션: 저장소에서 그 `(case_id, content_version, content_fingerprint)` 묶음을 찾아 그 로더.
  없거나 fingerprint가 다르면 오류(최신 버전으로 바꾸지 않는다).

저장소 `get_pinned_content_store()`는 **비어 있는 메모리 저장소**이고, 콘텐츠를 등록하는 HTTP 경로는 없다.
공식 게시 검증 · 파일 로더가 생기기 전까지 고정 세션은 HTTP에서 늘 `CASE_VERSION_UNAVAILABLE`이다.
테스트는 FastAPI `dependency_overrides`로 저장소를 바꿔 끼운다.
"""

from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.play_session import ContentPinColumnsError, PlaySession
from app.services.case_content import load_case_client_content
from app.services.interaction import ClientContentLoader, RuntimeLoader
from app.services.pinned_content import (
    PinnedContentError,
    PinnedContentStore,
    resolve_session_content,
)
from app.services.puzzle_runtime import load_case_runtime

# 오류 응답 detail. 계약(NPC 콘텐츠 데이터 계약 v0.3 §6)의 코드 이름을 그대로 쓴다.
CASE_VERSION_UNAVAILABLE = "CASE_VERSION_UNAVAILABLE"
# 라우터가 409로 바꾸는 예외
CONTENT_VERSION_ERRORS = (PinnedContentError, ContentPinColumnsError)

_EMPTY_STORE = PinnedContentStore()


def get_pinned_content_store() -> PinnedContentStore:
    """FastAPI 의존성. 기본은 빈 저장소(등록 경로 없음)."""

    return _EMPTY_STORE


@dataclass(frozen=True)
class SessionLoaders:
    runtime_loader: RuntimeLoader
    client_content_loader: ClientContentLoader


DEFAULT_LOADERS = SessionLoaders(load_case_runtime, load_case_client_content)


async def resolve_session_loaders(
    db: AsyncSession, play_session_id: str, store: PinnedContentStore
) -> SessionLoaders:
    """세션이 없으면 기본 로더를 돌려준다(없는 세션 404는 기존 서비스가 낸다)."""

    play_session = await db.get(PlaySession, play_session_id)
    if play_session is None:
        return DEFAULT_LOADERS
    try:
        bundle = resolve_session_content(play_session, store)
    except CONTENT_VERSION_ERRORS:
        await db.rollback()
        raise
    if bundle is None:
        return DEFAULT_LOADERS
    return SessionLoaders(bundle.runtime_loader(), bundle.client_content_loader())
