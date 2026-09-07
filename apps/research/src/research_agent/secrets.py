from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken


class SecretCipher:
    def __init__(self, master_key: str):
        derived_key = base64.urlsafe_b64encode(hashlib.sha256(master_key.encode("utf-8")).digest())
        self._fernet = Fernet(derived_key)

    def decrypt(self, value: str) -> str:
        if not value:
            return ""
        try:
            return self._fernet.decrypt(value.encode("ascii")).decode("utf-8")
        except InvalidToken as exc:
            raise RuntimeError("Stored Workspace secrets cannot be decrypted with RUNTIME_SECRET_KEY.") from exc
