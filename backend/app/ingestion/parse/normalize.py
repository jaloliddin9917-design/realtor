import re
import unicodedata

_APOSTROPHES = str.maketrans({"ʻ": "'", "ʼ": "'", "’": "'", "‘": "'", "`": "'", "ʹ": "'"})
_WS = re.compile(r"\s+")

# Uzbek Cyrillic → Latin; Russian-only letters map to their common Uzbek-Latin reading.
_CYR = {
    "а": "a",
    "б": "b",
    "в": "v",
    "г": "g",
    "д": "d",
    "е": "e",
    "ё": "yo",
    "ж": "j",
    "з": "z",
    "и": "i",
    "й": "y",
    "к": "k",
    "л": "l",
    "м": "m",
    "н": "n",
    "о": "o",
    "п": "p",
    "р": "r",
    "с": "s",
    "т": "t",
    "у": "u",
    "ф": "f",
    "х": "x",
    "ц": "ts",
    "ч": "ch",
    "ш": "sh",
    "щ": "sh",
    "ъ": "'",
    "ы": "i",
    "ь": "",
    "э": "e",
    "ю": "yu",
    "я": "ya",
    "ў": "o'",
    "қ": "q",
    "ғ": "g'",
    "ҳ": "h",
}
_CYR_TABLE = {ord(k): v for k, v in _CYR.items()}


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFC", text).translate(_APOSTROPHES)
    return _WS.sub(" ", text).strip()


def translit(text: str) -> str:
    return normalize(text).lower().translate(_CYR_TABLE)
