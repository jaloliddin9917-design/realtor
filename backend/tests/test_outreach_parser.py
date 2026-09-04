"""Unit tests for the outreach reply parser: the bilingual (uz + ru) keyword and digit rules
that turn a raw reply into vacant / taken / unclear once real sending is wired."""

import pytest

from app.modules.outreach.parser import parse_reply

VACANT_CASES = [
    # bare / leading menu digit "1"
    "1",
    "1.",
    "1)",
    " 1 ",
    "1, hali bor",
    "1 bo'sh",
    # uz availability words
    "bor",
    "Bor",
    "hali bor",
    "bo'sh",
    "bo‘sh",
    "boʻsh",
    "bo`sh",
    "uy bosh",
    "hozircha bor, lekin narxi boshqa",
    # ru availability words
    "свободна",
    "Свободна",
    "квартира свободна",
    "свободно",
    "свободен",
    "есть",
    "да, есть",
]

TAKEN_CASES = [
    # bare / leading menu digit "2"
    "2",
    "2.",
    "2)",
    " 2 ",
    "2 topshirildi",
    # uz taken words
    "topshirildi",
    "Topshirildi",
    "uy topshirildi",
    "berildi",
    "yo'q",
    "yoq",
    "yo‘q",
    # ru taken words
    "сдана",
    "квартира сдана",
    "сдан",
    "сдано",
    "занята",
    "занят",
    "нет",
    "нет, уже сдана",
]

UNCLEAR_CASES = [
    # nothing recognizable
    "",
    "   ",
    "?",
    "...",
    "salom",
    "hello",
    "asdf",
    "qancha",
    "звоните позже",
    # digits that are not the menu choice
    "10",
    "1500$",
    "3 xona",
    # contradictory signals -> leave for a human
    "2 xona bor",  # leading 2 (taken) but "bor" (vacant)
    "1 yo'q",  # leading 1 (vacant) but "yoq" (taken)
    "bor yo'q",  # a vacant word and a taken word together
]


@pytest.mark.parametrize("text", VACANT_CASES)
def test_reply_reads_as_vacant(text: str) -> None:
    assert parse_reply(text) == "vacant"


@pytest.mark.parametrize("text", TAKEN_CASES)
def test_reply_reads_as_taken(text: str) -> None:
    assert parse_reply(text) == "taken"


@pytest.mark.parametrize("text", UNCLEAR_CASES)
def test_reply_reads_as_unclear(text: str) -> None:
    assert parse_reply(text) == "unclear"


def test_leading_digit_only_matches_the_exact_menu_choice() -> None:
    # "10" / "1500" start with a 1 but are not the menu answer "1".
    assert parse_reply("10 kishi") == "unclear"
    assert parse_reply("1") == "vacant"
    assert parse_reply("2") == "taken"
