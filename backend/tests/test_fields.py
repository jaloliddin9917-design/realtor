import pytest

from app.ingestion.parse.fields import (
    extract_area,
    extract_markers,
    extract_phones,
    extract_price,
    extract_rooms_floors,
    extract_username,
)


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Narxi 450$ oyiga", (45000, "USD")),
        ("Цена 300 у.е.", (30000, "USD")),
        ("$1 000 в месяц", (100000, "USD")),
        ("Нархи 7 800 000 сўм", (780000000, "UZS")),
        ("5.940.700 сум", (594070000, "UZS")),
        ("narxi 3 mln so'm", (300000000, "UZS")),
        ("450 ming so'm", (45000000, "UZS")),
        ("Цена 450", None),
        ("2-xonali, 3/9", None),
    ],
)
def test_extract_price(text: str, expected: tuple[int, str] | None) -> None:
    assert extract_price(text) == expected


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("2-xonali kvartira, 3/9 qavat", (2, 3, 9)),
        ("3-хонали, 5-қават 9 қаватли уйда", (3, 5, 9)),
        ("1 комн. квартира, 2/4 этаж", (1, 2, 4)),
        ("2/5/9", (2, 5, 9)),
        ("3 комн, 4 этаж из 5", (3, 4, 5)),
        ("evro remont, mebel bilan", (None, None, None)),
    ],
)
def test_extract_rooms_floors(
    text: str, expected: tuple[int | None, int | None, int | None]
) -> None:
    assert extract_rooms_floors(text) == expected


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("54 m²", 54.0),
        ("78 кв.м", 78.0),
        ("32 кв.", 32.0),
        ("60 kv", 60.0),
        ("55.5 м2", 55.5),
        ("2-xonali", None),
    ],
)
def test_extract_area(text: str, expected: float | None) -> None:
    assert extract_area(text) == expected


def test_extract_phones_all_local_formats() -> None:
    text = "Tel: 90 811 24 37, +998 93 402 18 55, 998971234567, (91) 233-90-14, 90 811 24 37"
    assert extract_phones(text) == [
        "+998908112437",
        "+998934021855",
        "+998971234567",
        "+998912339014",
    ]


def test_extract_phones_ignores_prices_and_years() -> None:
    assert extract_phones("Narxi 5 940 700 sum, 2026 yil") == []


def test_extract_username() -> None:
    assert extract_username("Риелтор Дилшод @dilshod_uy") == "dilshod_uy"
    assert extract_username("no handle here") is None


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Egasidan, vositachilarsiz", (True, False)),
        ("Хизмат ҳақи 50%. Риелтор", (False, True)),
        ("Услуга 50%", (False, True)),
        ("Хозяин, без посредников", (True, False)),
        ("2-xonali, 3/9", (False, False)),
    ],
)
def test_extract_markers(text: str, expected: tuple[bool, bool]) -> None:
    assert extract_markers(text) == expected
