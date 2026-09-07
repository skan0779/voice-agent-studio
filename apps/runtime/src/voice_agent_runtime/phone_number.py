from __future__ import annotations

import re


class InvalidPhoneNumberError(ValueError):
    pass


def normalize_phone_number(value: str) -> str:
    """Normalize Korean local input or validate an international E.164 number."""
    compact = re.sub(r"[\s().-]", "", value.strip())
    if compact.startswith("00"):
        compact = f"+{compact[2:]}"
    elif compact.startswith("0"):
        compact = f"+82{compact[1:]}"
    elif compact.startswith("82"):
        compact = f"+{compact}"

    if not re.fullmatch(r"\+[1-9]\d{7,14}", compact):
        raise InvalidPhoneNumberError(
            "전화번호를 010-1234-5678 또는 +821012345678 같은 국제 표준 형식으로 입력해 주세요."
        )
    return compact
