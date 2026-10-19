def main(director_text: str, payload: object) -> dict:
    payload = parse(payload)
    value = model_json(director_text)
    event_data = obj(payload.get("event"))
    event = text(event_data.get("type"), 80)
    utterance = text(payload.get("player_input"), 800)
    priority = text(event_data.get("priority"), 2)
    if priority not in ("P0", "P1", "P2", "P3", "P4"):
        priority = "P2"

    answer = text(obj(payload.get("game")).get("current_answer"), 100)
    line = text(value.get("ai_reply_text"), 1000)
    hint_request = bool(re.search(
        r"(?:给我|给|来点|来|提供|透露|告诉我|帮我|想要|想听|能不能|能给|可不可以|可以|请|求|再给|继续给).{0,8}(?:提示|线索|暗示)|(?:提示|线索|暗示)(?:一下|一点|给我|吧|呢|吗|可以吗|行吗)|提示下|给点(?:提示|线索)",
        utterance,
    ))
    blocked_hint_request = hint_request and payload.get("trigger_type") == "chat" and obj(payload.get("game")).get("status") == "playing"
    errors = []
    validation_reasons = []
    if not value:
        validation_reasons.append("invalid_or_empty_model_json")
    if not line:
        validation_reasons.append("missing_model_reply")
    elif len(line) > 60:
        validation_reasons.append("model_reply_too_long")
    elif answer and answer in line:
        validation_reasons.append("answer_leak_in_model_reply")
    if not line or len(line) > 60 or (answer and answer in line):
        errors.append("missing_long_or_answer_leaking_reply")
        line = "这个问题我还没判断清楚，能换个说法吗？"
    if blocked_hint_request:
        line = "我先不额外给提示哦，可以继续问我一个是或否问题。"

    actions = []
    music_enabled = parse_music_command(utterance) if payload.get("trigger_type") == "chat" else None
    if music_enabled is not None:
        actions.append({
            "type": "music.set_enabled", "enabled": music_enabled,
            "label": "开启背景音乐" if music_enabled else "关闭背景音乐",
            "execution_owner": "frontend",
        })

    result = envelope(
        payload, line, priority,
        rule=event or "realtime_director",
        decision="响应乘客并校验可执行动作",
        guard_status="hint_blocked" if blocked_hint_request else "fallback" if errors else "passed",
        hint_blocked=blocked_hint_request,
        actions=actions,
    )
    if event == "environment_change":
        result["ui_change"].update(cabin_mode="environment_sync", target_seat="all", animation="scene_change", host_emotion="observing")
    elif event in ("driver_tired", "speed_overspeed"):
        result["ui_change"].update(cabin_mode="driver_focus", target_seat="front", animation="cue", host_emotion="care")
    elif event == "passenger_sleep":
        result["ui_change"].update(cabin_mode="soft", animation="soft", host_emotion="care")
    elif event == "near_destination":
        result["ui_change"].update(cabin_mode="final_round", target_seat="all", animation="final", host_emotion="excited")

    intents = ("answer_question", "guess", "smalltalk", "game_related_chat", "repeat_question", "event", "fallback")
    result["intent"] = value.get("intent") if value.get("intent") in intents else "answer_question"
    modes = ("answer_only", "chat_only", "chat_then_bridge")
    result["reply_mode"] = value.get("reply_mode") if value.get("reply_mode") in modes else "answer_only"
    known = {entry["fact_key"] for entry in fact_catalog(payload)}
    covered = {key for key in items(obj(payload.get("game")).get("covered_fact_keys")) if isinstance(key, str)}
    if not errors and result["intent"] in ("answer_question", "guess", "repeat_question"):
        result["covered_fact_keys"] = list(dict.fromkeys(
            key for key in items(value.get("covered_fact_keys"))
            if isinstance(key, str) and key in known and key not in covered
        ))
    if blocked_hint_request:
        result["intent"] = "game_related_chat"
        result["reply_mode"] = "chat_then_bridge"
        result["covered_fact_keys"] = []
    if errors:
        result["intent"] = "fallback"
        result["debug"] = {"validation_errors": errors, "validation_reason_codes": validation_reasons}
    # Describe the branch actually selected, not an invented model reasoning trace.
    if blocked_hint_request:
        layer, rule, summary = "rule", "hint_request_blocked", "拒绝额外提示，邀请继续提问"
    elif errors:
        layer, rule, summary = "fallback", "invalid_model_reply", "回复未通过校验，请乘客换个说法"
    elif event and payload.get("trigger_type") != "chat":
        event_choices = {
            "environment_change": ("environment_response", "回应新的车外环境"),
            "speed_overspeed": ("overspeed_response", "提醒车速超限"),
            "driver_tired": ("driver_care_response", "提醒关注主驾状态"),
            "passenger_sleep": ("sleep_response", "回应乘客睡着事件"),
            "near_destination": ("arrival_response", "提示即将到达，准备收尾"),
        }
        rule, summary = event_choices.get(event, ("event_response", "按事件入口生成回应"))
        layer = "llm"
    else:
        summaries = {"answer_only": "回答本轮问题", "chat_only": "接续闲聊，暂不拉回游戏",
                     "chat_then_bridge": "接住话题，再引导回到游戏"}
        layer, rule, summary = "llm", "reply_mode_selected", summaries[result["reply_mode"]]
    result["decision_trace"].update(layer=layer, matched_rule=rule, strategy_id=rule, decision=summary,
                                    basis={"event_type": event, "intent": result["intent"], "reply_mode": result["reply_mode"]})
    result["decision_trace"]["selection_origin"] = "model_reply_mode" if rule == "reply_mode_selected" else "code_branch"
    if rule == "reply_mode_selected" and value.get("reply_mode") not in modes:
        result["decision_trace"].update(decision="未返回有效回应方式，采用默认回答",
                                         selection_origin="code_default", matched_rule="default_reply_mode")
    if actions:
        result["decision_trace"]["action_authorization"] = "explicit_music_command"
        result["decision_trace"]["decision"] += "；允许音乐开关请求"
    return {"workflow_output": encode(result)}


def parse_music_command(utterance: str):
    target = r"(?:背景音乐|音乐)"
    off = r"(?:关闭|关掉|停止|暂停|静音|不要放|别放|不放|不要播|别播|关)"
    on = r"(?:打开|开启|播放|启动|开一下|放一下|开)"

    # A negated control request is not authorization to change the current state.
    if re.search(r"(?:不要|别|先别).{0,4}(?:关闭|关掉|关|停止|暂停|打开|开启|启动).{0,6}" + target, utterance) or re.search(
        target + r".{0,4}(?:不要|别|先别).{0,4}(?:关闭|关掉|关|停止|暂停|打开|开启|启动)", utterance
    ):
        return None

    if re.search(off + r".{0,6}" + target, utterance) or re.search(target + r".{0,6}" + off, utterance):
        return False
    if re.search(on + r".{0,6}" + target, utterance) or re.search(target + r".{0,6}" + on, utterance):
        return True
    return None
