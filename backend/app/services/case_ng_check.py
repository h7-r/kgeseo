"""Case nudge NG/U checker; approval and secret-leak checks remain separate."""

from app.schemas.npc_content import NpcContentPack
from app.services.npc_generation_policy import _contains, _forms
from app.services.npc_line_supply import policy_rules_from_pack
from app.services.publication_gate import NgChecker


def build_case_ng_checker(npc_pack: NpcContentPack | None) -> NgChecker | None:
    """Build only when both rule lists are supplied and every pattern is comparable.

    Explicit empty lists are valid. NG falls back to text when patterns are absent;
    U requires patterns and conservatively rejects every match, as pack-derived
    runtime rules have no hedges. No answers, clues, hints or approvals are read.
    Pass the result explicitly as evaluate_publication(ng_checker=...).
    """
    rules = policy_rules_from_pack(npc_pack)
    if rules is None:
        return None

    needles: list[str] = []
    for rule in rules.ng:
        patterns = [p for p in rule.patterns if p.strip()] or [rule.text]
        if any(not _forms(pattern)[0] for pattern in patterns):
            return None
        needles.extend(patterns)
    for topic in rules.open_topics:
        if not topic.patterns or any(not _forms(p)[0] for p in topic.patterns):
            return None
        needles.extend(topic.patterns)

    patterns = tuple(needles)

    def violates(text: str) -> bool:
        forms = _forms(text)
        return any(_contains(forms, pattern) for pattern in patterns)

    return violates
