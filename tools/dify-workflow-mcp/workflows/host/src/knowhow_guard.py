_base_guard_main = main

KNOWN_KNOWHOW = {"HK{:02d}".format(index) for index in range(1, 29)}
STRATEGIES = {
    "direct_answer", "encourage", "invite_collaboration", "soft_response",
    "defer_interruption", "bridge_to_game", "resume_game", "closing",
}
REASON_CODES = {
    "ordinary_yes_no", "repeated_wrong_guesses", "explicit_help_request",
    "independent_thinking_requested", "eligible_collaborator_available",
    "sleeping_passenger_excluded", "environment_change", "smalltalk_continuity",
    "interruption_recovery", "near_destination", "hint_request_blocked",
    "paused_state", "no_relevant_knowhow",
    "achievement_feedback", "host_preference",
}
STRATEGY_BY_ID = {
    "HK01": {"encourage"}, "HK02": {"encourage", "invite_collaboration"},
    "HK03": {"soft_response"}, "HK04": {"invite_collaboration", "encourage"},
    "HK05": {"soft_response"}, "HK06": {"defer_interruption", "soft_response"},
    "HK07": {"bridge_to_game", "direct_answer", "soft_response"},
    "HK08": {"resume_game", "soft_response"}, "HK09": {"closing", "soft_response"},
}
SEAT_LABELS = {"front": "副驾", "rearLeft": "后排左", "rearRight": "后排右"}
STRATEGY_BY_ID.update({"HK{:02d}".format(index): {"encourage"} for index in range(10, 22)})
STRATEGY_BY_ID.update({"HK22": {"soft_response"}, "HK23": {"direct_answer", "soft_response"},
                       "HK24": {"soft_response"}, "HK25": {"direct_answer"},
                       "HK26": {"soft_response"}, "HK27": {"closing"},
                       "HK28": {"invite_collaboration"}})


def main(director_text: str, payload: object, director_context: str) -> dict:
    payload = parse(payload)
    base = json.loads(_base_guard_main(director_text, payload)["workflow_output"])
    context = parse(director_context)
    knowhow = obj(context.get("knowhow"))
    game = obj(payload.get("game"))
    retrieved = []
    for record in items(knowhow.get("retrieved"))[:3]:
        if not isinstance(record, dict):
            continue
        knowhow_id = text(record.get("knowhow_id"), 20)
        if knowhow_id in KNOWN_KNOWHOW and all(x["knowhow_id"] != knowhow_id for x in retrieved):
            retrieved.append({"knowhow_id": knowhow_id, "title": text(record.get("title"), 120) or knowhow_id})
    retrieved_ids = {record["knowhow_id"] for record in retrieved}
    status = text(knowhow.get("status"), 20)
    if status not in ("used", "not_relevant", "empty", "failed"):
        status = "failed"
    if status == "used" and not retrieved:
        status = "failed"
    if status != "used":
        retrieved = []
        retrieved_ids = set()

    value = model_json(director_text)
    strategy = text(value.get("strategy"), 40)
    target = value.get("target_seat")
    target = text(target, 30) if isinstance(target, str) else None
    reasons = list(dict.fromkeys(code for code in items(value.get("reason_codes"))
                                 if isinstance(code, str) and code in REASON_CODES))[:5]
    claims = list(dict.fromkeys(code for code in items(value.get("applied_knowhow_ids"))
                                if isinstance(code, str)))[:3]
    eligible = items(knowhow.get("eligible_target_seats"))
    errors = []

    if strategy not in STRATEGIES:
        errors.append("invalid_strategy")
    invalid_claims = [knowhow_id for knowhow_id in claims if knowhow_id not in retrieved_ids]
    if invalid_claims:
        errors.append("unretrieved_knowhow_id")
    if any(not isinstance(seat, str) or seat not in eligible or seat not in SEAT_LABELS for seat in [target] if target):
        errors.append("ineligible_target_seat")
    if strategy == "invite_collaboration" and (not target or target not in eligible):
        errors.append("collaboration_without_eligible_target")
    if target and strategy != "invite_collaboration":
        errors.append("target_without_collaboration_strategy")
    for knowhow_id in claims:
        if knowhow_id in STRATEGY_BY_ID and strategy not in STRATEGY_BY_ID[knowhow_id]:
            errors.append("strategy_conflicts_with_knowhow")
            break

    paused = game.get("status") == "paused"
    if paused and not base.get("execution", {}).get("actions"):
        errors.append("game_paused")

    actual_hint_block = bool(base.get("decision_trace", {}).get("hint_blocked"))
    if not actual_hint_block:
        reasons = [code for code in reasons if code != "hint_request_blocked"]

    if actual_hint_block:
        strategy = "soft_response"
        reasons = ["hint_request_blocked"]
        target = None
        claims = []

    if errors:
        base["ai_reply_text"] = "我先按游戏规则陪你继续，谜底和额外提示先保密。"
        base["intent"] = "fallback"
        base["reply_mode"] = "answer_only"
        base["covered_fact_keys"] = []
        base["passenger_action"] = None
        # Actions in the base output are derived deterministically from explicit
        # music authorization, never copied from the model's free-form fields.
        base["decision_trace"]["guard_status"] = "knowhow_fallback"
        base["debug"] = {**obj(base.get("debug")), "fallback_origin": "knowhow_guard",
                         "validation_errors": list(dict.fromkeys(items(obj(base.get("debug")).get("validation_errors")) + errors))}
        strategy = "soft_response"
        reasons = ["paused_state"] if paused else ["no_relevant_knowhow"]
        target = None
        claims = []

    if paused:
        base["game_status"] = "paused"
        base["is_correct"] = False
        base["covered_fact_keys"] = []
        base["ui_change"]["show_answer"] = False
        base["decision_trace"]["guard_status"] = "paused_no_progress"
        if "paused_state" not in reasons:
            reasons.append("paused_state")
        strategy = "soft_response"
        target = None
        claims = []

    if not actual_hint_block and re.search(
        r"(?:不能|不可以|不允许|不让|不提供|不主动给).{0,10}(?:提示|线索|暗示)|(?:提示|线索|暗示).{0,10}(?:不能|不可以|不允许|不让|不提供)",
        text(base.get("ai_reply_text"), 1000),
    ):
        if strategy == "invite_collaboration" and target in eligible and target in SEAT_LABELS:
            base["ai_reply_text"] = "我陪你一起想。要不要请{}也来帮忙？".format(SEAT_LABELS[target])
        else:
            base["ai_reply_text"] = "我陪你一起换个角度想想，咱们慢慢来。"

    base["knowhow_status"] = status
    base["retrieved_knowhow"] = retrieved
    base["strategy"] = strategy if strategy in STRATEGIES else "soft_response"
    base["target_seat"] = target
    base["reason_codes"] = reasons
    base["applied_knowhow_ids"] = claims
    base["decision_trace"]["decision"] = "策略：{}；依据：{}".format(
        base["strategy"], "、".join(reasons) if reasons else "无附加经验依据"
    )
    base["decision_trace"]["strategy_id"] = base["strategy"]
    if errors:
        base["decision_trace"]["matched_rule"] = "knowhow_output_guard"
    if target:
        base["decision_trace"]["decision"] += "；协作目标：{}".format(SEAT_LABELS[target])
    if claims:
        base["decision_trace"]["decision"] += "；采用经验：{}".format("、".join(claims))
    return {"workflow_output": encode(base)}
