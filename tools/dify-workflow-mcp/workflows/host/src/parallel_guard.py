_parallel_base_main = main


def main(director_text: str, payload: str, director_context: str) -> dict:
    result = parse(_parallel_base_main(director_text, payload, director_context)["workflow_output"])
    current = parse(payload)
    game = obj(current.get("game"))
    value = model_json(director_text)
    line = text(result.get("ai_reply_text"), 500)
    allowed = eligible_seats(current, selected_seat(current) if current.get("trigger_type") == "chat" else None)
    target = result.get("target_seat")
    invitation = bool(re.search(r"邀请|请.{0,12}(?:一起|参与|猜|回答|帮忙)|(?:一起|帮忙).{0,8}猜", line))
    bad_spoken_target = invitation and any(label in line and seat not in allowed
        for seat, label in (("driver", "主驾"), ("front", "副驾"), ("rearLeft", "后排左"), ("rearRight", "后排右")))
    unscoped_invitation = invitation and (not target or result.get("strategy") != "invite_collaboration" or "大家" in line or "后排" in line and "后排左" not in line and "后排右" not in line)
    independent = bool(re.search(r"让我.{0,4}想想|自己猜|先别帮|不用帮", text(current.get("player_input"), 800)))
    reasons = []
    if bad_spoken_target:
        reasons.append("invited_ineligible_seat_in_reply")
    if unscoped_invitation:
        reasons.append("invitation_without_valid_target_or_strategy")
    if target and target not in allowed:
        reasons.append("ineligible_target_seat")
    if independent and invitation:
        reasons.append("independent_thinking_invitation_conflict")
    upstream_errors = items(obj(result.get("debug")).get("validation_errors"))
    if upstream_errors:
        reasons.append("upstream_validation_failed")
    if game.get("status") == "paused" and not result.get("execution", {}).get("actions"):
        line = "游戏先暂停，我们等适合的时候再继续。"
        reasons.append("paused_without_action")
    if reasons:
        result.update(ai_reply_text=line if game.get("status") == "paused" else "我陪你慢慢想，按你的节奏来。",
                      strategy="soft_response", target_seat=None, applied_knowhow_ids=[], covered_fact_keys=[], passenger_action=None)
        result["decision_trace"].update(guard_status="constraint_fallback", strategy_id="soft_response", decision="按当前约束采用简短回应")
        result["debug"] = {**obj(result.get("debug")), "fallback_origin": "parallel_guard",
                           "fallback_reason_codes": reasons}
        result["decision_trace"]["guard_reason_codes"] = reasons
    if not result.get("ui_change", {}).get("show_answer"):
        result["answer"] = None
    # Experience can never authorize a vehicle action. Explicit music commands
    # remain the deterministic base guard's only ordinary action source.
    if current.get("trigger_type") != "chat":
        result["execution"]["actions"] = []
    return {"workflow_output": encode(result)}
