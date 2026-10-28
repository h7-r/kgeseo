"""P4-A — NPC 발화층 (안전한 발화 기반).

  NpcContext + 발화 계획(kind · initiator · 대상) + 결합 팩(ScenarioPack + .npc.json)
    → 검색(거른 뒤 TF-IDF) → PromptPayload(본문 · 임시 라벨만) → 생성기 → 공통 안전 검증 → NpcUtterance
                                                                     └ 실패 → 승인 템플릿(재검증) → 그래도 실패 → 보류

판단 모델 없이도 돈다(발화 계획을 바깥에서 준다). 네트워크를 쓰지 않는다 — GPT · Qwen 은 P4-B.
"""
