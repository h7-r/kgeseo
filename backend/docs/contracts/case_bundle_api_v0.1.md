# Case Bundle API Contract v0.1

**Status: Implemented v0.1**

## 1. Endpoint

```http
GET /api/v1/cases/{case_id}/bundle
```

Case Bundle은 정적 Client Content를 Frontend에 제공한다. Session API와 같은
`success`/`data` envelope를 사용하며 Interaction의 flat Response 규칙은 적용하지 않는다.

## 2. Response

```json
{
  "success": true,
  "data": {
    "case_id": "case_001",
    "entry_zone_id": "ZONE_001",
    "zones": [
      {
        "zone_id": "ZONE_001",
        "zone_name": "Arrival",
        "zone_type": "room",
        "description": "First zone",
        "objects": [
          {
            "object_id": "OBJ_LOCK_01",
            "object_name": "Lock",
            "object_type": "lock",
            "asset_key": "lock_asset",
            "visible": true,
            "enabled": true,
            "interaction": {
              "type": "input"
            }
          }
        ],
        "navigation": [
          {
            "door_object_id": "OBJ_DOOR_01",
            "target_zone_id": "ZONE_002"
          }
        ],
        "metadata": {}
      }
    ]
  }
}
```

`entry_zone_id`는 항상 Client Content의 명시적 값을 반환하며 Zone 배열 순서에서
추론하지 않는다. `visible`과 `enabled`는 정적 초기 콘텐츠 값이고 PlaySession의
동적 접근 권한이나 서버 권위 상태가 아니다.

## 3. ID 규칙

- `zone_id`는 Case 범위에서 Zone을 식별한다.
- `object_id`는 Zone 안에서만 유일하다.
- 외부 Object 식별은 `(zone_id, object_id)` 조합이다.
- Interaction `input.target_id`에는 `object_id`를 보낸다.
- Backend Object Resolver가 `zone_id`와 `object_id`를 내부 puzzle target으로 변환한다.
- 내부 `Object.interaction.target_id`는 Bundle에 반환하지 않는다.

## 4. Content 경계

Bundle은 `<case_id>.client.json`의 검증된 공개 필드로만 구성한다. 응답 전
`<case_id>.server.json`과 cross-file link를 검증하지만 Server Runtime은 직렬화하지
않는다. 다음 정보는 Server-only다.

- `accepted_answers`와 정답 정규화·판정 규칙
- `on_correct`, `on_success`
- `grant_clue_ids`, `complete_puzzle_ids`, `set_flags`
- `clue_combinations`와 조합 정답
- 서버 내부 조건 및 flag 판정
- Object와 Puzzle을 잇는 내부 `interaction.target_id`

`title`, content version, 최상위 Puzzle/Clue 목록은 v0.1에 없다. Bundle은
PlaySession 진행 상태를 포함하지 않는다.

## 5. 처리 흐름

```text
case_id validation
-> Client Content load
-> Server Runtime load
-> validate_case_content_links
-> Public Bundle Adapter
-> response
```

현재 Source는 파일 기반 Client/Server JSON이다. MySQL은 Session과 Interaction
Runtime 상태를 담당하며 Bundle 조회는 DB를 사용하거나 상태를 변경하지 않는다.

## 6. 오류

| 상황 | HTTP | detail |
|---|---:|---|
| 허용되지 않는 `case_id` 형식 | 422 | `Invalid case ID.` |
| Client 또는 Server 콘텐츠 파일 없음 | 404 | `Case not found.` |
| JSON 또는 Schema 오류 | 500 | `Case content is unavailable.` |
| Client/Server case 또는 Puzzle link 불일치 | 500 | `Case content is unavailable.` |

오류 Response에는 내부 경로, Validation 상세, Server Runtime 값을 포함하지 않는다.

## 7. v0.1 이후

- NAJU-01 실제 Client/Server 콘텐츠 작성 및 검증
- 공개 Clue Catalog 계약
- PlaySession version binding을 포함한 content versioning
- Frontend Bundle 연동
