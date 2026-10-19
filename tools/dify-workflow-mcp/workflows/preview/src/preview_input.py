import json


def obj(value):
    return value if isinstance(value, dict) else {}


def items(value):
    return value if isinstance(value, list) else []


def main(input_payload: str) -> dict:
    try:
        payload = json.loads(input_payload)
        payload = payload if isinstance(payload, dict) else {}
    except (ValueError, TypeError):
        payload = {}
    game = obj(payload.get("game"))
    request = obj(payload.get("round_question_plan_request"))
    try:
        count = max(2, min(8, int(request.get("step_count", payload.get("step_count", 4)))))
    except (ValueError, TypeError, OverflowError):
        count = 4
    groups = [group for group in items(request.get("persona_age_groups")) if group in ("child", "adult", "elder")]
    if not groups:
        personas = obj(obj(payload.get("passengers")).get("personas"))
        groups = [obj(personas.get(seat)).get("age_group") for seat in ("driver", "rear_left", "rear_right")]
        groups = [group for group in groups if group in ("child", "adult", "elder")]
    groups = list(dict.fromkeys(groups))
    context = {
        "answer": str(game.get("current_answer") or "")[:100],
        "hint": str(game.get("hint") or "")[:300],
        "theme": str(game.get("current_theme") or "")[:100],
        "round_index": game.get("round_index", 0),
        "step_count": count,
        "variant_groups": ["default"] + [group for group in (groups or ["child", "adult", "elder"]) if group != "adult"],
    }
    repair = request.get("repair")
    if isinstance(repair, dict):
        prefix = repair.get("accepted_steps")
        plan_id = str(repair.get("plan_id") or "")[:150]
        invalid = (
            repair.get("attempt") != 1
            or not plan_id
            or not isinstance(prefix, list)
            or len(prefix) > count
        )
        context["repair"] = {
            "attempt": 1,
            "invalid": invalid,
            "plan_id": plan_id,
            "accepted_steps": prefix[:count] if isinstance(prefix, list) else [],
            "validation_errors": [str(code)[:160] for code in items(repair.get("validation_errors"))[:30]],
        }
        context["remaining_step_count"] = count - len(context["repair"]["accepted_steps"])
    return {"context_json": json.dumps(context, ensure_ascii=False, separators=(",", ":"))}
