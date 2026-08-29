import pytest

from app.ingestion.parse.districts import match_district


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Chilonzor, Qatortol, 2-xonali", "chilonzor"),
        ("Чиланзар 19 квартал", "chilonzor"),
        ("Ч-зор, 2 комн", "chilonzor"),
        ("Mirzo Ulug'bek tumani, TTZ", "mirzo_ulugbek"),
        ("М.Улугбек, Буюк Ипак Йули", "mirzo_ulugbek"),
        ("Мирзо-Улугбекский район", "mirzo_ulugbek"),
        ("Yunusobod 11-kvartal", "yunusobod"),
        ("Юнусабад, 4 квартал", "yunusobod"),
        ("Яккасарайский р-н, Бобур", "yakkasaroy"),
        ("Shayxontohur, Beruniy", "shayxontohur"),
        ("Шайхантахур", "shayxontohur"),
        ("Yashnobod, Tuzel", "yashnobod"),
        ("Яшнабад", "yashnobod"),
        ("Olmazor, Qorasaroy", "olmazor"),
        ("Алмазар", "olmazor"),
        ("Mirobod, Oybek", "mirobod"),
        ("Мирабад", "mirobod"),
        ("Sergeli, Sputnik", "sergeli"),
        ("Uchtepa", "uchtepa"),
        ("Bektemir", "bektemir"),
        ("Yangihayot tumani", "yangihayot"),
        ("Янги хаёт", "yangihayot"),
        ("2-xonali kvartira, evro remont", None),
    ],
)
def test_match_district(text: str, expected: str | None) -> None:
    assert match_district(text) == expected
