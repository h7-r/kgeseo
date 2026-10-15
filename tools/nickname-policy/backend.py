"""백엔드 판정기를 그대로 불러 입력 묶음을 판정한다(백엔드 코드는 고치지 않고 읽기만).

python backend.py <저장소 루트> <입력 json> <출력 json>
FastAPI 같은 의존성 없이 돌게, 패키지가 아니라 파일 하나씩 importlib 로 불러온다.

결과 칸은 True(통과) · False(백엔드가 정한 검증 오류로 거절) · None(그 밖의 예외 — 판정이 아니라 실행 오류).
실행 오류는 거절로 세지 않고 errors 에 입력과 함께 모아 검사를 실패시킨다.
"""

import importlib.util
import json
import sys
from pathlib import Path
from typing import Optional


def load(root: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, root / "backend/app/services" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Judge:
    """판정을 부르고, 백엔드가 정한 검증 오류(거절)와 그 밖의 예외(실행 오류)를 가른다."""

    def __init__(self) -> None:
        self.errors: list[dict] = []

    def run(self, label: str, check, rejection: type[Exception], value: str, **kwargs) -> Optional[bool]:
        try:
            check(value, **kwargs)
            return True
        except rejection:
            return False
        except Exception as error:  # noqa: BLE001 — 실행 오류도 결과로 남겨 보여 준다
            self.errors.append({"check": label, "input": value, "error": f"{type(error).__name__}: {error}"})
            return None


def main() -> None:
    root, source, target = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    nickname = load(root, "nickname_policy")
    registration = load(root, "registration_input_policy")
    cases = json.loads(source.read_text(encoding="utf-8"))
    judge = Judge()
    email = registration.validate_registration_email
    result = {
        "nicknames": [
            judge.run("nickname", nickname.validate_nickname, nickname.InvalidNicknameError, n)
            for n in cases["nicknames"]
        ],
        "passwords": [
            judge.run(
                "password",
                registration.validate_registration_password,
                registration.InvalidPasswordError,
                c["password"],
                email=c["email"],
                nickname=c["nickname"],
            )
            for c in cases["passwords"]
        ],
        "emails": [judge.run("email", email, registration.InvalidEmailError, e) for e in cases["emails"]],
        # 화면은 이메일 앞뒤 공백을 떼고 보낸다 — 실제 전송 값으로도 본다.
        "trimmedEmails": [
            judge.run("email", email, registration.InvalidEmailError, e.strip()) for e in cases["emails"]
        ],
        "errors": judge.errors,
    }
    target.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    if sys.version_info < (3, 9):
        sys.exit("Python 3.9 이상이 필요합니다.")
    main()
