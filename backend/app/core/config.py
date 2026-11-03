# .env에 있는 MySQL 설정을 Python에서 읽는 파일
from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import URL


class Settings(BaseSettings):
    db_host: str
    db_port: int = 3306
    db_user: str
    db_password: str
    db_name: str
    google_client_id: str = ""
    naver_client_id: str = ""
    naver_client_secret: str = ""
    naver_redirect_uri: str = ""

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

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
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
