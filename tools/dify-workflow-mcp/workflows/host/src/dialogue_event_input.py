_event_dialogue_input = main


def main(query: str, snapshot: str, situation: str) -> dict:
    source = parse(snapshot)
    event_request = obj(source.get("dialogue_request"))
    scene = parse(situation)
    kind = text(obj(source.get("event")).get("type"), 80)
    if event_request.get("kind") != "situation_event":
        return _event_dialogue_input(query, snapshot, situation)
    current = clean_snapshot(snapshot)
    event = obj(current.get("event"))
    participation = obj(current.get("participation"))
    valid = (kind in SCENE_EVENTS or kind == "post_result_feedback") and kind not in P0_EVENTS
    seat = text(event.get("seat"), 30)
    mood = canonical_states(current).get(seat)
    active_comfort = items(obj(current.get("car")).get("sleep_comfort_seats"))
    comfort_candidate = (kind == "passenger_sleep" and mood in {"sleeping", "asleep", "睡着"}
                         or kind == "passenger_wake" and mood in AWAKE_STATES and seat in active_comfort)
    comfort_decision = (comfort_candidate and scene.get("request_host_decision") is True
                        and scene.get("host_decision_seat") == event.get("seat")
                        )
    valid = (valid and event_request.get("event_id") == event.get("id") == scene.get("event_id")
             and all(scene.get(key) == value for key, value in scope(current).items())
             and scene.get("analysis_status") == "ready"
             and (scene.get("request_proactive_speech") is True or comfort_decision))
    handoff_checks = {}
    if kind == "passenger_inactive":
        handoff_checks = {
            "participation_snapshot_present": bool(participation),
            "participation_candidate_valid": valid_participation_candidate(current),
            "participation_version_match": (participation.get("version") is not None
                                            and scene.get("participation_version") == participation.get("version")),
        }
        valid = valid and all(handoff_checks.values())
    try:
        now = int(time.time() * 1000)
        valid = valid and int(scene["generated_at_ms"]) <= now + 2000
        valid = valid and now < int(scene["expires_at_ms"]) <= int(scene["generated_at_ms"]) + 60000
    except (KeyError, TypeError, ValueError):
        valid = False
    valid = valid and (valid_result_feedback(current) if kind == "post_result_feedback" else obj(current.get("game")).get("status") in {"playing", "opening"})
    # Normalize without allowing event notification text to become a player guess.
    base = dict(source, trigger_type="chat", event={"priority": "P2"}, player_input="")
    result = _event_dialogue_input("", encode(base), "{}")
    normalized = parse(result["payload"])
    normalized.update(trigger_type="event", player_input="", event=event,
                      dialogue_request={"kind": "situation_event", "event_id": event.get("id")})
    context = parse(result["context_json"])
    shared = obj(scene.get("dialogue_context")) if valid else {}
    context.update(trigger_type="event", player_input="", speaker_seat=None, speaker_persona={}, event=event if valid else {},
                   fact_catalog=[], asked_questions=[],
                   game={key: obj(current.get("game")).get(key) for key in ("status", "round_index", "question_count", "max_questions")},
                   selected_snapshot=obj(shared.get("selected_snapshot")), situation_guidance=obj(shared.get("guidance")),
                   knowhow=obj(shared.get("knowhow")) or empty_knowhow(current), situation_status="valid" if valid else "invalid_event_handoff",
                   event_dialogue={"valid": bool(valid), "event_type": kind, "event_id": event.get("id"),
                                   "current_observation": shareable_snapshot(current), "feedback": obj(shared.get("feedback")),
                                   "handoff_checks": handoff_checks,
                                   "failed_handoff_checks": [key for key, passed in handoff_checks.items() if not passed]})
    sleep_seat = text(event.get("seat"), 30)
    sleep_eligible = (valid and kind == "passenger_sleep"
                      and canonical_states(current).get(sleep_seat) in {"sleeping", "asleep", "睡着"}
                      and sleep_seat not in active_comfort)
    restore_eligible = valid and kind == "passenger_wake" and mood in AWAKE_STATES and seat in active_comfort
    context["sleep_comfort"] = {
        "eligible_seats": [sleep_seat] if sleep_eligible else [],
        "restore_eligible_seats": [seat] if restore_eligible else [],
        "action_type": "cabin.apply_sleep_comfort", "decision_owner": "host", "optional": False,
        "required": bool(sleep_eligible),
        "restore_action_type": "cabin.restore_sleep_comfort",
        "decision_only": comfort_decision and scene.get("request_proactive_speech") is not True,
        "effects": ["关闭该区域灯光", "分区音量设为0", "分区空调调至用户记忆值"],
    }
    context["hard_constraints"].append("本轮是系统情境事件，不是乘客提问；只回应本次事件，不回答旧问题、不提谜底、不添加提示、不改变游戏。有效入睡候选座位必须启用睡眠关怀：关灯、分区音量0、空调调至用户记忆值，不得关闭空调；已启用的不重复执行。已醒来且有已启用关怀的候选座位可提出恢复；所有设备动作必须有描述灯光、空调和分区音量的话术，前端等该话术实际出现才执行，其余情境不允许设备动作。")
    result.update(payload=encode(normalized), context_json=encode(context), is_p0=False, exact_correct=False,
                  event_type=kind, priority=event.get("priority", "P3"))
    return result
