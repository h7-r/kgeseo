/**
 * 시연용 테스트 계정(TEST / test123@naver.com / test123). 가입 규칙에 안 맞아 가입 화면으로는 만들 수 없다.
 *
 * 개발 서버에서 VITE_TEST_ACCOUNT=on 을 적었을 때만 켜진다. 값이 없거나 다른 값이면 꺼진다.
 * 배포 빌드(vite build)는 import.meta.env.DEV 가 false 로 바뀌어 아래 식이 null 로 접히고,
 * 자격 증명 글자도 번들에서 빠진다 — tools/test-account-guard.mjs 가 빌드 결과물을 검사한다.
 * 자격 증명은 이 조건식 밖에 두지 않는다. 밖에 두면 꺼져 있어도 번들에 남는다.
 */
export const TEST_ACCOUNT =
  import.meta.env.DEV && import.meta.env.VITE_TEST_ACCOUNT === "on"
    ? {
        // 팀원 기기마다 같도록 아이디도 고정한다. 백엔드 scripts/seed_test_account.py 와 같은 값이다.
        id: "00000000-0000-4000-8000-000000000001",
        email: "test123@naver.com",
        password: "test123",
        // pbkdf2("test123", 소금, 210000, sha256)
        passwordHash:
          "pbkdf2_sha256$210000$d08f5a8867fe0f56939831965d2d0fb2$dfbbd540b205077d2a3679355039196f4cf0d30f79def7ede1c099926258c4f7",
        name: "TEST",
        region: "전남",
      }
    : null;
