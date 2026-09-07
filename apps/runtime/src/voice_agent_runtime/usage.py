def to_dict(obj) -> dict:
    """Convert an SDK object to a plain dict (recursively)."""
    if isinstance(obj, dict):
        return {k: to_dict(v) for k, v in obj.items()}
    if hasattr(obj, "__dict__"):
        return {k: to_dict(v) for k, v in vars(obj).items() if not k.startswith("_")}
    return obj


def merge_usage(acc: dict, src: dict) -> dict:
    """Recursively merge src into acc, summing numeric values."""
    for key, val in src.items():
        if isinstance(val, dict):
            acc[key] = merge_usage(acc.get(key, {}), val)
        elif isinstance(val, (int, float)):
            acc[key] = acc.get(key, 0) + val
        else:
            acc[key] = val
    return acc
