"""백엔드 판정기를 그대로 불러 입력 묶음을 판정한다(백엔드 코드는 고치지 않고 읽기만).

python3 backend.py <저장소 루트> <입력 json> <출력 json>
FastAPI 같은 의존성 없이 돌게, 패키지가 아니라 파일 하나씩 importlib 로 불러온다.
"""

import importlib.util
import json
import sys
from pathlib import Path


def load(root: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, root / "backend/app/services" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def passes(check, *args, **kwargs) -> bool:
    try:
        check(*args, **kwargs)
        return True
    except Exception:
        return False


def main() -> None:
    root, source, target = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    nickname = load(root, "nickname_policy")
    registration = load(root, "registration_input_policy")
    cases = json.loads(source.read_text(encoding="utf-8"))
    result = {
        "nicknames": [passes(nickname.validate_nickname, n) for n in cases["nicknames"]],
        "passwords": [
            passes(registration.validate_registration_password, c["password"], email=c["email"], nickname=c["nickname"])
            for c in cases["passwords"]
        ],
        "emails": [passes(registration.validate_registration_email, e) for e in cases["emails"]],
        # 화면은 이메일 앞뒤 공백을 떼고 보낸다 — 실제 전송 값으로도 본다.
        "trimmedEmails": [passes(registration.validate_registration_email, e.strip()) for e in cases["emails"]],
    }
    target.write_text(json.dumps(result), encoding="utf-8")


if __name__ == "__main__":
    if sys.version_info < (3, 9):
        sys.exit("Python 3.9 이상이 필요합니다.")
    main()
