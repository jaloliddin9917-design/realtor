"""Classify an inbound outreach reply as vacant / taken / unclear.

Deterministic and dependency-free — this is what turns a contact's raw reply into an
availability signal once real sending is wired (see `service.record_reply`). The bot asks
"reply 1 if it's still free, 2 if it's taken", so a bare or leading digit is the explicit
answer; failing that, a small bilingual (uz + ru) keyword set decides. A reply that says both
things, or nothing recognizable, is `unclear` for a human to resolve.
"""

import re
from typing import Literal

Classification = Literal["vacant", "taken", "unclear"]

# Apostrophe-like characters used in Uzbek (oʻ / gʻ and the common ASCII stand-ins) are
# stripped before matching, so "bo'sh" / "bo‘sh" / "boʻsh" / "bo`sh" all normalize to "bosh"
# and "yo'q" to "yoq".
_APOSTROPHES = "'‘’ʻʼ`´"
_APOSTROPHE_RE = re.compile(f"[{re.escape(_APOSTROPHES)}]")
_WORD_RE = re.compile(r"\w+")

# uz (Latin, apostrophes stripped) + ru. "bor" = there is; "bosh" = bo'sh (free/empty).
VACANT_WORDS = frozenset({"bor", "bosh", "свободна", "свободно", "свободен", "есть"})
# uz + ru. "yoq" = yo'q (none). Russian gender/number variants of сдан / занят included.
TAKEN_WORDS = frozenset(
    {"topshirildi", "berildi", "yoq", "сдана", "сдан", "сдано", "занята", "занят", "нет"}
)


def _normalize(text: str) -> str:
    return _APOSTROPHE_RE.sub("", text.strip().lower())


def parse_reply(text: str) -> Classification:
    """vacant / taken / unclear for a raw reply. See the module docstring for the rules."""
    tokens = _WORD_RE.findall(_normalize(text))
    if not tokens:
        return "unclear"
    # The explicit menu choice: a bare or leading "1" / "2" contributes its signal alongside
    # any keywords, so "1 bo'sh" agrees on vacant while "2 xona bor" contradicts -> unclear.
    lead = tokens[0] if tokens[0] in ("1", "2") else None
    words = set(tokens)
    has_vacant = lead == "1" or bool(words & VACANT_WORDS)
    has_taken = lead == "2" or bool(words & TAKEN_WORDS)
    if has_vacant and not has_taken:
        return "vacant"
    if has_taken and not has_vacant:
        return "taken"
    # Both signals, or neither: leave it for a human to resolve.
    return "unclear"
