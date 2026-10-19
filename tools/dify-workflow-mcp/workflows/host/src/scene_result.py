_scene_guard_main = main


def main(director_text: str, payload: str, director_context: str) -> dict:
    current, context = parse(payload), parse(director_context)
    response = parse(_scene_guard_main(director_text, payload, director_context)["workflow_output"])
    environment_event = context.get("environment_fast_path") is True and valid_environment_change(current)
    if environment_event:
        line = text(response.get("ai_reply_text"), 1000)
        environment = text(obj(current.get("car")).get("environment"), 100)
        topics = ("高速",) if environment.startswith("高速") else ("市区", "城区") if environment.startswith("城区") else ("景区",) if environment.startswith("风景区") else (environment,)
        if (obj(response.get("decision_trace")).get("guard_status") != "passed"
                or response.get("strategy") != "soft_response"
                or response.get("target_seat") or response.get("applied_knowhow_ids")
                or not any(topic in line for topic in topics)
                or len(line) > 30 or re.search(r"路况|畅通|安全|减速|加速|空调|音乐|答案|提示|线索|[？?]", line)):
            response = environment_rule_response(current, fallback=True)
        response["reason_codes"] = ["environment_change"]
        response["decision_trace"].update(priority="P1", matched_rule="environment_announcement",
                                           decision="环境变化优先播报，等待前端执行")
    plan = obj(context.get("analysis_plan"))
    selected = {key: shareable_snapshot(current)[key] for key in items(plan.get("selected_fields")) if key in SHARE_FIELDS}
    known = obj(context.get("knowhow"))
    valid = plan.get("analysis_valid") is True
    guarded = response.get("decision_trace", {}).get("guard_status") in {"passed", "hint_blocked"}
    usable = valid and guarded and plan.get("share_context") is True and bool(selected)
    speaking = valid and guarded and plan.get("proactive_speech") is True and context.get("proactive_allowed") is True
    participation_event = obj(current.get("event")).get("type") == "passenger_inactive"
    if participation_event:
        speaking = (speaking and valid_participation_candidate(current)
                    and response.get("strategy") == "invite_collaboration" and response.get("target_seat") == "front")
        usable = False
    guidance = {key: response.get(key) for key in ("strategy", "target_seat", "reason_codes", "applied_knowhow_ids")}
    # Keep only adopted, applicable experience in the next chat prompt. Examples
    # and unrelated retrieved documents stay in the event trace, not in Memory.
    compact = []
    for row in items(known.get("retrieved")):
        if row.get("knowhow_id") not in response.get("applied_knowhow_ids", []):
            continue
        record = parse(row.get("content"))
        rule = {key: record[key] for key in ("recommended_strategy", "recommended_actions", "exceptions") if key in record}
        compact.append({"knowhow_id": row["knowhow_id"], "title": row["title"], "content": encode(rule)[:700]})
    cached_knowhow = {"status": "used" if compact else "not_relevant", "retrieved": compact,
                      "eligible_target_seats": items(known.get("eligible_target_seats"))}
    share = {"selected_snapshot": selected, "guidance": guidance, "knowhow": cached_knowhow} if usable else {}
    result = scene_envelope(current, share, response if speaking else None,
                            "ready" if valid and guarded else "failed", speaking, usable)
    if participation_event:
        result["participation_version"] = participation_snapshot(current).get("version")
        result["expires_at_ms"] = result["generated_at_ms"] + 10000
    result.update(knowhow_status=response.get("knowhow_status"), retrieved_knowhow=known.get("retrieval_hits", response.get("retrieved_knowhow")),
                  strategy=response.get("strategy"), target_seat=response.get("target_seat"),
                  reason_codes=response.get("reason_codes"), applied_knowhow_ids=response.get("applied_knowhow_ids"),
                  perception=response.get("perception"), decision_trace=response.get("decision_trace"), execution=response.get("execution"))
    return {"scene_output": encode(result)}
