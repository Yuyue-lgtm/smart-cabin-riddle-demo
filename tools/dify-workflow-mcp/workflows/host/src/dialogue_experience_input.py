_experience_dialogue_input = main


def main(query: str, snapshot: str, situation: str) -> dict:
    result = _experience_dialogue_input(query, snapshot, situation)
    current = clean_snapshot(snapshot)
    context = parse(result["context_json"])
    context["host_preferences"] = host_preferences(current)
    context["performance"] = performance_snapshot(current)
    context["hard_constraints"].append("结算期间的夸奖、安慰或闲聊是新的对话需求，不能重复当成答对事件；只回应原话。")
    result["context_json"] = encode(context)
    return result
