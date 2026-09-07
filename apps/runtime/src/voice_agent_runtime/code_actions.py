from __future__ import annotations

import json
import subprocess
import sys
import textwrap
from typing import Any

_WORKER = r"""
import json
import sys

payload = json.loads(sys.stdin.read())
safe_builtins = {
    "abs": abs,
    "all": all,
    "any": any,
    "bool": bool,
    "dict": dict,
    "enumerate": enumerate,
    "float": float,
    "int": int,
    "isinstance": isinstance,
    "len": len,
    "list": list,
    "max": max,
    "min": min,
    "next": next,
    "range": range,
    "round": round,
    "set": set,
    "str": str,
    "sum": sum,
    "tuple": tuple,
    "zip": zip,
}
source = "def run(inputs):\n" + "\n".join(
    "    " + line for line in payload["code"].splitlines()
)
namespace = {}
exec(compile(source, "<voice-agent-function>", "exec"), {"__builtins__": safe_builtins}, namespace)
result = namespace["run"](payload["inputs"])
sys.stdout.write(json.dumps(result, ensure_ascii=False))
"""


class CodeActionError(RuntimeError):
    pass


def run_python_action(code: str, inputs: dict[str, Any], *, timeout_seconds: float = 1.0) -> Any:
    """Execute an MVP Code Action outside the API process.

    This is intentionally opt-in. The restricted builtins and process boundary
    reduce accidental damage but are not a production security sandbox.
    """
    try:
        completed = subprocess.run(
            [sys.executable, "-I", "-S", "-c", textwrap.dedent(_WORKER)],
            input=json.dumps({"code": code, "inputs": inputs}, ensure_ascii=False),
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise CodeActionError("Python Code action timed out.") from exc
    if completed.returncode != 0:
        message = completed.stderr.strip().splitlines()[-1] if completed.stderr.strip() else "Unknown worker error"
        raise CodeActionError(f"Python Code action failed: {message}")
    try:
        return json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise CodeActionError("Python Code action returned a non-JSON value.") from exc
