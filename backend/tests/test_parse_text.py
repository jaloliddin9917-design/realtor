from pathlib import Path

from app.ingestion.parse import parse_text

POSTS = Path(__file__).parent / "fixtures" / "posts"


def test_parse_uz_latin_owner_post() -> None:
    p = parse_text((POSTS / "uz_latin_owner.txt").read_text())
    assert (p.price_amount_minor, p.price_currency) == (45000, "USD")
    assert (p.rooms, p.floor, p.total_floors, p.area_sqm) == (2, 3, 9, 54.0)
    assert p.district == "chilonzor"
    assert p.phones == ["+998908112437", "+998934021855"]
    assert (p.owner_marker, p.agent_marker) == (True, False)
    assert p.title == (
        "Chilonzor, Qatortol, 2-xonali kvartira, 3/9 qavat, 54 m², evro remont, "
        "mebel va texnika bilan."
    )
    assert p.parse_confidence == 1.0


def test_parse_uz_cyrillic_agent_post() -> None:
    p = parse_text((POSTS / "uz_cyrillic_agent.txt").read_text())
    assert (p.price_amount_minor, p.price_currency) == (780000000, "UZS")
    assert (p.rooms, p.floor, p.total_floors, p.area_sqm) == (3, 5, 9, 78.0)
    assert p.district == "yunusobod"
    assert p.telegram_username == "dilshod_uy"
    assert (p.owner_marker, p.agent_marker) == (False, True)


def test_parse_ru_agent_post_uses_sender_username_fallback() -> None:
    p = parse_text((POSTS / "ru_agent.txt").read_text(), sender_username="arenda_tsh")
    assert (p.price_amount_minor, p.price_currency) == (30000, "USD")
    assert (p.rooms, p.floor, p.total_floors, p.area_sqm) == (1, 2, 4, 32.0)
    assert p.district == "mirobod"
    assert p.phones == ["+998971234567"]
    assert p.telegram_username == "arenda_tsh"
    assert p.agent_marker is True


def test_structured_values_override_text() -> None:
    p = parse_text(
        "2-xonali, 3/9, Chilonzor, 400$",
        structured={
            "rooms": 3,
            "price_amount_minor": 50000,
            "price_currency": "USD",
            "district": "yunusobod",
        },
    )
    assert (p.rooms, p.price_amount_minor, p.district) == (3, 50000, "yunusobod")


def test_structured_none_and_partial_price_fall_back_to_text() -> None:
    text = "2-xonali, 3/9, Chilonzor, 400$"
    p = parse_text(text, structured={"price_amount_minor": 50000})
    assert (p.price_amount_minor, p.price_currency) == (40000, "USD")
    p = parse_text("2-xonali, 3/9, Chilonzor", structured={"price_amount_minor": 50000})
    assert (p.price_amount_minor, p.price_currency) == (None, None)
    p = parse_text(text, structured={"price_currency": "UZS"})
    assert (p.price_amount_minor, p.price_currency) == (40000, "USD")
    p = parse_text(text, structured={"price_amount_minor": 50000, "price_currency": "USD"})
    assert (p.price_amount_minor, p.price_currency) == (50000, "USD")
    p = parse_text(text, structured={"title": None, "district": None})
    assert p.title == "2-xonali, 3/9, Chilonzor, 400$" and p.district == "chilonzor"


def test_confidence_is_low_when_little_is_found() -> None:
    p = parse_text("Ijaraga beriladi, qo'ng'iroq qiling")
    assert p.parse_confidence == 0.0
    assert p.title == "Ijaraga beriladi, qo'ng'iroq qiling"


def test_email_address_is_not_mistaken_for_telegram_username() -> None:
    assert parse_text("Chilonzor 2-xonali 450$ email: sardor@gmail.com").telegram_username is None
