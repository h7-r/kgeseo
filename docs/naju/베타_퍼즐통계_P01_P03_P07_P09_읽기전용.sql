-- =====================================================================================
-- 왜곡 나주 베타 — 퍼즐 P01 · P03 · P07 · P09 공통 집계 (읽기 전용, MySQL 8)
-- 상태: 실행 미검증 — 정적 검토만 했다(어떤 DB 에서도 실행하지 않음).
-- 기준: origin/main 10911fbe 의 모델 · 서비스(interaction_events · play_sessions · app_users ·
--       guest_session_transfers). 해석 · 주의사항은 같은 폴더의 「베타_퍼즐통계_정의와_운영가이드.md」.
--
-- 반드시 지킬 것
--   * 이 파일은 SELECT 와 세션 변수 SET 만 쓴다. 쓰기 · DDL · SET GLOBAL 을 덧붙이지 않는다.
--   * 하나의 접속(세션)에서 위에서부터 차례로 실행한다(@변수는 접속마다 따로다).
--   * 결과에는 집계 숫자만 나온다. 회원 ID · 이메일 · 답안 · payload 를 SELECT 하도록 고치지 않는다.
--   * Q0 · Q5 는 운영 담당자 점검용, Q1~Q4 가 PM 공유용이다.
-- =====================================================================================

SET SESSION TRANSACTION READ ONLY;
SET SESSION MAX_EXECUTION_TIME = 60000;  -- SELECT 한 문장당 60초 상한(ms)

-- ---- 파라미터(PM 확인 후 채운다). 모두 UTC, 시간대 표기 없음 ----------------------------
-- 기본값 = 2026-11-13 KST 하루. 실제 베타 시작 · 종료 시각을 받으면 그 값으로 바꾼다.
SET @beta_start_utc = '2026-11-12 15:00:00.000000';  -- KST 2026-11-13 00:00 (포함)
SET @beta_end_utc   = '2026-11-13 15:00:00.000000';  -- KST 2026-11-14 00:00 (미포함)
SET @asof_utc       = UTC_TIMESTAMP(6);              -- 조회 기준 시각. Q0 출력값을 보고서에 적는다
-- 제외 목록: JSON 배열 문자열. 회원 ID 는 이 필터에만 쓰이고 결과에 나오지 않는다.
SET @exclude_user_ids = '[]';  -- 예: '["<app_users.id>", "<app_users.id>"]' — 미르님 제공 테스트 회원
SET @exclude_anon_ids = '[]';  -- 선택: 팀 게스트 anonymous_sessions.id(알 수 있는 경우만)

START TRANSACTION READ ONLY;

-- =====================================================================================
-- Q0 — 기준 · 환경 점검(운영 담당자용)
-- =====================================================================================
WITH
prm AS (
  SELECT CAST(@beta_start_utc AS DATETIME(6))            AS start_utc,
         CAST(@beta_end_utc   AS DATETIME(6))            AS end_utc,
         CAST(@asof_utc       AS DATETIME(6))            AS asof_utc,
         CAST(COALESCE(@exclude_user_ids, '[]') AS JSON) AS ex_users,
         CAST(COALESCE(@exclude_anon_ids, '[]') AS JSON) AS ex_anons
),
-- 대상 세션(생성 시각 조건 없음): 케이스 · 판 · 관리자 · 제외 목록. 모든 쿼리가 같은 조건을 쓴다.
base AS (
  SELECT p.id                   AS play_session_id,
         p.created_at           AS session_created_at,
         p.anonymous_session_id AS anonymous_session_id,
         p.owner_user_id        AS owner_user_id,
         p.state_json           AS state_json,
         CASE WHEN p.owner_user_id IS NOT NULL              THEN CONCAT('u:', p.owner_user_id)
              WHEN p.owner_anonymous_session_id IS NOT NULL THEN CONCAT('g:', p.owner_anonymous_session_id)
              ELSE CONCAT('l:', p.anonymous_session_id) END AS principal,
         CASE WHEN p.owner_user_id IS NOT NULL              THEN 'member'
              WHEN p.owner_anonymous_session_id IS NOT NULL THEN 'guest'
              ELSE 'legacy' END                             AS owner_type
  FROM play_sessions p
  CROSS JOIN prm
  LEFT JOIN app_users u ON u.id = p.owner_user_id
  WHERE p.case_id = 'naju-angam-01'
    AND p.content_version = 1
    AND (u.role IS NULL OR u.role <> 'admin')
    AND (p.owner_user_id IS NULL OR NOT JSON_CONTAINS(prm.ex_users, JSON_QUOTE(p.owner_user_id)))
    AND NOT JSON_CONTAINS(prm.ex_anons, JSON_QUOTE(p.anonymous_session_id))
    AND p.created_at < prm.asof_utc
),
-- 대상 세션의 네 퍼즐 이벤트(조회 기준 시각 전). 답안은 해시로만 들고 결과에 내보내지 않는다(P07 은 답안 없음 → NULL).
-- 퍼즐 ↔ 서버 저장 키(v1): P01 · P03 · P09 = submit_answer + 퍼즐 ID,
--                          P07 = complete + 대표 Object ID(OBJ_S1_CAVE_BIG_CLAM). 퍼즐 ID 로 저장되지 않는다.
ev AS (
  SELECT e.play_session_id,
         CASE WHEN e.target_id = 'OBJ_S1_CAVE_BIG_CLAM' THEN 'P07' ELSE e.target_id END AS puzzle_id,
         e.id AS event_id, e.result_type, e.created_at, e.client_timestamp,
         SHA2(JSON_UNQUOTE(JSON_EXTRACT(e.payload_json, '$.answer')), 256) AS ans_hash
  FROM base b
  JOIN interaction_events e ON e.play_session_id = b.play_session_id
  CROSS JOIN prm
  WHERE e.created_at < prm.asof_utc
    AND (   (e.interaction_type = 'submit_answer' AND e.target_id IN ('P01', 'P03', 'P09'))
         OR (e.interaction_type = 'complete'      AND e.target_id = 'OBJ_S1_CAVE_BIG_CLAM'))
),
-- 정상 시도 = 서버가 판정한 제출(incorrect · correct). 해결 뒤 제출(already_completed)은 뺀다.
graded AS (
  SELECT ev.play_session_id, ev.puzzle_id, ev.event_id, ev.result_type, ev.created_at, ev.client_timestamp,
         ev.ans_hash,
         ROW_NUMBER()     OVER w AS seq,
         LAG(ev.ans_hash) OVER w AS prev_hash
  FROM ev
  WHERE ev.result_type IN ('incorrect', 'correct')
  WINDOW w AS (PARTITION BY ev.play_session_id, ev.puzzle_id ORDER BY ev.created_at, ev.event_id)
),
per_sp AS (  -- 세션 × 퍼즐
  SELECT g.play_session_id, g.puzzle_id,
         MIN(g.created_at)                                                    AS first_at,
         MAX(CASE WHEN g.seq = 1 THEN g.client_timestamp END)                 AS first_client_at,
         MIN(CASE WHEN g.result_type = 'correct' THEN g.created_at END)       AS solved_at,
         MIN(CASE WHEN g.result_type = 'correct' THEN g.client_timestamp END) AS solved_client_at,
         SUM(g.result_type = 'incorrect')                                     AS incorrect_events,
         SUM(g.result_type = 'incorrect'
             AND (g.prev_hash IS NULL OR g.prev_hash <> g.ans_hash))          AS incorrect_changed,
         SUM(g.prev_hash IS NOT NULL AND g.prev_hash = g.ans_hash)            AS repeat_same_answer,
         SUM(g.result_type = 'correct')                                       AS correct_events,
         COUNT(*)                                                             AS graded_events
  FROM graded g
  GROUP BY g.play_session_id, g.puzzle_id
),
-- 베타 시작 전 나주 이력(판 · 관리자 조건 없이, 같은 사람 식별자 규칙).
prior_sess AS (
  SELECT p.id AS play_session_id,
         CASE WHEN p.owner_user_id IS NOT NULL              THEN CONCAT('u:', p.owner_user_id)
              WHEN p.owner_anonymous_session_id IS NOT NULL THEN CONCAT('g:', p.owner_anonymous_session_id)
              ELSE CONCAT('l:', p.anonymous_session_id) END AS principal
  FROM play_sessions p
  CROSS JOIN prm
  WHERE p.case_id = 'naju-angam-01'
    AND p.created_at < prm.start_utc
),
prior_naju AS (
  SELECT DISTINCT s.principal FROM prior_sess s
),
prior_pz AS (
  SELECT DISTINCT s.principal,
         CASE WHEN e.target_id = 'OBJ_S1_CAVE_BIG_CLAM' THEN 'P07' ELSE e.target_id END AS puzzle_id
  FROM prior_sess s
  JOIN interaction_events e ON e.play_session_id = s.play_session_id
  WHERE (e.interaction_type = 'submit_answer' AND e.target_id IN ('P01', 'P03', 'P09'))
     OR (e.interaction_type = 'complete'      AND e.target_id = 'OBJ_S1_CAVE_BIG_CLAM')
),
-- 코호트 = 베타 기간에 생성된 대상 세션 × 그 세션에서 정상 시도가 1건 이상인 퍼즐.
cohort AS (
  SELECT b.play_session_id, sp.puzzle_id, b.principal, b.owner_type, b.owner_user_id, b.anonymous_session_id,
         CAST(JSON_EXTRACT(b.state_json, CONCAT('$.attempt_counts.', sp.puzzle_id)) AS UNSIGNED)
                                                  AS state_attempts,
         sp.first_at, sp.first_client_at, sp.solved_at, sp.solved_client_at,
         sp.incorrect_events, sp.incorrect_changed, sp.repeat_same_answer, sp.correct_events, sp.graded_events,
         ROW_NUMBER() OVER (PARTITION BY b.principal, sp.puzzle_id ORDER BY sp.first_at, b.play_session_id)
                                                  AS nth_session_in_window,
         (pn.principal IS NOT NULL)               AS has_prior_naju_session,
         (pp.principal IS NOT NULL)               AS has_prior_puzzle_attempt
  FROM base b
  JOIN per_sp sp ON sp.play_session_id = b.play_session_id
  CROSS JOIN prm
  LEFT JOIN prior_naju pn ON pn.principal = b.principal
  LEFT JOIN prior_pz  pp ON pp.principal = b.principal AND pp.puzzle_id = sp.puzzle_id
  WHERE b.session_created_at >= prm.start_utc
    AND b.session_created_at <  prm.end_utc
)
-- Q0 출력: metric, value — 운영 담당자 점검용(PM 공유 자료에 그대로 옮기지 않는다)
SELECT 'param_beta_start_utc' AS metric, CAST(prm.start_utc AS CHAR) AS value FROM prm
UNION ALL SELECT 'param_beta_end_utc', CAST(prm.end_utc AS CHAR) FROM prm
UNION ALL SELECT 'param_asof_utc', CAST(prm.asof_utc AS CHAR) FROM prm
UNION ALL SELECT 'check_start_lt_end (1=정상)', CAST(prm.start_utc < prm.end_utc AS CHAR) FROM prm
UNION ALL SELECT 'check_asof_ge_end (1=정상)', CAST(prm.asof_utc >= prm.end_utc AS CHAR) FROM prm
UNION ALL SELECT 'check_exclude_lists_are_arrays (1=정상)',
                 CAST(JSON_TYPE(prm.ex_users) = 'ARRAY' AND JSON_TYPE(prm.ex_anons) = 'ARRAY' AS CHAR) FROM prm
UNION ALL SELECT 'exclude_user_ids_count', CAST(JSON_LENGTH(prm.ex_users) AS CHAR) FROM prm
UNION ALL SELECT 'exclude_anon_ids_count', CAST(JSON_LENGTH(prm.ex_anons) AS CHAR) FROM prm
-- 기간 내 생성 세션의 케이스 · 판 분포(필터 전). 나주가 naju-angam-01@1 인지 확인한다.
UNION ALL
SELECT CONCAT('sessions_created_in_window:', p.case_id, '@', COALESCE(CAST(p.content_version AS CHAR), 'null')),
       CAST(COUNT(*) AS CHAR)
FROM play_sessions p CROSS JOIN prm
WHERE p.created_at >= prm.start_utc AND p.created_at < prm.end_utc
GROUP BY p.case_id, p.content_version
UNION ALL
SELECT 'naju_v1_sessions_in_window_before_exclusion', CAST(COUNT(*) AS CHAR)
FROM play_sessions p CROSS JOIN prm
WHERE p.case_id = 'naju-angam-01' AND p.content_version = 1
  AND p.created_at >= prm.start_utc AND p.created_at < prm.end_utc
UNION ALL
SELECT 'naju_v1_sessions_in_window_after_exclusion', CAST(COUNT(*) AS CHAR)
FROM base b CROSS JOIN prm
WHERE b.session_created_at >= prm.start_utc AND b.session_created_at < prm.end_utc
UNION ALL
SELECT CONCAT('cohort_sessions:', c.puzzle_id), CAST(COUNT(*) AS CHAR)
FROM cohort c GROUP BY c.puzzle_id
-- 이벤트 발생 시각 기준: 기간 안의 정상 시도를 세션 생성 시점별로 나눈다(베타 전 생성 세션 몫이 코호트에서 빠진 양)
UNION ALL
SELECT CONCAT('event_basis_graded_in_window:', x.puzzle_id, ':', x.origin), CAST(COUNT(*) AS CHAR)
FROM (
  SELECT g.puzzle_id,
         CASE WHEN b.session_created_at < prm.start_utc THEN 'session_created_before_start'
              ELSE 'session_created_in_window' END AS origin
  FROM graded g
  JOIN base b ON b.play_session_id = g.play_session_id
  CROSS JOIN prm
  WHERE g.created_at >= prm.start_utc AND g.created_at < prm.end_utc
) x
GROUP BY x.puzzle_id, x.origin
-- 코호트 세션의 시도가 기간 끝 뒤(조회 기준 시각 전)에 일어난 건수
UNION ALL
SELECT CONCAT('cohort_graded_after_end:', g.puzzle_id), CAST(COUNT(*) AS CHAR)
FROM graded g
JOIN cohort c ON c.play_session_id = g.play_session_id AND c.puzzle_id = g.puzzle_id
CROSS JOIN prm
WHERE g.created_at >= prm.end_utc
GROUP BY g.puzzle_id
-- 코호트 세션의 이벤트 종류(기대: P01 · P03 · P09 = submit_answer × incorrect/correct/already_completed,
--                              P07 = complete × correct/already_completed)
UNION ALL
SELECT CONCAT('cohort_events:', x.puzzle_id, ':', x.interaction_type, ':', x.result_type), CAST(COUNT(*) AS CHAR)
FROM (
  SELECT CASE WHEN e.target_id = 'OBJ_S1_CAVE_BIG_CLAM' THEN 'P07' ELSE e.target_id END AS puzzle_id,
         e.interaction_type, e.result_type
  FROM interaction_events e
  JOIN base b ON b.play_session_id = e.play_session_id
  CROSS JOIN prm
  WHERE b.session_created_at >= prm.start_utc AND b.session_created_at < prm.end_utc
    AND e.created_at < prm.asof_utc
    AND (   (e.interaction_type = 'submit_answer' AND e.target_id IN ('P01', 'P03', 'P09'))
         OR (e.interaction_type = 'complete'      AND e.target_id = 'OBJ_S1_CAVE_BIG_CLAM'))
) x
GROUP BY x.puzzle_id, x.interaction_type, x.result_type;

-- =====================================================================================
-- Q1 — 퍼즐별 세션 단위 요약(PM 공유용)
-- =====================================================================================
WITH
prm AS (
  SELECT CAST(@beta_start_utc AS DATETIME(6))            AS start_utc,
         CAST(@beta_end_utc   AS DATETIME(6))            AS end_utc,
         CAST(@asof_utc       AS DATETIME(6))            AS asof_utc,
         CAST(COALESCE(@exclude_user_ids, '[]') AS JSON) AS ex_users,
         CAST(COALESCE(@exclude_anon_ids, '[]') AS JSON) AS ex_anons
),
-- 대상 세션(생성 시각 조건 없음): 케이스 · 판 · 관리자 · 제외 목록. 모든 쿼리가 같은 조건을 쓴다.
base AS (
  SELECT p.id                   AS play_session_id,
         p.created_at           AS session_created_at,
         p.anonymous_session_id AS anonymous_session_id,
         p.owner_user_id        AS owner_user_id,
         p.state_json           AS state_json,
         CASE WHEN p.owner_user_id IS NOT NULL              THEN CONCAT('u:', p.owner_user_id)
              WHEN p.owner_anonymous_session_id IS NOT NULL THEN CONCAT('g:', p.owner_anonymous_session_id)
              ELSE CONCAT('l:', p.anonymous_session_id) END AS principal,
         CASE WHEN p.owner_user_id IS NOT NULL              THEN 'member'
              WHEN p.owner_anonymous_session_id IS NOT NULL THEN 'guest'
              ELSE 'legacy' END                             AS owner_type
  FROM play_sessions p
  CROSS JOIN prm
  LEFT JOIN app_users u ON u.id = p.owner_user_id
  WHERE p.case_id = 'naju-angam-01'
    AND p.content_version = 1
    AND (u.role IS NULL OR u.role <> 'admin')
    AND (p.owner_user_id IS NULL OR NOT JSON_CONTAINS(prm.ex_users, JSON_QUOTE(p.owner_user_id)))
    AND NOT JSON_CONTAINS(prm.ex_anons, JSON_QUOTE(p.anonymous_session_id))
    AND p.created_at < prm.asof_utc
),
-- 대상 세션의 네 퍼즐 이벤트(조회 기준 시각 전). 답안은 해시로만 들고 결과에 내보내지 않는다(P07 은 답안 없음 → NULL).
-- 퍼즐 ↔ 서버 저장 키(v1): P01 · P03 · P09 = submit_answer + 퍼즐 ID,
--                          P07 = complete + 대표 Object ID(OBJ_S1_CAVE_BIG_CLAM). 퍼즐 ID 로 저장되지 않는다.
ev AS (
  SELECT e.play_session_id,
         CASE WHEN e.target_id = 'OBJ_S1_CAVE_BIG_CLAM' THEN 'P07' ELSE e.target_id END AS puzzle_id,
         e.id AS event_id, e.result_type, e.created_at, e.client_timestamp,
         SHA2(JSON_UNQUOTE(JSON_EXTRACT(e.payload_json, '$.answer')), 256) AS ans_hash
  FROM base b
  JOIN interaction_events e ON e.play_session_id = b.play_session_id
  CROSS JOIN prm
  WHERE e.created_at < prm.asof_utc
    AND (   (e.interaction_type = 'submit_answer' AND e.target_id IN ('P01', 'P03', 'P09'))
         OR (e.interaction_type = 'complete'      AND e.target_id = 'OBJ_S1_CAVE_BIG_CLAM'))
),
-- 정상 시도 = 서버가 판정한 제출(incorrect · correct). 해결 뒤 제출(already_completed)은 뺀다.
graded AS (
  SELECT ev.play_session_id, ev.puzzle_id, ev.event_id, ev.result_type, ev.created_at, ev.client_timestamp,
         ev.ans_hash,
         ROW_NUMBER()     OVER w AS seq,
         LAG(ev.ans_hash) OVER w AS prev_hash
  FROM ev
  WHERE ev.result_type IN ('incorrect', 'correct')
  WINDOW w AS (PARTITION BY ev.play_session_id, ev.puzzle_id ORDER BY ev.created_at, ev.event_id)
),
per_sp AS (  -- 세션 × 퍼즐
  SELECT g.play_session_id, g.puzzle_id,
         MIN(g.created_at)                                                    AS first_at,
         MAX(CASE WHEN g.seq = 1 THEN g.client_timestamp END)                 AS first_client_at,
         MIN(CASE WHEN g.result_type = 'correct' THEN g.created_at END)       AS solved_at,
         MIN(CASE WHEN g.result_type = 'correct' THEN g.client_timestamp END) AS solved_client_at,
         SUM(g.result_type = 'incorrect')                                     AS incorrect_events,
         SUM(g.result_type = 'incorrect'
             AND (g.prev_hash IS NULL OR g.prev_hash <> g.ans_hash))          AS incorrect_changed,
         SUM(g.prev_hash IS NOT NULL AND g.prev_hash = g.ans_hash)            AS repeat_same_answer,
         SUM(g.result_type = 'correct')                                       AS correct_events,
         COUNT(*)                                                             AS graded_events
  FROM graded g
  GROUP BY g.play_session_id, g.puzzle_id
),
-- 베타 시작 전 나주 이력(판 · 관리자 조건 없이, 같은 사람 식별자 규칙).
prior_sess AS (
  SELECT p.id AS play_session_id,
         CASE WHEN p.owner_user_id IS NOT NULL              THEN CONCAT('u:', p.owner_user_id)
              WHEN p.owner_anonymous_session_id IS NOT NULL THEN CONCAT('g:', p.owner_anonymous_session_id)
              ELSE CONCAT('l:', p.anonymous_session_id) END AS principal
  FROM play_sessions p
  CROSS JOIN prm
  WHERE p.case_id = 'naju-angam-01'
    AND p.created_at < prm.start_utc
),
prior_naju AS (
  SELECT DISTINCT s.principal FROM prior_sess s
),
prior_pz AS (
  SELECT DISTINCT s.principal,
         CASE WHEN e.target_id = 'OBJ_S1_CAVE_BIG_CLAM' THEN 'P07' ELSE e.target_id END AS puzzle_id
  FROM prior_sess s
  JOIN interaction_events e ON e.play_session_id = s.play_session_id
  WHERE (e.interaction_type = 'submit_answer' AND e.target_id IN ('P01', 'P03', 'P09'))
     OR (e.interaction_type = 'complete'      AND e.target_id = 'OBJ_S1_CAVE_BIG_CLAM')
),
-- 코호트 = 베타 기간에 생성된 대상 세션 × 그 세션에서 정상 시도가 1건 이상인 퍼즐.
cohort AS (
  SELECT b.play_session_id, sp.puzzle_id, b.principal, b.owner_type, b.owner_user_id, b.anonymous_session_id,
         CAST(JSON_EXTRACT(b.state_json, CONCAT('$.attempt_counts.', sp.puzzle_id)) AS UNSIGNED)
                                                  AS state_attempts,
         sp.first_at, sp.first_client_at, sp.solved_at, sp.solved_client_at,
         sp.incorrect_events, sp.incorrect_changed, sp.repeat_same_answer, sp.correct_events, sp.graded_events,
         ROW_NUMBER() OVER (PARTITION BY b.principal, sp.puzzle_id ORDER BY sp.first_at, b.play_session_id)
                                                  AS nth_session_in_window,
         (pn.principal IS NOT NULL)               AS has_prior_naju_session,
         (pp.principal IS NOT NULL)               AS has_prior_puzzle_attempt
  FROM base b
  JOIN per_sp sp ON sp.play_session_id = b.play_session_id
  CROSS JOIN prm
  LEFT JOIN prior_naju pn ON pn.principal = b.principal
  LEFT JOIN prior_pz  pp ON pp.principal = b.principal AND pp.puzzle_id = sp.puzzle_id
  WHERE b.session_created_at >= prm.start_utc
    AND b.session_created_at <  prm.end_utc
),
agg AS (
  SELECT c.puzzle_id,
         COUNT(*)                                                                         AS attempted,
         SUM(c.solved_at IS NOT NULL)                                                     AS solved,
         SUM(c.nth_session_in_window > 1)                                                 AS retry_sessions,
         SUM(c.incorrect_events)                                                          AS incorrect_events,
         AVG(CASE WHEN c.solved_at IS NOT NULL THEN c.incorrect_events END)               AS avg_incorrect,
         AVG(CASE WHEN c.solved_at IS NOT NULL THEN c.incorrect_changed END)              AS avg_incorrect_changed,
         AVG(CASE WHEN c.solved_at IS NOT NULL
                  THEN TIMESTAMPDIFF(MICROSECOND, c.first_at, c.solved_at) END) / 1000000 AS avg_sec
  FROM cohort c
  GROUP BY c.puzzle_id
),
flg AS (
  SELECT a.*,
         (a.attempted < 5)                                                             AS h_att,
         (a.attempted < 5 OR a.solved BETWEEN 1 AND 4
                          OR (a.attempted - a.solved) BETWEEN 1 AND 4)                 AS h_sol,
         (a.attempted < 5 OR a.retry_sessions BETWEEN 1 AND 4
                          OR (a.attempted - a.retry_sessions) BETWEEN 1 AND 4)         AS h_rt,
         (a.solved < 5)                                                                AS h_avg
  FROM agg a
)
-- Q1 출력: 퍼즐별 세션 단위 요약(코호트). NULL = 표본 5 미만 또는 여집합 역산 방지
SELECT f.puzzle_id,
       CASE f.puzzle_id WHEN 'P01' THEN 'dig_step' WHEN 'P03' THEN 'placement_step'
                        WHEN 'P07' THEN 'none' ELSE 'deliberate_submit' END              AS incorrect_meaning,
       CASE WHEN f.puzzle_id = 'P07' THEN 'not_measurable' ELSE 'first_submit_to_correct' END
                                                                                        AS duration_basis,
       CASE WHEN f.h_att THEN NULL ELSE f.attempted END                                 AS sessions_attempted,
       CASE WHEN f.h_sol THEN NULL ELSE f.solved END                                    AS sessions_solved,
       CASE WHEN f.h_sol THEN NULL ELSE f.attempted - f.solved END                      AS sessions_unsolved_at_asof,
       CASE WHEN f.h_sol OR f.puzzle_id = 'P07' THEN NULL
            ELSE ROUND(100 * f.solved / f.attempted, 1) END                              AS session_solve_rate_pct,
       CASE WHEN f.h_rt THEN NULL ELSE f.retry_sessions END                             AS retry_sessions_in_window,
       CASE WHEN f.h_att OR f.puzzle_id = 'P07' THEN NULL ELSE f.incorrect_events END   AS incorrect_events,
       CASE WHEN f.h_avg OR f.puzzle_id = 'P07' THEN NULL ELSE ROUND(f.avg_incorrect, 1) END
                                                                                        AS avg_incorrect_solved,
       CASE WHEN f.h_avg OR f.puzzle_id = 'P07' THEN NULL ELSE ROUND(f.avg_incorrect_changed, 1) END
                                                                                        AS avg_incorrect_changed_solved,
       CASE WHEN f.h_avg OR f.puzzle_id = 'P07' THEN NULL ELSE ROUND(f.avg_sec, 1) END  AS avg_sec_first_to_solve
FROM flg f
ORDER BY f.puzzle_id;

-- =====================================================================================
-- Q2 — 퍼즐 × 회원/게스트 플레이어 단위(PM 공유용)
-- =====================================================================================
WITH
prm AS (
  SELECT CAST(@beta_start_utc AS DATETIME(6))            AS start_utc,
         CAST(@beta_end_utc   AS DATETIME(6))            AS end_utc,
         CAST(@asof_utc       AS DATETIME(6))            AS asof_utc,
         CAST(COALESCE(@exclude_user_ids, '[]') AS JSON) AS ex_users,
         CAST(COALESCE(@exclude_anon_ids, '[]') AS JSON) AS ex_anons
),
-- 대상 세션(생성 시각 조건 없음): 케이스 · 판 · 관리자 · 제외 목록. 모든 쿼리가 같은 조건을 쓴다.
base AS (
  SELECT p.id                   AS play_session_id,
         p.created_at           AS session_created_at,
         p.anonymous_session_id AS anonymous_session_id,
         p.owner_user_id        AS owner_user_id,
         p.state_json           AS state_json,
         CASE WHEN p.owner_user_id IS NOT NULL              THEN CONCAT('u:', p.owner_user_id)
              WHEN p.owner_anonymous_session_id IS NOT NULL THEN CONCAT('g:', p.owner_anonymous_session_id)
              ELSE CONCAT('l:', p.anonymous_session_id) END AS principal,
         CASE WHEN p.owner_user_id IS NOT NULL              THEN 'member'
              WHEN p.owner_anonymous_session_id IS NOT NULL THEN 'guest'
              ELSE 'legacy' END                             AS owner_type
  FROM play_sessions p
  CROSS JOIN prm
  LEFT JOIN app_users u ON u.id = p.owner_user_id
  WHERE p.case_id = 'naju-angam-01'
    AND p.content_version = 1
    AND (u.role IS NULL OR u.role <> 'admin')
    AND (p.owner_user_id IS NULL OR NOT JSON_CONTAINS(prm.ex_users, JSON_QUOTE(p.owner_user_id)))
    AND NOT JSON_CONTAINS(prm.ex_anons, JSON_QUOTE(p.anonymous_session_id))
    AND p.created_at < prm.asof_utc
),
-- 대상 세션의 네 퍼즐 이벤트(조회 기준 시각 전). 답안은 해시로만 들고 결과에 내보내지 않는다(P07 은 답안 없음 → NULL).
-- 퍼즐 ↔ 서버 저장 키(v1): P01 · P03 · P09 = submit_answer + 퍼즐 ID,
--                          P07 = complete + 대표 Object ID(OBJ_S1_CAVE_BIG_CLAM). 퍼즐 ID 로 저장되지 않는다.
ev AS (
  SELECT e.play_session_id,
         CASE WHEN e.target_id = 'OBJ_S1_CAVE_BIG_CLAM' THEN 'P07' ELSE e.target_id END AS puzzle_id,
         e.id AS event_id, e.result_type, e.created_at, e.client_timestamp,
         SHA2(JSON_UNQUOTE(JSON_EXTRACT(e.payload_json, '$.answer')), 256) AS ans_hash
  FROM base b
  JOIN interaction_events e ON e.play_session_id = b.play_session_id
  CROSS JOIN prm
  WHERE e.created_at < prm.asof_utc
    AND (   (e.interaction_type = 'submit_answer' AND e.target_id IN ('P01', 'P03', 'P09'))
         OR (e.interaction_type = 'complete'      AND e.target_id = 'OBJ_S1_CAVE_BIG_CLAM'))
),
-- 정상 시도 = 서버가 판정한 제출(incorrect · correct). 해결 뒤 제출(already_completed)은 뺀다.
graded AS (
  SELECT ev.play_session_id, ev.puzzle_id, ev.event_id, ev.result_type, ev.created_at, ev.client_timestamp,
         ev.ans_hash,
         ROW_NUMBER()     OVER w AS seq,
         LAG(ev.ans_hash) OVER w AS prev_hash
  FROM ev
  WHERE ev.result_type IN ('incorrect', 'correct')
  WINDOW w AS (PARTITION BY ev.play_session_id, ev.puzzle_id ORDER BY ev.created_at, ev.event_id)
),
per_sp AS (  -- 세션 × 퍼즐
  SELECT g.play_session_id, g.puzzle_id,
         MIN(g.created_at)                                                    AS first_at,
         MAX(CASE WHEN g.seq = 1 THEN g.client_timestamp END)                 AS first_client_at,
         MIN(CASE WHEN g.result_type = 'correct' THEN g.created_at END)       AS solved_at,
         MIN(CASE WHEN g.result_type = 'correct' THEN g.client_timestamp END) AS solved_client_at,
         SUM(g.result_type = 'incorrect')                                     AS incorrect_events,
         SUM(g.result_type = 'incorrect'
             AND (g.prev_hash IS NULL OR g.prev_hash <> g.ans_hash))          AS incorrect_changed,
         SUM(g.prev_hash IS NOT NULL AND g.prev_hash = g.ans_hash)            AS repeat_same_answer,
         SUM(g.result_type = 'correct')                                       AS correct_events,
         COUNT(*)                                                             AS graded_events
  FROM graded g
  GROUP BY g.play_session_id, g.puzzle_id
),
-- 베타 시작 전 나주 이력(판 · 관리자 조건 없이, 같은 사람 식별자 규칙).
prior_sess AS (
  SELECT p.id AS play_session_id,
         CASE WHEN p.owner_user_id IS NOT NULL              THEN CONCAT('u:', p.owner_user_id)
              WHEN p.owner_anonymous_session_id IS NOT NULL THEN CONCAT('g:', p.owner_anonymous_session_id)
              ELSE CONCAT('l:', p.anonymous_session_id) END AS principal
  FROM play_sessions p
  CROSS JOIN prm
  WHERE p.case_id = 'naju-angam-01'
    AND p.created_at < prm.start_utc
),
prior_naju AS (
  SELECT DISTINCT s.principal FROM prior_sess s
),
prior_pz AS (
  SELECT DISTINCT s.principal,
         CASE WHEN e.target_id = 'OBJ_S1_CAVE_BIG_CLAM' THEN 'P07' ELSE e.target_id END AS puzzle_id
  FROM prior_sess s
  JOIN interaction_events e ON e.play_session_id = s.play_session_id
  WHERE (e.interaction_type = 'submit_answer' AND e.target_id IN ('P01', 'P03', 'P09'))
     OR (e.interaction_type = 'complete'      AND e.target_id = 'OBJ_S1_CAVE_BIG_CLAM')
),
-- 코호트 = 베타 기간에 생성된 대상 세션 × 그 세션에서 정상 시도가 1건 이상인 퍼즐.
cohort AS (
  SELECT b.play_session_id, sp.puzzle_id, b.principal, b.owner_type, b.owner_user_id, b.anonymous_session_id,
         CAST(JSON_EXTRACT(b.state_json, CONCAT('$.attempt_counts.', sp.puzzle_id)) AS UNSIGNED)
                                                  AS state_attempts,
         sp.first_at, sp.first_client_at, sp.solved_at, sp.solved_client_at,
         sp.incorrect_events, sp.incorrect_changed, sp.repeat_same_answer, sp.correct_events, sp.graded_events,
         ROW_NUMBER() OVER (PARTITION BY b.principal, sp.puzzle_id ORDER BY sp.first_at, b.play_session_id)
                                                  AS nth_session_in_window,
         (pn.principal IS NOT NULL)               AS has_prior_naju_session,
         (pp.principal IS NOT NULL)               AS has_prior_puzzle_attempt
  FROM base b
  JOIN per_sp sp ON sp.play_session_id = b.play_session_id
  CROSS JOIN prm
  LEFT JOIN prior_naju pn ON pn.principal = b.principal
  LEFT JOIN prior_pz  pp ON pp.principal = b.principal AND pp.puzzle_id = sp.puzzle_id
  WHERE b.session_created_at >= prm.start_utc
    AND b.session_created_at <  prm.end_utc
),
-- 게스트로 해결한 뒤 로그인 · 가입해 회원 소유로 옮겨진 세션(승계 시각 > 해결 시각)
cohort_t AS (
  SELECT c.*,
         (c.owner_type = 'member' AND c.solved_at IS NOT NULL AND EXISTS (
            SELECT 1 FROM guest_session_transfers t
            WHERE t.app_user_id = c.owner_user_id
              AND t.anonymous_session_id = c.anonymous_session_id
              AND t.transferred_at > c.solved_at)) AS solved_while_guest
  FROM cohort c
),
pl AS (  -- 사람 × 퍼즐
  SELECT ct.puzzle_id, ct.principal,
         MIN(ct.owner_type)                                              AS owner_type,
         COUNT(*)                                                       AS sessions,
         MAX(ct.solved_at IS NOT NULL)                                   AS ever_solved,
         MAX(ct.nth_session_in_window = 1 AND ct.solved_at IS NOT NULL)   AS solved_in_first,
         MAX(ct.has_prior_naju_session)                                  AS prior_naju,
         MAX(ct.has_prior_puzzle_attempt)                                AS prior_puzzle,
         MAX(ct.solved_while_guest)                                      AS solved_while_guest
  FROM cohort_t ct
  GROUP BY ct.puzzle_id, ct.principal
),
agg AS (
  SELECT pl.puzzle_id, pl.owner_type AS scope,
         COUNT(*) AS players, SUM(pl.ever_solved) AS solved, SUM(pl.solved_in_first) AS solved_first,
         SUM(pl.sessions >= 2) AS with_retry, SUM(pl.prior_naju) AS prior_naju,
         SUM(pl.prior_puzzle) AS prior_puzzle, SUM(pl.solved_while_guest) AS solved_while_guest
  FROM pl
  GROUP BY pl.puzzle_id, pl.owner_type
  UNION ALL
  SELECT pl.puzzle_id, 'all',
         COUNT(*), SUM(pl.ever_solved), SUM(pl.solved_in_first),
         SUM(pl.sessions >= 2), SUM(pl.prior_naju),
         SUM(pl.prior_puzzle), SUM(pl.solved_while_guest)
  FROM pl
  GROUP BY pl.puzzle_id
),
flg AS (
  SELECT a.*,
         (a.players < 5)                                                                       AS h_pl,
         (a.players < 5 OR a.solved BETWEEN 1 AND 4 OR (a.players - a.solved) BETWEEN 1 AND 4)  AS h_sol,
         (a.players < 5 OR a.solved_first BETWEEN 1 AND 4
                        OR (a.players - a.solved_first) BETWEEN 1 AND 4)                       AS h_sf,
         (a.players < 5 OR a.with_retry BETWEEN 1 AND 4)                                       AS h_rt,
         (a.players < 5 OR a.prior_naju BETWEEN 1 AND 4)                                       AS h_pn,
         (a.players < 5 OR a.prior_puzzle BETWEEN 1 AND 4)                                     AS h_pp,
         (a.players < 5 OR a.solved_while_guest BETWEEN 1 AND 4)                               AS h_sg
  FROM agg a
),
sec AS (  -- 같은 퍼즐 안에서 회원/게스트/레거시 중 한 칸이라도 가려지면 그 지표는 나머지 칸도 가린다('all' 에서 역산 방지)
  SELECT f.*,
         MAX(CASE WHEN f.scope <> 'all' THEN f.h_pl  END) OVER (PARTITION BY f.puzzle_id) AS s_pl,
         MAX(CASE WHEN f.scope <> 'all' THEN f.h_sol END) OVER (PARTITION BY f.puzzle_id) AS s_sol,
         MAX(CASE WHEN f.scope <> 'all' THEN f.h_sf  END) OVER (PARTITION BY f.puzzle_id) AS s_sf,
         MAX(CASE WHEN f.scope <> 'all' THEN f.h_rt  END) OVER (PARTITION BY f.puzzle_id) AS s_rt,
         MAX(CASE WHEN f.scope <> 'all' THEN f.h_pn  END) OVER (PARTITION BY f.puzzle_id) AS s_pn,
         MAX(CASE WHEN f.scope <> 'all' THEN f.h_pp  END) OVER (PARTITION BY f.puzzle_id) AS s_pp,
         MAX(CASE WHEN f.scope <> 'all' THEN f.h_sg  END) OVER (PARTITION BY f.puzzle_id) AS s_sg
  FROM flg f
)
-- Q2 출력: 퍼즐 × (전체 · 회원 · 게스트 · 레거시) 식별 가능한 플레이어 단위. NULL = 비공개
SELECT s.puzzle_id, s.scope,
       CASE WHEN s.h_pl  OR (s.scope <> 'all' AND s.s_pl)  THEN NULL ELSE s.players END             AS players,
       CASE WHEN s.h_sol OR (s.scope <> 'all' AND s.s_sol) THEN NULL ELSE s.solved END              AS players_solved,
       CASE WHEN s.h_sol OR (s.scope <> 'all' AND s.s_sol) OR s.puzzle_id = 'P07' THEN NULL
            ELSE ROUND(100 * s.solved / s.players, 1) END                                          AS player_solve_rate_pct,
       CASE WHEN s.h_sf  OR (s.scope <> 'all' AND s.s_sf)  THEN NULL ELSE s.solved_first END        AS players_solved_in_first_session,
       CASE WHEN s.h_rt  OR (s.scope <> 'all' AND s.s_rt)  THEN NULL ELSE s.with_retry END          AS players_with_retry_session,
       CASE WHEN s.h_pn  OR (s.scope <> 'all' AND s.s_pn)  THEN NULL ELSE s.prior_naju END          AS players_with_prior_naju_session,
       CASE WHEN s.h_pp  OR (s.scope <> 'all' AND s.s_pp)  THEN NULL ELSE s.prior_puzzle END        AS players_with_prior_puzzle_attempt,
       CASE WHEN s.h_sg  OR (s.scope <> 'all' AND s.s_sg)  THEN NULL ELSE s.solved_while_guest END  AS member_players_solved_while_guest
FROM sec s
ORDER BY s.puzzle_id, FIELD(s.scope, 'all', 'member', 'guest', 'legacy');

-- =====================================================================================
-- Q3 — 퍼즐별 해결 세션 중앙값 · 백분위(PM 공유용)
-- =====================================================================================
WITH
prm AS (
  SELECT CAST(@beta_start_utc AS DATETIME(6))            AS start_utc,
         CAST(@beta_end_utc   AS DATETIME(6))            AS end_utc,
         CAST(@asof_utc       AS DATETIME(6))            AS asof_utc,
         CAST(COALESCE(@exclude_user_ids, '[]') AS JSON) AS ex_users,
         CAST(COALESCE(@exclude_anon_ids, '[]') AS JSON) AS ex_anons
),
-- 대상 세션(생성 시각 조건 없음): 케이스 · 판 · 관리자 · 제외 목록. 모든 쿼리가 같은 조건을 쓴다.
base AS (
  SELECT p.id                   AS play_session_id,
         p.created_at           AS session_created_at,
         p.anonymous_session_id AS anonymous_session_id,
         p.owner_user_id        AS owner_user_id,
         p.state_json           AS state_json,
         CASE WHEN p.owner_user_id IS NOT NULL              THEN CONCAT('u:', p.owner_user_id)
              WHEN p.owner_anonymous_session_id IS NOT NULL THEN CONCAT('g:', p.owner_anonymous_session_id)
              ELSE CONCAT('l:', p.anonymous_session_id) END AS principal,
         CASE WHEN p.owner_user_id IS NOT NULL              THEN 'member'
              WHEN p.owner_anonymous_session_id IS NOT NULL THEN 'guest'
              ELSE 'legacy' END                             AS owner_type
  FROM play_sessions p
  CROSS JOIN prm
  LEFT JOIN app_users u ON u.id = p.owner_user_id
  WHERE p.case_id = 'naju-angam-01'
    AND p.content_version = 1
    AND (u.role IS NULL OR u.role <> 'admin')
    AND (p.owner_user_id IS NULL OR NOT JSON_CONTAINS(prm.ex_users, JSON_QUOTE(p.owner_user_id)))
    AND NOT JSON_CONTAINS(prm.ex_anons, JSON_QUOTE(p.anonymous_session_id))
    AND p.created_at < prm.asof_utc
),
-- 대상 세션의 네 퍼즐 이벤트(조회 기준 시각 전). 답안은 해시로만 들고 결과에 내보내지 않는다(P07 은 답안 없음 → NULL).
-- 퍼즐 ↔ 서버 저장 키(v1): P01 · P03 · P09 = submit_answer + 퍼즐 ID,
--                          P07 = complete + 대표 Object ID(OBJ_S1_CAVE_BIG_CLAM). 퍼즐 ID 로 저장되지 않는다.
ev AS (
  SELECT e.play_session_id,
         CASE WHEN e.target_id = 'OBJ_S1_CAVE_BIG_CLAM' THEN 'P07' ELSE e.target_id END AS puzzle_id,
         e.id AS event_id, e.result_type, e.created_at, e.client_timestamp,
         SHA2(JSON_UNQUOTE(JSON_EXTRACT(e.payload_json, '$.answer')), 256) AS ans_hash
  FROM base b
  JOIN interaction_events e ON e.play_session_id = b.play_session_id
  CROSS JOIN prm
  WHERE e.created_at < prm.asof_utc
    AND (   (e.interaction_type = 'submit_answer' AND e.target_id IN ('P01', 'P03', 'P09'))
         OR (e.interaction_type = 'complete'      AND e.target_id = 'OBJ_S1_CAVE_BIG_CLAM'))
),
-- 정상 시도 = 서버가 판정한 제출(incorrect · correct). 해결 뒤 제출(already_completed)은 뺀다.
graded AS (
  SELECT ev.play_session_id, ev.puzzle_id, ev.event_id, ev.result_type, ev.created_at, ev.client_timestamp,
         ev.ans_hash,
         ROW_NUMBER()     OVER w AS seq,
         LAG(ev.ans_hash) OVER w AS prev_hash
  FROM ev
  WHERE ev.result_type IN ('incorrect', 'correct')
  WINDOW w AS (PARTITION BY ev.play_session_id, ev.puzzle_id ORDER BY ev.created_at, ev.event_id)
),
per_sp AS (  -- 세션 × 퍼즐
  SELECT g.play_session_id, g.puzzle_id,
         MIN(g.created_at)                                                    AS first_at,
         MAX(CASE WHEN g.seq = 1 THEN g.client_timestamp END)                 AS first_client_at,
         MIN(CASE WHEN g.result_type = 'correct' THEN g.created_at END)       AS solved_at,
         MIN(CASE WHEN g.result_type = 'correct' THEN g.client_timestamp END) AS solved_client_at,
         SUM(g.result_type = 'incorrect')                                     AS incorrect_events,
         SUM(g.result_type = 'incorrect'
             AND (g.prev_hash IS NULL OR g.prev_hash <> g.ans_hash))          AS incorrect_changed,
         SUM(g.prev_hash IS NOT NULL AND g.prev_hash = g.ans_hash)            AS repeat_same_answer,
         SUM(g.result_type = 'correct')                                       AS correct_events,
         COUNT(*)                                                             AS graded_events
  FROM graded g
  GROUP BY g.play_session_id, g.puzzle_id
),
-- 베타 시작 전 나주 이력(판 · 관리자 조건 없이, 같은 사람 식별자 규칙).
prior_sess AS (
  SELECT p.id AS play_session_id,
         CASE WHEN p.owner_user_id IS NOT NULL              THEN CONCAT('u:', p.owner_user_id)
              WHEN p.owner_anonymous_session_id IS NOT NULL THEN CONCAT('g:', p.owner_anonymous_session_id)
              ELSE CONCAT('l:', p.anonymous_session_id) END AS principal
  FROM play_sessions p
  CROSS JOIN prm
  WHERE p.case_id = 'naju-angam-01'
    AND p.created_at < prm.start_utc
),
prior_naju AS (
  SELECT DISTINCT s.principal FROM prior_sess s
),
prior_pz AS (
  SELECT DISTINCT s.principal,
         CASE WHEN e.target_id = 'OBJ_S1_CAVE_BIG_CLAM' THEN 'P07' ELSE e.target_id END AS puzzle_id
  FROM prior_sess s
  JOIN interaction_events e ON e.play_session_id = s.play_session_id
  WHERE (e.interaction_type = 'submit_answer' AND e.target_id IN ('P01', 'P03', 'P09'))
     OR (e.interaction_type = 'complete'      AND e.target_id = 'OBJ_S1_CAVE_BIG_CLAM')
),
-- 코호트 = 베타 기간에 생성된 대상 세션 × 그 세션에서 정상 시도가 1건 이상인 퍼즐.
cohort AS (
  SELECT b.play_session_id, sp.puzzle_id, b.principal, b.owner_type, b.owner_user_id, b.anonymous_session_id,
         CAST(JSON_EXTRACT(b.state_json, CONCAT('$.attempt_counts.', sp.puzzle_id)) AS UNSIGNED)
                                                  AS state_attempts,
         sp.first_at, sp.first_client_at, sp.solved_at, sp.solved_client_at,
         sp.incorrect_events, sp.incorrect_changed, sp.repeat_same_answer, sp.correct_events, sp.graded_events,
         ROW_NUMBER() OVER (PARTITION BY b.principal, sp.puzzle_id ORDER BY sp.first_at, b.play_session_id)
                                                  AS nth_session_in_window,
         (pn.principal IS NOT NULL)               AS has_prior_naju_session,
         (pp.principal IS NOT NULL)               AS has_prior_puzzle_attempt
  FROM base b
  JOIN per_sp sp ON sp.play_session_id = b.play_session_id
  CROSS JOIN prm
  LEFT JOIN prior_naju pn ON pn.principal = b.principal
  LEFT JOIN prior_pz  pp ON pp.principal = b.principal AND pp.puzzle_id = sp.puzzle_id
  WHERE b.session_created_at >= prm.start_utc
    AND b.session_created_at <  prm.end_utc
),
sv AS (  -- 해결 세션. P07 은 이벤트가 하나뿐이라 시간 · 오답 백분위를 내지 않는다
  SELECT c.puzzle_id,
         TIMESTAMPDIFF(MICROSECOND, c.first_at, c.solved_at) / 1000000 AS sec,
         c.incorrect_events AS inc, c.incorrect_changed AS inc_changed
  FROM cohort c
  WHERE c.solved_at IS NOT NULL AND c.puzzle_id <> 'P07'
),
rk AS (
  SELECT sv.puzzle_id, sv.sec, sv.inc, sv.inc_changed,
         COUNT(*)     OVER (PARTITION BY sv.puzzle_id)                       AS n,
         ROW_NUMBER() OVER (PARTITION BY sv.puzzle_id ORDER BY sv.sec)         AS r_sec,
         ROW_NUMBER() OVER (PARTITION BY sv.puzzle_id ORDER BY sv.inc)         AS r_inc,
         ROW_NUMBER() OVER (PARTITION BY sv.puzzle_id ORDER BY sv.inc_changed) AS r_ic
  FROM sv
),
pc AS (
  SELECT rk.puzzle_id, MAX(rk.n) AS n,
         MIN(CASE WHEN rk.r_sec >= CEIL(0.50 * rk.n) THEN rk.sec END)         AS p50_sec,
         MIN(CASE WHEN rk.r_sec >= CEIL(0.75 * rk.n) THEN rk.sec END)         AS p75_sec,
         MIN(CASE WHEN rk.r_sec >= CEIL(0.90 * rk.n) THEN rk.sec END)         AS p90_sec,
         MIN(CASE WHEN rk.r_inc >= CEIL(0.50 * rk.n) THEN rk.inc END)         AS p50_inc,
         MIN(CASE WHEN rk.r_inc >= CEIL(0.90 * rk.n) THEN rk.inc END)         AS p90_inc,
         MIN(CASE WHEN rk.r_ic  >= CEIL(0.50 * rk.n) THEN rk.inc_changed END) AS p50_inc_changed,
         MIN(CASE WHEN rk.r_ic  >= CEIL(0.90 * rk.n) THEN rk.inc_changed END) AS p90_inc_changed
  FROM rk
  GROUP BY rk.puzzle_id
)
-- Q3 출력: 퍼즐별 해결 세션 중앙값 · 백분위(가장 가까운 순위). 건수는 구간으로만. p50 · p75 는 5건 이상, p90 은 10건 이상
SELECT pc.puzzle_id,
       CASE WHEN pc.n < 5 THEN 'lt_5' WHEN pc.n < 10 THEN '5_9' WHEN pc.n < 20 THEN '10_19' ELSE '20_plus' END
         AS solved_sessions_band,
       CASE WHEN pc.n < 5  THEN NULL ELSE ROUND(pc.p50_sec, 1) END AS median_sec_first_to_solve,
       CASE WHEN pc.n < 5  THEN NULL ELSE ROUND(pc.p75_sec, 1) END AS p75_sec_first_to_solve,
       CASE WHEN pc.n < 10 THEN NULL ELSE ROUND(pc.p90_sec, 1) END AS p90_sec_first_to_solve,
       CASE WHEN pc.n < 5  THEN NULL ELSE pc.p50_inc END           AS median_incorrect_solved,
       CASE WHEN pc.n < 10 THEN NULL ELSE pc.p90_inc END           AS p90_incorrect_solved,
       CASE WHEN pc.n < 5  THEN NULL ELSE pc.p50_inc_changed END   AS median_incorrect_changed_solved,
       CASE WHEN pc.n < 10 THEN NULL ELSE pc.p90_inc_changed END   AS p90_incorrect_changed_solved
FROM pc
ORDER BY pc.puzzle_id;

-- =====================================================================================
-- Q4 — 같은 분모로 본 퍼즐별 도달 · 해결 비율(PM 공유용)
-- =====================================================================================
WITH
prm AS (
  SELECT CAST(@beta_start_utc AS DATETIME(6))            AS start_utc,
         CAST(@beta_end_utc   AS DATETIME(6))            AS end_utc,
         CAST(@asof_utc       AS DATETIME(6))            AS asof_utc,
         CAST(COALESCE(@exclude_user_ids, '[]') AS JSON) AS ex_users,
         CAST(COALESCE(@exclude_anon_ids, '[]') AS JSON) AS ex_anons
),
-- 대상 세션(생성 시각 조건 없음): 케이스 · 판 · 관리자 · 제외 목록. 모든 쿼리가 같은 조건을 쓴다.
base AS (
  SELECT p.id                   AS play_session_id,
         p.created_at           AS session_created_at,
         p.anonymous_session_id AS anonymous_session_id,
         p.owner_user_id        AS owner_user_id,
         p.state_json           AS state_json,
         CASE WHEN p.owner_user_id IS NOT NULL              THEN CONCAT('u:', p.owner_user_id)
              WHEN p.owner_anonymous_session_id IS NOT NULL THEN CONCAT('g:', p.owner_anonymous_session_id)
              ELSE CONCAT('l:', p.anonymous_session_id) END AS principal,
         CASE WHEN p.owner_user_id IS NOT NULL              THEN 'member'
              WHEN p.owner_anonymous_session_id IS NOT NULL THEN 'guest'
              ELSE 'legacy' END                             AS owner_type
  FROM play_sessions p
  CROSS JOIN prm
  LEFT JOIN app_users u ON u.id = p.owner_user_id
  WHERE p.case_id = 'naju-angam-01'
    AND p.content_version = 1
    AND (u.role IS NULL OR u.role <> 'admin')
    AND (p.owner_user_id IS NULL OR NOT JSON_CONTAINS(prm.ex_users, JSON_QUOTE(p.owner_user_id)))
    AND NOT JSON_CONTAINS(prm.ex_anons, JSON_QUOTE(p.anonymous_session_id))
    AND p.created_at < prm.asof_utc
),
-- 대상 세션의 네 퍼즐 이벤트(조회 기준 시각 전). 답안은 해시로만 들고 결과에 내보내지 않는다(P07 은 답안 없음 → NULL).
-- 퍼즐 ↔ 서버 저장 키(v1): P01 · P03 · P09 = submit_answer + 퍼즐 ID,
--                          P07 = complete + 대표 Object ID(OBJ_S1_CAVE_BIG_CLAM). 퍼즐 ID 로 저장되지 않는다.
ev AS (
  SELECT e.play_session_id,
         CASE WHEN e.target_id = 'OBJ_S1_CAVE_BIG_CLAM' THEN 'P07' ELSE e.target_id END AS puzzle_id,
         e.id AS event_id, e.result_type, e.created_at, e.client_timestamp,
         SHA2(JSON_UNQUOTE(JSON_EXTRACT(e.payload_json, '$.answer')), 256) AS ans_hash
  FROM base b
  JOIN interaction_events e ON e.play_session_id = b.play_session_id
  CROSS JOIN prm
  WHERE e.created_at < prm.asof_utc
    AND (   (e.interaction_type = 'submit_answer' AND e.target_id IN ('P01', 'P03', 'P09'))
         OR (e.interaction_type = 'complete'      AND e.target_id = 'OBJ_S1_CAVE_BIG_CLAM'))
),
-- 정상 시도 = 서버가 판정한 제출(incorrect · correct). 해결 뒤 제출(already_completed)은 뺀다.
graded AS (
  SELECT ev.play_session_id, ev.puzzle_id, ev.event_id, ev.result_type, ev.created_at, ev.client_timestamp,
         ev.ans_hash,
         ROW_NUMBER()     OVER w AS seq,
         LAG(ev.ans_hash) OVER w AS prev_hash
  FROM ev
  WHERE ev.result_type IN ('incorrect', 'correct')
  WINDOW w AS (PARTITION BY ev.play_session_id, ev.puzzle_id ORDER BY ev.created_at, ev.event_id)
),
per_sp AS (  -- 세션 × 퍼즐
  SELECT g.play_session_id, g.puzzle_id,
         MIN(g.created_at)                                                    AS first_at,
         MAX(CASE WHEN g.seq = 1 THEN g.client_timestamp END)                 AS first_client_at,
         MIN(CASE WHEN g.result_type = 'correct' THEN g.created_at END)       AS solved_at,
         MIN(CASE WHEN g.result_type = 'correct' THEN g.client_timestamp END) AS solved_client_at,
         SUM(g.result_type = 'incorrect')                                     AS incorrect_events,
         SUM(g.result_type = 'incorrect'
             AND (g.prev_hash IS NULL OR g.prev_hash <> g.ans_hash))          AS incorrect_changed,
         SUM(g.prev_hash IS NOT NULL AND g.prev_hash = g.ans_hash)            AS repeat_same_answer,
         SUM(g.result_type = 'correct')                                       AS correct_events,
         COUNT(*)                                                             AS graded_events
  FROM graded g
  GROUP BY g.play_session_id, g.puzzle_id
),
-- 베타 시작 전 나주 이력(판 · 관리자 조건 없이, 같은 사람 식별자 규칙).
prior_sess AS (
  SELECT p.id AS play_session_id,
         CASE WHEN p.owner_user_id IS NOT NULL              THEN CONCAT('u:', p.owner_user_id)
              WHEN p.owner_anonymous_session_id IS NOT NULL THEN CONCAT('g:', p.owner_anonymous_session_id)
              ELSE CONCAT('l:', p.anonymous_session_id) END AS principal
  FROM play_sessions p
  CROSS JOIN prm
  WHERE p.case_id = 'naju-angam-01'
    AND p.created_at < prm.start_utc
),
prior_naju AS (
  SELECT DISTINCT s.principal FROM prior_sess s
),
prior_pz AS (
  SELECT DISTINCT s.principal,
         CASE WHEN e.target_id = 'OBJ_S1_CAVE_BIG_CLAM' THEN 'P07' ELSE e.target_id END AS puzzle_id
  FROM prior_sess s
  JOIN interaction_events e ON e.play_session_id = s.play_session_id
  WHERE (e.interaction_type = 'submit_answer' AND e.target_id IN ('P01', 'P03', 'P09'))
     OR (e.interaction_type = 'complete'      AND e.target_id = 'OBJ_S1_CAVE_BIG_CLAM')
),
-- 코호트 = 베타 기간에 생성된 대상 세션 × 그 세션에서 정상 시도가 1건 이상인 퍼즐.
cohort AS (
  SELECT b.play_session_id, sp.puzzle_id, b.principal, b.owner_type, b.owner_user_id, b.anonymous_session_id,
         CAST(JSON_EXTRACT(b.state_json, CONCAT('$.attempt_counts.', sp.puzzle_id)) AS UNSIGNED)
                                                  AS state_attempts,
         sp.first_at, sp.first_client_at, sp.solved_at, sp.solved_client_at,
         sp.incorrect_events, sp.incorrect_changed, sp.repeat_same_answer, sp.correct_events, sp.graded_events,
         ROW_NUMBER() OVER (PARTITION BY b.principal, sp.puzzle_id ORDER BY sp.first_at, b.play_session_id)
                                                  AS nth_session_in_window,
         (pn.principal IS NOT NULL)               AS has_prior_naju_session,
         (pp.principal IS NOT NULL)               AS has_prior_puzzle_attempt
  FROM base b
  JOIN per_sp sp ON sp.play_session_id = b.play_session_id
  CROSS JOIN prm
  LEFT JOIN prior_naju pn ON pn.principal = b.principal
  LEFT JOIN prior_pz  pp ON pp.principal = b.principal AND pp.puzzle_id = sp.puzzle_id
  WHERE b.session_created_at >= prm.start_utc
    AND b.session_created_at <  prm.end_utc
),
-- 공통 분모: 베타 기간에 생성된 대상 세션 전체 / 그중 나주 상호작용 이벤트가 1건 이상인 세션
den_s AS (
  SELECT EXISTS (SELECT 1 FROM interaction_events e
                 WHERE e.play_session_id = b.play_session_id
                   AND e.created_at < prm.asof_utc) AS is_active
  FROM base b
  CROSS JOIN prm
  WHERE b.session_created_at >= prm.start_utc AND b.session_created_at < prm.end_utc
),
den AS (
  SELECT COUNT(*) AS created_sessions, COALESCE(SUM(d.is_active), 0) AS active_sessions FROM den_s d
),
num AS (
  SELECT c.puzzle_id, COUNT(*) AS attempted, SUM(c.solved_at IS NOT NULL) AS solved
  FROM cohort c
  GROUP BY c.puzzle_id
)
-- Q4 출력: 같은 분모로 본 퍼즐별 도달(시도) · 해결 비율 — 네 퍼즐을 나란히 비교할 수 있는 지표
SELECT n.puzzle_id,
       CASE WHEN d.active_sessions < 5 THEN NULL ELSE d.active_sessions END              AS active_sessions_denominator,
       CASE WHEN d.active_sessions < 5 OR n.attempted BETWEEN 1 AND 4
                 OR (d.active_sessions - n.attempted) BETWEEN 1 AND 4 THEN NULL
            ELSE ROUND(100 * n.attempted / d.active_sessions, 1) END                      AS attempted_share_of_active_pct,
       CASE WHEN d.active_sessions < 5 OR n.solved BETWEEN 1 AND 4
                 OR (d.active_sessions - n.solved) BETWEEN 1 AND 4 THEN NULL
            ELSE ROUND(100 * n.solved / d.active_sessions, 1) END                         AS solved_share_of_active_pct
FROM num n
CROSS JOIN den d
ORDER BY n.puzzle_id;

-- =====================================================================================
-- Q5 — 데이터 품질 점검(운영 담당자용)
-- =====================================================================================
WITH
prm AS (
  SELECT CAST(@beta_start_utc AS DATETIME(6))            AS start_utc,
         CAST(@beta_end_utc   AS DATETIME(6))            AS end_utc,
         CAST(@asof_utc       AS DATETIME(6))            AS asof_utc,
         CAST(COALESCE(@exclude_user_ids, '[]') AS JSON) AS ex_users,
         CAST(COALESCE(@exclude_anon_ids, '[]') AS JSON) AS ex_anons
),
-- 대상 세션(생성 시각 조건 없음): 케이스 · 판 · 관리자 · 제외 목록. 모든 쿼리가 같은 조건을 쓴다.
base AS (
  SELECT p.id                   AS play_session_id,
         p.created_at           AS session_created_at,
         p.anonymous_session_id AS anonymous_session_id,
         p.owner_user_id        AS owner_user_id,
         p.state_json           AS state_json,
         CASE WHEN p.owner_user_id IS NOT NULL              THEN CONCAT('u:', p.owner_user_id)
              WHEN p.owner_anonymous_session_id IS NOT NULL THEN CONCAT('g:', p.owner_anonymous_session_id)
              ELSE CONCAT('l:', p.anonymous_session_id) END AS principal,
         CASE WHEN p.owner_user_id IS NOT NULL              THEN 'member'
              WHEN p.owner_anonymous_session_id IS NOT NULL THEN 'guest'
              ELSE 'legacy' END                             AS owner_type
  FROM play_sessions p
  CROSS JOIN prm
  LEFT JOIN app_users u ON u.id = p.owner_user_id
  WHERE p.case_id = 'naju-angam-01'
    AND p.content_version = 1
    AND (u.role IS NULL OR u.role <> 'admin')
    AND (p.owner_user_id IS NULL OR NOT JSON_CONTAINS(prm.ex_users, JSON_QUOTE(p.owner_user_id)))
    AND NOT JSON_CONTAINS(prm.ex_anons, JSON_QUOTE(p.anonymous_session_id))
    AND p.created_at < prm.asof_utc
),
-- 대상 세션의 네 퍼즐 이벤트(조회 기준 시각 전). 답안은 해시로만 들고 결과에 내보내지 않는다(P07 은 답안 없음 → NULL).
-- 퍼즐 ↔ 서버 저장 키(v1): P01 · P03 · P09 = submit_answer + 퍼즐 ID,
--                          P07 = complete + 대표 Object ID(OBJ_S1_CAVE_BIG_CLAM). 퍼즐 ID 로 저장되지 않는다.
ev AS (
  SELECT e.play_session_id,
         CASE WHEN e.target_id = 'OBJ_S1_CAVE_BIG_CLAM' THEN 'P07' ELSE e.target_id END AS puzzle_id,
         e.id AS event_id, e.result_type, e.created_at, e.client_timestamp,
         SHA2(JSON_UNQUOTE(JSON_EXTRACT(e.payload_json, '$.answer')), 256) AS ans_hash
  FROM base b
  JOIN interaction_events e ON e.play_session_id = b.play_session_id
  CROSS JOIN prm
  WHERE e.created_at < prm.asof_utc
    AND (   (e.interaction_type = 'submit_answer' AND e.target_id IN ('P01', 'P03', 'P09'))
         OR (e.interaction_type = 'complete'      AND e.target_id = 'OBJ_S1_CAVE_BIG_CLAM'))
),
-- 정상 시도 = 서버가 판정한 제출(incorrect · correct). 해결 뒤 제출(already_completed)은 뺀다.
graded AS (
  SELECT ev.play_session_id, ev.puzzle_id, ev.event_id, ev.result_type, ev.created_at, ev.client_timestamp,
         ev.ans_hash,
         ROW_NUMBER()     OVER w AS seq,
         LAG(ev.ans_hash) OVER w AS prev_hash
  FROM ev
  WHERE ev.result_type IN ('incorrect', 'correct')
  WINDOW w AS (PARTITION BY ev.play_session_id, ev.puzzle_id ORDER BY ev.created_at, ev.event_id)
),
per_sp AS (  -- 세션 × 퍼즐
  SELECT g.play_session_id, g.puzzle_id,
         MIN(g.created_at)                                                    AS first_at,
         MAX(CASE WHEN g.seq = 1 THEN g.client_timestamp END)                 AS first_client_at,
         MIN(CASE WHEN g.result_type = 'correct' THEN g.created_at END)       AS solved_at,
         MIN(CASE WHEN g.result_type = 'correct' THEN g.client_timestamp END) AS solved_client_at,
         SUM(g.result_type = 'incorrect')                                     AS incorrect_events,
         SUM(g.result_type = 'incorrect'
             AND (g.prev_hash IS NULL OR g.prev_hash <> g.ans_hash))          AS incorrect_changed,
         SUM(g.prev_hash IS NOT NULL AND g.prev_hash = g.ans_hash)            AS repeat_same_answer,
         SUM(g.result_type = 'correct')                                       AS correct_events,
         COUNT(*)                                                             AS graded_events
  FROM graded g
  GROUP BY g.play_session_id, g.puzzle_id
),
-- 베타 시작 전 나주 이력(판 · 관리자 조건 없이, 같은 사람 식별자 규칙).
prior_sess AS (
  SELECT p.id AS play_session_id,
         CASE WHEN p.owner_user_id IS NOT NULL              THEN CONCAT('u:', p.owner_user_id)
              WHEN p.owner_anonymous_session_id IS NOT NULL THEN CONCAT('g:', p.owner_anonymous_session_id)
              ELSE CONCAT('l:', p.anonymous_session_id) END AS principal
  FROM play_sessions p
  CROSS JOIN prm
  WHERE p.case_id = 'naju-angam-01'
    AND p.created_at < prm.start_utc
),
prior_naju AS (
  SELECT DISTINCT s.principal FROM prior_sess s
),
prior_pz AS (
  SELECT DISTINCT s.principal,
         CASE WHEN e.target_id = 'OBJ_S1_CAVE_BIG_CLAM' THEN 'P07' ELSE e.target_id END AS puzzle_id
  FROM prior_sess s
  JOIN interaction_events e ON e.play_session_id = s.play_session_id
  WHERE (e.interaction_type = 'submit_answer' AND e.target_id IN ('P01', 'P03', 'P09'))
     OR (e.interaction_type = 'complete'      AND e.target_id = 'OBJ_S1_CAVE_BIG_CLAM')
),
-- 코호트 = 베타 기간에 생성된 대상 세션 × 그 세션에서 정상 시도가 1건 이상인 퍼즐.
cohort AS (
  SELECT b.play_session_id, sp.puzzle_id, b.principal, b.owner_type, b.owner_user_id, b.anonymous_session_id,
         CAST(JSON_EXTRACT(b.state_json, CONCAT('$.attempt_counts.', sp.puzzle_id)) AS UNSIGNED)
                                                  AS state_attempts,
         sp.first_at, sp.first_client_at, sp.solved_at, sp.solved_client_at,
         sp.incorrect_events, sp.incorrect_changed, sp.repeat_same_answer, sp.correct_events, sp.graded_events,
         ROW_NUMBER() OVER (PARTITION BY b.principal, sp.puzzle_id ORDER BY sp.first_at, b.play_session_id)
                                                  AS nth_session_in_window,
         (pn.principal IS NOT NULL)               AS has_prior_naju_session,
         (pp.principal IS NOT NULL)               AS has_prior_puzzle_attempt
  FROM base b
  JOIN per_sp sp ON sp.play_session_id = b.play_session_id
  CROSS JOIN prm
  LEFT JOIN prior_naju pn ON pn.principal = b.principal
  LEFT JOIN prior_pz  pp ON pp.principal = b.principal AND pp.puzzle_id = sp.puzzle_id
  WHERE b.session_created_at >= prm.start_utc
    AND b.session_created_at <  prm.end_utc
),
-- 정상 시도마다 서버 수신 시각 - 클라이언트 시각(초). 양수 = 지연 또는 기기 시계가 늦음, 음수 = 기기 시계가 빠름
off AS (
  SELECT TIMESTAMPDIFF(MICROSECOND, g.client_timestamp, g.created_at) / 1000000 AS offset_sec
  FROM graded g
  JOIN cohort c ON c.play_session_id = g.play_session_id AND c.puzzle_id = g.puzzle_id
  WHERE g.client_timestamp IS NOT NULL
),
off_rk AS (
  SELECT o.offset_sec, COUNT(*) OVER () AS n, ROW_NUMBER() OVER (ORDER BY o.offset_sec) AS r
  FROM off o
),
-- 이벤트는 있으나 정상 시도가 없는 세션 × 퍼즐(해결 뒤 제출만 있음 — 코드상 0 이어야 한다)
only_after AS (
  SELECT ev.play_session_id, ev.puzzle_id
  FROM ev
  JOIN base b ON b.play_session_id = ev.play_session_id
  CROSS JOIN prm
  WHERE b.session_created_at >= prm.start_utc AND b.session_created_at < prm.end_utc
  GROUP BY ev.play_session_id, ev.puzzle_id
  HAVING SUM(ev.result_type IN ('incorrect', 'correct')) = 0
),
-- P09 정상 시도가 같은 세션의 P07 해결보다 먼저 저장된 건(서버 선행 조건상 0 이어야 한다)
p09_before_p07 AS (
  SELECT g.play_session_id
  FROM graded g
  JOIN cohort c9 ON c9.play_session_id = g.play_session_id AND c9.puzzle_id = 'P09'
  LEFT JOIN cohort c7 ON c7.play_session_id = g.play_session_id AND c7.puzzle_id = 'P07'
  WHERE g.puzzle_id = 'P09' AND (c7.solved_at IS NULL OR g.created_at < c7.solved_at)
),
per_puzzle AS (
  SELECT c.puzzle_id,
         COUNT(*)                                                   AS cohort_sessions,
         SUM(c.graded_events <> COALESCE(c.state_attempts, 0))      AS attempt_count_mismatch,
         SUM(c.state_attempts IS NULL)                              AS state_attempts_missing,
         SUM(c.correct_events > 1)                                  AS multiple_correct,
         SUM(c.repeat_same_answer)                                  AS repeat_same_answer_events,
         SUM(c.owner_type = 'legacy')                               AS legacy_owner_sessions,
         SUM(c.first_at >= prm.end_utc)                             AS first_attempt_after_end,
         SUM(c.solved_at IS NOT NULL AND c.first_client_at IS NOT NULL AND c.solved_client_at IS NOT NULL
             AND ABS(TIMESTAMPDIFF(MICROSECOND, c.first_client_at, c.solved_client_at)
                     - TIMESTAMPDIFF(MICROSECOND, c.first_at, c.solved_at)) > 5000000)
                                                                    AS client_vs_server_duration_diff_over_5s,
         SUM(c.solved_at IS NOT NULL AND c.first_client_at IS NOT NULL AND c.solved_client_at IS NOT NULL
             AND TIMESTAMPDIFF(MICROSECOND, c.first_client_at, c.solved_client_at) < 0)
                                                                    AS client_duration_negative
  FROM cohort c
  CROSS JOIN prm
  GROUP BY c.puzzle_id
),
-- 아래 세 값은 0 이어도 퍼즐마다 한 행이 나오게 per_puzzle 에 LEFT JOIN 한다(0 건이면 GROUP BY 행이 없어지므로)
ia AS (
  SELECT g.puzzle_id, COUNT(*) AS n
  FROM graded g
  JOIN cohort c ON c.play_session_id = g.play_session_id AND c.puzzle_id = g.puzzle_id
  WHERE g.result_type = 'incorrect' AND c.solved_at IS NOT NULL AND g.created_at > c.solved_at
  GROUP BY g.puzzle_id
),
ac AS (
  SELECT ev.puzzle_id, COUNT(*) AS n
  FROM ev
  JOIN cohort c ON c.play_session_id = ev.play_session_id AND c.puzzle_id = ev.puzzle_id
  WHERE ev.result_type = 'already_completed'
  GROUP BY ev.puzzle_id
),
oa_n AS (
  SELECT oa.puzzle_id, COUNT(*) AS n FROM only_after oa GROUP BY oa.puzzle_id
)
-- Q5 출력: metric, value — 운영 담당자 점검용. 기대값은 문서 §6 표
SELECT CONCAT(pp.puzzle_id, ':cohort_sessions') AS metric, CAST(pp.cohort_sessions AS CHAR) AS value FROM per_puzzle pp
UNION ALL SELECT CONCAT(pp.puzzle_id, ':attempt_count_mismatch'), CAST(pp.attempt_count_mismatch AS CHAR) FROM per_puzzle pp
UNION ALL SELECT CONCAT(pp.puzzle_id, ':state_attempts_missing'), CAST(pp.state_attempts_missing AS CHAR) FROM per_puzzle pp
UNION ALL SELECT CONCAT(pp.puzzle_id, ':multiple_correct'), CAST(pp.multiple_correct AS CHAR) FROM per_puzzle pp
UNION ALL SELECT CONCAT(pp.puzzle_id, ':repeat_same_answer_events'), CAST(pp.repeat_same_answer_events AS CHAR) FROM per_puzzle pp
UNION ALL SELECT CONCAT(pp.puzzle_id, ':legacy_owner_sessions'), CAST(pp.legacy_owner_sessions AS CHAR) FROM per_puzzle pp
UNION ALL SELECT CONCAT(pp.puzzle_id, ':first_attempt_after_end'), CAST(pp.first_attempt_after_end AS CHAR) FROM per_puzzle pp
UNION ALL SELECT CONCAT(pp.puzzle_id, ':client_vs_server_duration_diff_over_5s'),
                 CAST(pp.client_vs_server_duration_diff_over_5s AS CHAR) FROM per_puzzle pp
UNION ALL SELECT CONCAT(pp.puzzle_id, ':client_duration_negative'), CAST(pp.client_duration_negative AS CHAR) FROM per_puzzle pp
UNION ALL SELECT CONCAT(pp.puzzle_id, ':incorrect_after_correct'), CAST(COALESCE(ia.n, 0) AS CHAR)
FROM per_puzzle pp LEFT JOIN ia ON ia.puzzle_id = pp.puzzle_id
UNION ALL SELECT CONCAT(pp.puzzle_id, ':already_completed_events'), CAST(COALESCE(ac.n, 0) AS CHAR)
FROM per_puzzle pp LEFT JOIN ac ON ac.puzzle_id = pp.puzzle_id
UNION ALL SELECT CONCAT(pp.puzzle_id, ':sessions_only_already_completed'), CAST(COALESCE(oa_n.n, 0) AS CHAR)
FROM per_puzzle pp LEFT JOIN oa_n ON oa_n.puzzle_id = pp.puzzle_id
UNION ALL SELECT 'all:sessions_only_already_completed_total', CAST(COUNT(*) AS CHAR) FROM only_after
UNION ALL SELECT 'P07:incorrect_events (0 이어야 함)', CAST(COUNT(*) AS CHAR)
FROM graded g WHERE g.puzzle_id = 'P07' AND g.result_type = 'incorrect'
UNION ALL SELECT 'P09:graded_before_p07_solved (0 이어야 함)', CAST(COUNT(*) AS CHAR) FROM p09_before_p07
UNION ALL SELECT 'all:graded_events_without_client_timestamp', CAST(COUNT(*) AS CHAR)
FROM graded g JOIN cohort c ON c.play_session_id = g.play_session_id AND c.puzzle_id = g.puzzle_id
WHERE g.client_timestamp IS NULL
UNION ALL SELECT 'all:clock_offset_p50_sec',
       CAST(ROUND(MIN(CASE WHEN r >= CEIL(0.50 * n) THEN offset_sec END), 1) AS CHAR) FROM off_rk
UNION ALL SELECT 'all:clock_offset_p90_sec',
       CAST(ROUND(MIN(CASE WHEN r >= CEIL(0.90 * n) THEN offset_sec END), 1) AS CHAR) FROM off_rk
UNION ALL SELECT 'all:events_client_ahead_over_1s', CAST(SUM(o.offset_sec < -1) AS CHAR) FROM off o
UNION ALL SELECT 'all:events_abs_offset_over_60s',  CAST(SUM(ABS(o.offset_sec) > 60) AS CHAR) FROM off o;

ROLLBACK;
