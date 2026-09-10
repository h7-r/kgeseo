# 01_Zone_Contract_v0.2

> 기존 `Scene Contract v0.1`을 FE 회신에 맞춰 수정한 1차 확정 본.
> 서버는 3D 배치를 내려주지 않으며, 런타임에 논리적 공간과 상호작용 상태만 제공한다.

---

## 0. 문서 정보

| 항목 | 내용 |
|---|---|
| 문서명 | Zone Contract |
| 버전 | v0.2 |
| 상태 | 1차 확정 Baseline |
| 관련 문서 | Interaction Contract / Puzzle Contract / Session Contract |

---

## 1. 적용 범위

### 포함
- 현재 Zone의 논리 정보
- 상호작용 가능한 Object 목록
- Object의 `visible`, `enabled`
- Object와 Interaction/Puzzle의 연결
- 인접 Zone으로 연결되는 출구 정보

### 제외
- 위치·회전·크기
- 실제 모델 파일 경로
- 배경 메시
- 벽·바닥·장식물
- 조명·색상·렌더링 설정
- 플레이어 좌표
- 카메라 정보

---

## 2. 핵심 원칙

1. 서버는 3D 배치를 소유하지 않는다.
2. `objects[]`에는 플레이어가 상호작용할 수 있는 대상만 들어간다.
3. `asset_key`는 서버가 전달할 수 있으나 실제 에셋 파일 경로는 FE manifest가 해석한다.
4. 오브젝트 잠금은 기본적으로 `enabled=false`로 표현한다.
5. `visible=false`는 숨겨진 문처럼 실제로 나타남/사라짐이 필요한 경우에만 사용한다.
6. 문이 열렸는지는 서버가 판정하고, 문을 통과하는 동작은 프론트가 처리한다.

---

## 3. API

```http
GET /api/v1/play-sessions/{play_session_id}/zones/{zone_id}
```

> `visible`, `enabled` 등은 Play Session 진행 상태에 따라 달라지므로 Case 단독 조회가 아니라 Play Session 기준의 런타임 조회로 정의한다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|---:|---|
| `play_session_id` | UUID string | Y | 현재 플레이 세션 |
| `zone_id` | string | Y | 조회할 논리 구역 |

---

## 4. Response

```json
{
  "success": true,
  "data": {
    "zone_id": "ZONE_003",
    "zone_name": "기차 내부",
    "zone_type": "exploration",
    "status": "active",
    "description": "멈춰 선 객차 내부다.",
    "objects": [],
    "navigation": {
      "exits": []
    },
    "metadata": {}
  }
}
```

---

## 5. Zone 필드

| 필드 | 타입 | 필수 | 설명 |
|---|---|---:|---|
| `zone_id` | string | Y | Zone 고유 ID |
| `zone_name` | string | Y | 표시용 이름 |
| `zone_type` | enum | Y | Zone 유형 |
| `status` | enum | Y | 현재 진행 상태 |
| `description` | string/null | Y | 콘텐츠 설명 |
| `objects` | array | Y | 상호작용 대상 목록 |
| `navigation` | object | Y | 출구 연결 정보 |
| `metadata` | object | Y | 확장용 메타데이터 |

---

## 6. Object Schema

```json
{
  "object_id": "OBJ_LOCK_01",
  "object_name": "잠긴 보관함",
  "object_type": "puzzle",
  "visible": true,
  "enabled": true,
  "asset_key": "OLD_LOCKER_A",
  "interaction": {
    "type": "input",
    "target_id": "PUZZLE_002"
  }
}
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|---:|---|
| `object_id` | string | Y | 상호작용 Object ID |
| `object_name` | string | Y | 표시용 이름 |
| `object_type` | enum | Y | Object 유형 |
| `visible` | boolean | Y | 렌더 대상 여부 |
| `enabled` | boolean | Y | 상호작용 가능 여부 |
| `asset_key` | string/null | Y | FE manifest 매핑용 키 |
| `interaction` | object/null | Y | Interaction 연결 |

### 중요

`transform`은 API Schema에서 제거했다.

```text
position / rotation / scale / 실제 모델 파일 / 조명 / 색
= Frontend 소유
```

---

## 7. Interaction Reference

```json
{
  "type": "inspect",
  "target_id": "CLUE_001"
}
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|---:|---|
| `type` | enum | Y | `inspect`, `navigate`, `input`, `select` |
| `target_id` | string/null | Y | Puzzle/Clue/Zone 등 연결 대상 |

---

## 8. Navigation

Zone 전체에 `exit_enabled` 필드를 두지 않는다.

하나의 Zone에 여러 문이 있을 수 있기 때문이다.

```json
{
  "exits": [
    {
      "door_object_id": "OBJ_DOOR_01",
      "target_zone_id": "ZONE_004"
    },
    {
      "door_object_id": "OBJ_DOOR_02",
      "target_zone_id": "ZONE_005"
    }
  ]
}
```

문이 잠겼는지는 해당 `door_object_id`의 `enabled` 값으로 판단한다.

| 필드 | 타입 | 필수 | 설명 |
|---|---|---:|---|
| `door_object_id` | string | Y | 출구 역할을 하는 Object |
| `target_zone_id` | string | Y | 연결된 Zone |

---

## 9. Enum

### `zone_type`

- `intro`
- `exploration`
- `puzzle`
- `transition`
- `ending`

`dialogue`는 v1에서 제외한다.

### `status`

- `locked`
- `active`
- `completed`

### `object_type`

- `interactive`
- `clue`
- `puzzle`
- `door`

`static`은 `objects[]`에 넣지 않는다.
`npc`는 v1에서 제외한다.

### `interaction.type`

- `inspect`
- `navigate`
- `input`
- `select`

---

## 10. 전체 예시

```json
{
  "success": true,
  "data": {
    "zone_id": "ZONE_003",
    "zone_name": "기차 내부",
    "zone_type": "exploration",
    "status": "active",
    "description": "멈춰 선 객차 내부다.",
    "objects": [
      {
        "object_id": "OBJ_NOTE_01",
        "object_name": "구겨진 쪽지",
        "object_type": "clue",
        "visible": true,
        "enabled": true,
        "asset_key": "CRUMPLED_NOTE_A",
        "interaction": {
          "type": "inspect",
          "target_id": "CLUE_001"
        }
      },
      {
        "object_id": "OBJ_DOOR_01",
        "object_name": "잠긴 객차문",
        "object_type": "door",
        "visible": true,
        "enabled": false,
        "asset_key": "TRAIN_DOOR_A",
        "interaction": {
          "type": "navigate",
          "target_id": "ZONE_004"
        }
      }
    ],
    "navigation": {
      "exits": [
        {
          "door_object_id": "OBJ_DOOR_01",
          "target_zone_id": "ZONE_004"
        }
      ]
    },
    "metadata": {}
  }
}
```

---

## 11. 검증 규칙

- `zone_id`는 해당 Play Session의 Case에 속해야 한다.
- 접근 불가능한 Zone은 유저가 조회할 수 없어야 한다.
- `objects[].object_id`는 중복될 수 없다.
- 상호작용하지 않는 배경 오브젝트에는 `OBJ_` ID를 발급하지 않는다.
- `interaction.type`은 v1 허용 목록만 사용한다.
- `enabled=false`인 Object의 Interaction은 서버가 거부한다.
- `target_id`는 실제 콘텐츠 ID와 연결되어야 한다.
- Navigation의 `door_object_id`는 같은 Zone의 `objects[]`에 존재해야 한다.
- 실제 정답이나 내부 DB 식별자는 응답에 포함하지 않는다.

---

## 12. 변경 이력

| 버전 | 변경 내용 |
|---|---|
| v0.1 | 범용 Scene Draft |
| v0.2 | Zone 용어 채택, transform 제거, interactive object만 포함, v1 Enum 확정, 출구 구조 수정 |
