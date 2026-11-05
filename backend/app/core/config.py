# .env에 있는 MySQL 설정을 Python에서 읽는 파일
from typing import Literal

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import URL

from app.core.deployment import validate_deployment


class Settings(BaseSettings):
    app_env: Literal["development", "test", "production"] = "development"
    # 쿠키를 함께 보내고 쓰기 요청을 할 수 있는 사이트 주소. .env 에는 JSON 배열로 적는다.
    cors_origins: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:5173",
            "http://localhost:5174",
            "http://localhost:5175",
        ]
    )

    @model_validator(mode="after")
    def production_settings(self):
        return validate_deployment(self)

    db_host: str
    db_port: int = 3306
    db_user: str
    db_password: str
    db_name: str
    google_client_id: str = ""
    naver_client_id: str = ""
    naver_client_secret: str = ""
    naver_redirect_uri: str = ""

    # 로그인 쿠키. 실제 서비스(https)에서는 반드시 true 로 둔다.
    session_cookie_secure: bool = False

    # 힌트 잔액(PM v0.4.8 · v0.4.9 §9). 숫자는 PM 확정 뒤 환경 변수로 바꾼다.
    # 회차(play_session) 시작 때 주는 잔액 N
    hint_initial_balance: int = Field(default=3, ge=0)
    # 회차당 재미 미니게임 수 · 특별 미니게임 수(잔액 부족 응답 값. 충전 API는 아직 없다)
    hint_fun_minigames_per_session: int = Field(default=2, ge=0)
    hint_special_minigames_per_session: int = Field(default=1, ge=0)

    # hint_ref 발급 키(운영 비밀). 비어 있으면 hint_ref를 발급하지 않는다(fail closed).
    # 형식: HINT_REF_KEYS="<key id>:<base64url 비밀>[,<key id>:<base64url 비밀>...]"
    hint_ref_current_key_id: str = ""
    hint_ref_keys: SecretStr = SecretStr("")

    # 게시 콘텐츠 원본 루트(<root>/<case_id>/v<version>/*.json). 비어 있으면 서버 시작 때 게시본을 복구하지 않는다.
    # 앱은 이 파일을 쓰지 않는다. 게시한 버전의 파일은 바꾸거나 지우지 않아야 한다(바뀌면 fingerprint 불일치로 비활성).
    published_content_root: str = ""

    # 공식 일반 대사 팩(`<pack_id>/v<pack_version>`, 예: general_default/v1). 비어 있으면 일반 팩을 공급하지 않는다.
    # 공급해도 `npc_approval_reviews`의 dialogue_pack G1~G3 승인이 그 팩 fingerprint에 있을 때만 대사를 쓴다.
    npc_general_pack: str = ""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        hide_input_in_errors=True,
    )

    @property
    def database_url(self) -> URL:
        return URL.create(
            drivername="mysql+aiomysql",
            username=self.db_user,
            password=self.db_password,
            host=self.db_host,
            port=self.db_port,
            database=self.db_name,
        )


settings = Settings()
