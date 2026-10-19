def main(payload: str, director_context: str) -> dict:
    current, context = parse(payload), parse(director_context)
    event = obj(current.get("event"))
    kind = text(event.get("type"), 80)
    plan, known = obj(context.get("analysis_plan")), obj(context.get("knowhow"))
    valid = plan.get("analysis_valid") is True
    speaking = valid and plan.get("proactive_speech") is True and context.get("proactive_allowed") is True
    feedback = kind == "post_result_feedback"
    participation = kind == "passenger_inactive"
    if feedback:
        valid = valid and valid_result_feedback(current)
        speaking = speaking and valid
    if participation:
        speaking = speaking and valid_participation_candidate(current)
    fields = [key for key in items(plan.get("selected_fields")) if key in SHARE_FIELDS]
    public = shareable_snapshot(current)
    records = []
    for row in items(known.get("retrieved"))[:3]:
        if not isinstance(row, dict) or not re.fullmatch(r"HK(?:0[1-9]|1[0-9]|2[0-8])", text(row.get("knowhow_id"), 10)):
            continue
        record = parse(row.get("content"))
        rules = {key: record[key] for key in ("recommended_strategy", "recommended_actions", "exceptions") if key in record}
        records.append({"knowhow_id": row["knowhow_id"], "title": text(row.get("title"), 120), "content": encode(rules)[:1200]})
    strategy = ("encourage" if feedback or kind in {"game_stuck", "near_answer"} else
                "invite_collaboration" if participation else "closing" if kind == "near_destination" else "soft_response")
    target = "front" if participation and speaking else None
    guidance = {"strategy": strategy, "target_seat": target, "event_type": kind,
                "reason_codes": ["achievement_feedback" if feedback else kind], "applied_knowhow_ids": []}
    references = {"status": "used" if records else known.get("status", "not_relevant"), "retrieved": records,
                  "eligible_target_seats": ["front"] if target else eligible_seats(current)}
    dialogue = {"selected_snapshot": {key: public[key] for key in fields}, "guidance": guidance, "knowhow": references}
    if feedback:
        dialogue["feedback"] = feedback_snapshot(current)
    usable = valid and plan.get("share_context") is True and bool(fields) and not feedback and not participation
    result = scene_envelope(current, dialogue if valid else {}, status="ready" if valid else "failed", speak=speaking, usable=usable)
    trace = envelope(current, "", event.get("priority", "P3"), layer="rule" if context.get("priority_fast_path") or feedback else "llm",
                     rule=kind, decision="情境分析完成，申请Chatflow回应" if speaking else "情境分析完成，本次静默")
    result.update(event_type=kind, host_response=None, strategy=strategy, target_seat=target,
                  reason_codes=guidance["reason_codes"], applied_knowhow_ids=[], knowhow_status=references["status"],
                  retrieved_knowhow=known.get("retrieval_hits", [{"knowhow_id": row["knowhow_id"], "title": row["title"]} for row in records]),
                  perception=trace["perception"], decision_trace=trace["decision_trace"],
                  execution={"kind": "plan", "actions": [], "timing": {"owner": "frontend"}, "fallback": "silent"})
    result["decision_trace"].update(guard_status="passed" if valid else "analysis_invalid", strategy_id=strategy,
                                    selection_origin="priority_rule" if context.get("priority_fast_path") else "analysis_plan")
    if feedback:
        result["feedback_id"] = feedback_snapshot(current)["id"]
    if participation:
        result["participation_version"] = participation_snapshot(current).get("version")
        result["expires_at_ms"] = result["generated_at_ms"] + 10000
    return {"scene_output": encode(result)}
