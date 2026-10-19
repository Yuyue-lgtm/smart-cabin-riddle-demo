_event_dialogue_guard = main

STRATEGY_BY_ID.update({"HK{:02d}".format(index): {"encourage"} for index in range(10, 22)})
STRATEGY_BY_ID.update({"HK22": {"soft_response"}, "HK23": {"direct_answer", "soft_response"},
                       "HK24": {"soft_response"}, "HK25": {"direct_answer"},
                       "HK26": {"soft_response"}, "HK27": {"closing"},
                       "HK28": {"invite_collaboration"}})


def sleep_comfort_actions(value, current, context):
    actions = items(value.get("execution_actions"))
    if not actions:
        return []
    event = obj(current.get("event"))
    if (len(actions) != 1 or not isinstance(actions[0], dict)
            or set(actions[0]) != {"type", "seat"}):
        return None
    action = actions[0]
    seat = action.get("seat")
    restoring = action.get("type") == "cabin.restore_sleep_comfort"
    eligible = obj(context.get("sleep_comfort")).get("restore_eligible_seats" if restoring else "eligible_seats", [])
    mood = canonical_states(current).get(seat) if isinstance(seat, str) else None
    state_allowed = (mood in AWAKE_STATES and seat in items(obj(current.get("car")).get("sleep_comfort_seats"))
                     if restoring else mood in {"sleeping", "asleep", "睡着"})
    if (action.get("type") not in {"cabin.apply_sleep_comfort", "cabin.restore_sleep_comfort"} or not isinstance(seat, str)
            or seat not in {"driver", "front", "rearLeft", "rearRight"}
            or seat != event.get("seat") or seat not in eligible
            or not state_allowed
            or event.get("type") != ("passenger_wake" if restoring else "passenger_sleep") or event.get("priority") == "P0"
            or obj(current.get("game")).get("status") not in {"opening", "playing"}):
        return None
    return [{"type": action["type"], "seat": seat}]


def main(director_text: str, payload: str, director_context: str, model_result: str = "") -> dict:
    result = parse(_event_dialogue_guard(director_text, payload, director_context, model_result)["workflow_output"])
    current, context = parse(payload), parse(director_context)
    if obj(current.get("dialogue_request")).get("kind") != "situation_event":
        return {"workflow_output": encode(result)}
    valid = obj(context.get("event_dialogue")).get("valid") is True
    guard = obj(result.get("decision_trace"))
    normalized = parse(model_result)
    model = model_json(normalized.get("canonical_text", director_text))
    actions = sleep_comfort_actions(model, current, context)
    comfort = obj(context.get("sleep_comfort"))
    event = obj(current.get("event"))
    required = (valid and comfort.get("required") is True and event.get("type") == "passenger_sleep"
                and event.get("seat") in items(comfort.get("eligible_seats"))
                and event.get("priority") != "P0"
                and obj(current.get("game")).get("status") in {"opening", "playing"})
    if required and actions is not None:
        # The trusted event authorizes this one compound action, never arbitrary model actions.
        actions = [{"type": "cabin.apply_sleep_comfort", "seat": event["seat"]}]
        reply = text(result.get("ai_reply_text"), 500)
        complete = (guard.get("guard_status") == "passed" and result.get("intent") != "fallback"
                    and all(re.search(pattern, reply) for pattern in (r"灯", r"音量|声音|静音", r"空调|温度", r"记忆"))
                    and not re.search(r"(?:关|停).{0,6}空调|空调.{0,6}(?:关闭|关掉|停用)", reply))
        if not complete:
            label = {"driver": "主驾", "front": "副驾", "rearLeft": "后排左", "rearRight": "后排右"}[event["seat"]]
            result["ai_reply_text"] = "{}的朋友睡着了，我来关闭这一区的灯光、将分区音量设为0，空调调至用户记忆值，让你安心休息。".format(label)
        result["intent"] = "event"
        guard["guard_status"] = "passed"
        guard["decision"] = "检测到乘员入睡，按规则启用目标座位睡眠关怀"
        guard.pop("guard_reason_codes", None)
        result.setdefault("debug", {})["sleep_comfort_policy"] = "required_on_sleep"
    passed = valid and guard.get("guard_status") == "passed" and result.get("intent") != "fallback" and actions is not None
    speech_incomplete = bool(passed and actions and not all(
        re.search(pattern, text(result.get("ai_reply_text"), 500))
        for pattern in (r"灯", r"空调|温度", r"音量|声音|静音")))
    if speech_incomplete:
        passed = False
    result.update(intent="event" if passed else "fallback", reply_mode="chat_only", covered_fact_keys=[],
                  is_correct=False, answer=None, passenger_action=None,
                  game_status=obj(current.get("game")).get("status"),
                  execution={"kind": "plan", "actions": actions if passed else [], "timing": {"owner": "frontend"}},
                  ui_change={"show_answer": False, "animation": "speak", "host_emotion": "normal"})
    if not passed:
        result["ai_reply_text"] = ""
    if obj(context.get("sleep_comfort")).get("decision_only") is True and not (passed and actions):
        result["ai_reply_text"] = ""
    result["decision_trace"].update(priority=obj(current.get("event")).get("priority", "P3"),
                                    matched_rule="situation_event_dialogue", guard_status="passed" if passed else "event_reply_skipped")
    if actions is None:
        result["decision_trace"]["guard_reason_codes"] = ["sleep_comfort_action_not_authorized"]
    elif speech_incomplete:
        result["decision_trace"]["guard_reason_codes"] = ["sleep_comfort_speech_incomplete"]
    elif passed and actions:
        result["decision_trace"]["decision"] += "；主持人决定启用目标座位的睡眠关怀，等待话术开始显示后执行"
        result["decision_trace"]["action_authorization"] = "host_sleep_comfort_decision"
    return {"workflow_output": encode(result)}
