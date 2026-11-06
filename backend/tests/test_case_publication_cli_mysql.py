"""명시적으로 격리 확인된 빈 테스트 DB에서 케이스 승인 · 게시 · 복구 확인 CLI를 끝까지 돌린다.

실행 조건 · 안전 장치는 `test_content_release_mysql.py`와 같다(`NPC_IDEMPOTENCY_MYSQL_*`, 끝나면 테이블을 모두 지운다).
콘텐츠 · 승인 기록은 가상 데이터다 — 판정자 이름은 CLI 의 관문별 허용 명단 때문에 쓰지만 사유는 모두 「(가상)」이고,
이 DB 는 테스트가 끝나면 지워진다(실제 팀 승인 기록이 아니다).
"""

import os

from sqlalchemy.engine import make_url

from app.services.npc_publication import NpcPublicationService
from scripts import check_published_restore as restore_cli
from scripts import publish_case_content as publish_cli
from scripts import record_gate_review as review_cli
from tests.test_case_publication_cli import write_bundle
from tests.test_content_release_mysql import mysql_run, pytestmark  # noqa: F401
from tests.test_publication_gate import CASE_ID

REVIEWERS = {"G1": "박지하", "G2": "이해랑", "G3": "황미르"}


def db_name() -> str:
    return make_url(os.environ["NPC_IDEMPOTENCY_MYSQL_URL"]).database


def review_args(root, fingerprint, gate, *extra):
    return review_cli.parse_args(
        [
            "--target-type", "case_content",
            "--target-id", CASE_ID,
            "--target-version", "1",
            "--content-root", str(root),
            "--gate", gate,
            "--decision", "approved",
            "--actor", "operator-test",
            "--reviewer", REVIEWERS[gate],
            "--reason", f"(가상) {gate} 테스트 승인",
            "--target-hash", fingerprint,
            *extra,
        ]
    )  # fmt: skip


def publish_args(root, *extra, **values):
    argv = ["--case-id", CASE_ID, "--content-version", "1", "--content-root", str(root)]
    for key, value in values.items():
        argv += ["--" + key.replace("_", "-"), value]
    return publish_cli.parse_args(argv + list(extra))


def test_mysql_case_cli_records_gates_publishes_and_restores(tmp_path):
    fingerprint = write_bundle(tmp_path, 1)
    name = db_name()

    async def scenario(sessions):
        out: list[str] = []
        service = NpcPublicationService(sessions)

        # 1. 승인 전: 읽기 전용 확인은 관문이 모두 비어 있다
        assert (
            await review_cli.run(
                review_args(tmp_path, fingerprint, "G1", "--db"),
                sessions,
                name,
                out.append,
            )
            is None
        )
        assert "gates_before=FAIL G1:missing,G2:missing,G3:missing" in "\n".join(out)

        # 2. 게시 판정(--db): 승인이 없어 막힌다. 아무것도 쓰지 않는다
        code = await publish_cli.run(
            publish_args(tmp_path, "--db"),
            sessions,
            name,
            "",
            out.append,
        )
        assert code == publish_cli.EXIT_BLOCKED
        assert await service.restorable_versions() == ()

        # 3. 관문별 기록(가상). G3 뒤에야 PASS
        for gate in ("G1", "G2", "G3"):
            out.clear()
            args = review_args(
                tmp_path, fingerprint, gate, "--commit", "--confirm-db", name
            )
            record = await review_cli.run(args, sessions, name, out.append)
            assert record is not None and record.target_hash == fingerprint
            assert (
                record.reviewer == REVIEWERS[gate] and record.actor == "operator-test"
            )
        assert "gates_after=PASS" in "\n".join(out)

        # 4. 판정만(--db): 팩의 명시적인 빈 규칙으로 통과하지만 게시하지 않는다
        out.clear()
        code = await publish_cli.run(
            publish_args(tmp_path, "--db"),
            sessions,
            name,
            "",
            out.append,
        )
        assert code == publish_cli.EXIT_OK and "verdict=PUBLISHABLE" in out
        assert await service.restorable_versions() == ()
        out.clear()
        code = await publish_cli.run(
            publish_args(tmp_path, "--db"), sessions, name, "", out.append
        )
        assert code == publish_cli.EXIT_OK and any(
            "NG               PASS" in line for line in out
        )
        assert await service.restorable_versions() == ()

        # 5. 게시
        commit = publish_args(
            tmp_path,
            "--commit",
            "--confirm-db",
            name,
            actor="operator-test",
            reason="(가상) 게시",
        )
        out.clear()
        code = await publish_cli.run(commit, sessions, name, str(tmp_path), out.append)
        assert code == publish_cli.EXIT_OK, out
        assert any(
            "published outcome=published publication=published registration=registered"
            in line
            for line in out
        )
        states = await service.restorable_versions()
        assert [
            (s.case_id, s.content_version, s.content_fingerprint, s.status)
            for s in states
        ] == [(CASE_ID, 1, fingerprint, "published")]

        # 6. 같은 묶음 다시 게시 — 새 게시 없이 등록만 맞춘다
        out.clear()
        code = await publish_cli.run(commit, sessions, name, str(tmp_path), out.append)
        assert code == publish_cli.EXIT_OK and any(
            "outcome=already_published" in line for line in out
        )
        assert len(await service.events(CASE_ID, 1)) == 1

        # 7. 복구 확인: 앱 시작과 같은 함수로 빈 저장소에 채워 본다(DB 쓰기 없음)
        out.clear()
        args = restore_cli.parse_args(["--expect", f"{CASE_ID}:1"])
        assert (
            await restore_cli.run(args, sessions, str(tmp_path), out.append)
            == restore_cli.EXIT_OK
        )
        assert f"  {CASE_ID}:v1 registered publication=published -> ok" in out

        # 8. 원본 파일이 사라지면 복구 실패로 알린다(게시 상태는 그대로)
        (tmp_path / CASE_ID / "v1" / "npc.json").unlink()
        out.clear()
        assert (
            await restore_cli.run(args, sessions, str(tmp_path), out.append)
            == restore_cli.EXIT_FAILED
        )
        assert any("files_missing" in line and "UNAVAILABLE" in line for line in out)
        assert [s.status for s in await service.restorable_versions()] == ["published"]

    mysql_run(scenario)


def test_mysql_case_cli_refuses_a_mismatched_database_and_stale_approvals(tmp_path):
    fingerprint = write_bundle(tmp_path, 1)
    name = db_name()

    async def scenario(sessions):
        # 다른 DB 이름 — 쓰지 않는다
        args = review_args(
            tmp_path, fingerprint, "G1", "--commit", "--confirm-db", "waegok"
        )
        try:
            await review_cli.run(args, sessions, name, lambda *_: None)
        except review_cli.CliInputError as error:
            assert "confirm-db" in str(error)
        else:
            raise AssertionError("must refuse")

        # 다른 묶음(v1 원본이 바뀜)에 남은 승인은 stale — 게시 판정이 막는다
        for gate in ("G1", "G2", "G3"):
            await review_cli.run(
                review_args(
                    tmp_path, fingerprint, gate, "--commit", "--confirm-db", name
                ),
                sessions,
                name,
                lambda *_: None,
            )
        changed = write_bundle(tmp_path, 1, answer="(가상) 바뀐 정답")
        assert changed != fingerprint
        out: list[str] = []
        code = await publish_cli.run(
            publish_args(tmp_path, "--db"),
            sessions,
            name,
            "",
            out.append,
        )
        assert code == publish_cli.EXIT_BLOCKED
        assert "  G1: stale (다른 fingerprint 에만 기록 있음)" in out
        assert any("G1:stale target_hash" in line for line in out)
        assert await NpcPublicationService(sessions).restorable_versions() == ()

    mysql_run(scenario)
