import json


def items(value):
    return value if isinstance(value, list) else []


def parse(value):
    if isinstance(value, dict):
        return value
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, dict) else {}
    except (ValueError, TypeError):
        return {}


def main(context_json: str, eligible_target_seats: str) -> dict:
    context = parse(context_json)
    try:
        eligible = items(json.loads(eligible_target_seats))
    except (ValueError, TypeError):
        eligible = []
    context["knowhow"] = {
        "status": "not_relevant",
        "retrieved": [],
        "eligible_target_seats": eligible,
        "retrieval_policy": "skipped_by_rule",
    }
    return {"director_context": json.dumps(context, ensure_ascii=False, separators=(",", ":"))}
