"""콘텐츠 읽기 전용 응답(관리자 API v0.3 3단계 P3-3, 미르 11/13: 게시 상태 · 판 · fingerprint 포함, 정답은 절대 안 나감).

여기 실리는 것은 식별자 · 버전 · fingerprint 저장값 · 게시 상태 · 이력 · client 콘텐츠에서 센 개수뿐이다.
서버 런타임(판정 · 정답) · NPC 대사 원문 · 콘텐츠 원문은 어느 모델에도 없다.
"""

from datetime import datetime

from pydantic import BaseModel


class ContentCounts(BaseModel):
    zones: int
    objects: int
    interactions: int


class ContentVersion(BaseModel):
    content_version: int
    # DB 에 등록된 값 그대로(재계산하지 않는다)
    content_fingerprint: str
    publication_status: str | None
    registered_at: datetime
    state_updated_at: datetime | None
    # 그 버전의 client 콘텐츠를 읽을 수 있을 때만. 못 읽으면 null(추측하지 않는다)
    counts: ContentCounts | None


class ContentCase(BaseModel):
    case_id: str
    # published = 게시 기록 표에 등록된 사건 · legacy = 콘텐츠 폴더의 옛 사건(버전 없음)
    source: str
    legacy: bool
    versions: list[ContentVersion]
    # 레거시 사건은 폴더의 client 파일에서, 게시 사건은 가장 높은 버전에서 센 값. 못 읽으면 null
    counts: ContentCounts | None


class ContentList(BaseModel):
    cases: list[ContentCase]


class ContentZone(BaseModel):
    zone_id: str
    zone_name: str
    zone_type: str
    objects: int
    interactions: int


class ContentEvent(BaseModel):
    content_version: int
    from_status: str | None
    to_status: str
    reason: str
    actor: str
    at: datetime


class ContentCaseDetail(BaseModel):
    case_id: str
    source: str
    legacy: bool
    # 존 목록 — client 콘텐츠를 읽을 수 있을 때만(아니면 빈 목록 + counts null)
    zones: list[ContentZone]
    interactions_by_type: dict[str, int]
    counts: ContentCounts | None
    versions: list[ContentVersion]
    # 게시 이력 최근 20건(최신순)
    events: list[ContentEvent]
