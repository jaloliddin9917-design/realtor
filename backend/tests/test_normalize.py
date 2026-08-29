from app.ingestion.parse.normalize import normalize, translit


def test_normalize_unifies_apostrophes_and_whitespace() -> None:
    assert normalize("Oʻrikzor   ko’chasi\n\n 3-qavat") == "O'rikzor ko'chasi 3-qavat"


def test_translit_cyrillic_uzbek_and_russian() -> None:
    assert translit("Чилонзор, 2-хонали, ЕВРО РЕМОНТ") == "chilonzor, 2-xonali, evro remont"
    assert translit("Юнусабад, 3 комн, хозяин") == "yunusabad, 3 komn, xozyain"
    assert translit("Ўрикзор кўчаси, Ғафур Ғулом") == "o'rikzor ko'chasi, g'afur g'ulom"


def test_translit_keeps_latin_and_digits() -> None:
    assert translit("Sergeli 7-mavze $450") == "sergeli 7-mavze $450"
