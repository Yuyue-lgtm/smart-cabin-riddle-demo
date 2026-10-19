import time


P0_EVENTS = {"hard_brake", "safety_pause", "temporary_interruption", "timeout", "round_timeout", "game_end", "answer_correct"}
SCENE_EVENTS = {"environment_change", "speed_overspeed", "driver_tired", "passenger_sleep",
                "passenger_wake", "near_destination", "game_stuck", "near_answer",
                "cabin_laughing", "resume_game", "round_changed", "passenger_inactive", "driver_distracted"}
PROACTIVE_EVENTS = {"environment_change", "speed_overspeed", "driver_tired", "passenger_inactive"}
SHARE_FIELDS = {"environment", "speed", "driver", "passengers", "progress", "destination", "participation"}
AWAKE_STATES = {"awake", "normal", "active", "happy", "excited", "calm", "清醒", "正常", "普通", "开心", "兴奋", "平静", "大笑", "沉默"}
SEATS = ("front", "rearLeft", "rearRight")


def model_json(value):
    raw = text(value, 50000)
    raw = re.sub(r"<think\b[^>]*>.*?</think\s*>", "", raw, flags=re.I | re.S).strip()
    if re.search(r"<think\b", raw, re.I):
        return {}
    raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.I).strip()
    decoder = json.JSONDecoder()
    for match in re.finditer(r"\{", raw):
        try:
            value, end = decoder.raw_decode(raw[match.start():])
            if isinstance(value, dict) and not raw[match.start() + end:].strip():
                return value
        except ValueError:
            continue
    return {}


def canonical_states(snapshot):
    passengers = obj(snapshot.get("passengers"))
    raw = obj(passengers.get("states")) or passengers
    result = {}
    for key, alias in (("driver", "driver"), ("front", "front"), ("rearLeft", "rear_left"), ("rearRight", "rear_right")):
        value = raw.get(key, raw.get(alias))
        if key == "driver" and value is None:
            value = snapshot.get("driver")
        if isinstance(value, dict):
            value = value.get("state") or value.get("mood")
        result[key] = text(value, 30) or "unknown"
    return result


def eligible_seats(snapshot, speaker=None):
    states = canonical_states(snapshot)
    return [seat for seat in SEATS if seat != speaker and states[seat] in AWAKE_STATES]


def scope(snapshot):
    game = obj(snapshot.get("game"))
    return {"game_id": text(snapshot.get("game_id") or game.get("game_id"), 100),
            "round_id": text(snapshot.get("round_id") or game.get("round_id"), 100),
            "scene_version": text(str(snapshot.get("scene_version", "")), 100)}


def participation_snapshot(snapshot):
    raw = obj(snapshot.get("participation"))
    if not raw:
        return {}
    result = {"seat": "front" if raw.get("seat") == "front" else "unknown",
              "invitation_declined": raw.get("invitation_declined") is True}
    for key in ("version", "inactive_duration_ms", "dialogue_silence_ms", "remaining_ms", "real_user_turn_count"):
        value = raw.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool) and 0 <= value <= 3600000:
            result[key] = int(value)
    return result


def valid_participation_candidate(snapshot):
    event = obj(snapshot.get("event"))
    state = participation_snapshot(snapshot)
    return (event.get("source") == "participation_monitor" and event.get("seat") == "front"
            and state.get("seat") == "front" and "version" in state
            and state.get("inactive_duration_ms", 0) >= 20000
            and state.get("dialogue_silence_ms", 0) >= 2500
            and state.get("remaining_ms", 0) > 15000 and not state["invitation_declined"]
            and canonical_states(snapshot)["front"] in AWAKE_STATES
            and obj(snapshot.get("game")).get("status") == "playing")


def shareable_snapshot(snapshot):
    car, game = obj(snapshot.get("car")), obj(snapshot.get("game"))
    return {
        "environment": text(car.get("environment"), 100),
        "speed": car.get("speed") if isinstance(car.get("speed"), (int, float)) else None,
        "destination": text(car.get("destination"), 100),
        "driver": canonical_states(snapshot)["driver"],
        "passengers": canonical_states(snapshot),
        "participation": participation_snapshot(snapshot),
        "progress": {key: game.get(key) for key in ("status", "round_index", "total_rounds", "question_count", "max_questions")},
    }


def clean_snapshot(raw):
    source = parse(raw)
    game = obj(source.get("game"))
    # No frontend transcript or player text is allowed to become a second memory.
    result = {key: source[key] for key in ("game_id", "round_id", "scene_version", "car", "driver", "passengers", "event", "participation") if key in source}
    result["game"] = {key: game[key] for key in (
        "status", "current_answer", "current_theme", "round_index", "total_rounds", "question_count",
        "max_questions", "covered_fact_keys", "asked_questions", "round_question_plan", "game_id", "round_id",
    ) if key in game}
    result["game"]["asked_questions"] = items(game.get("asked_questions"))[-8:]
    result["game"]["covered_fact_keys"] = items(game.get("covered_fact_keys"))[-24:]
    result["passengers"] = {"states": canonical_states(source), "selected_seat": selected_seat(source)}
    result["participation"] = participation_snapshot(source)
    return result


def empty_knowhow(snapshot, status="not_relevant", speaker=None):
    return {"status": status, "retrieved": [], "eligible_target_seats": eligible_seats(snapshot, speaker)}


def valid_situation(raw, snapshot):
    cached = parse(raw)
    expected = scope(snapshot)
    now = int(time.time() * 1000)
    if not all(expected.values()) or any(cached.get(key) != value for key, value in expected.items()):
        return {}, "scope_mismatch"
    if cached.get("analysis_status") != "ready" or cached.get("usable_for_dialogue") is not True:
        return {}, "not_ready"
    try:
        generated, expires = int(cached["generated_at_ms"]), int(cached["expires_at_ms"])
        if not (generated <= now + 2000 and now < expires <= generated + 60000):
            return {}, "expired"
    except (KeyError, TypeError, ValueError):
        return {}, "invalid_expiry"
    return obj(cached.get("dialogue_context")), "valid"


def scene_envelope(snapshot, context=None, response=None, status="ready", speak=False, usable=False):
    now = int(time.time() * 1000)
    return {"schema_version": 1, "route": "situation", **scope(snapshot),
            "event_id": text(obj(snapshot.get("event")).get("id"), 100),
            "generated_at_ms": now, "expires_at_ms": now + 60000,
            "analysis_status": status, "usable_for_dialogue": usable,
            "dialogue_context": context or {}, "request_proactive_speech": speak,
            "host_response": response}


def valid_environment_change(snapshot):
    event, car = obj(snapshot.get("event")), obj(snapshot.get("car"))
    current, previous = text(car.get("environment"), 100), text(event.get("previous_value"), 100)
    return (event.get("type") == "environment_change" and bool(current) and bool(previous)
            and event.get("value") == current and previous != current
            and obj(snapshot.get("game")).get("status") in {"opening", "playing"})


def environment_rule_response(snapshot, fallback=False):
    environment = text(obj(snapshot.get("car")).get("environment"), 100)
    labels = {"高速路晴天白天": "驶上高速", "高速路晴天深夜": "驶上夜间的高速",
              "高速路雨天白天": "驶上雨中的高速", "城区晴天白天": "来到市区",
              "城区夜晚": "来到夜晚的市区", "城区雨天白天": "来到雨中的市区",
              "车库": "进入车库", "隧道": "进入隧道", "风景区晴天白天": "来到风景区",
              "风景区傍晚": "来到傍晚的风景区", "风景区雪景白天": "来到雪中的风景区",
              "风景区晴天深夜": "来到夜间的风景区"}
    line = "我们{}啦。".format(labels[environment]) if environment in labels else "车外环境变化啦，我们继续。"
    answer = text(obj(snapshot.get("game")).get("current_answer"), 100)
    if answer and answer in line:
        line = "我们继续。"
    result = envelope(snapshot, line, "P1", layer="fallback" if fallback else "rule",
                      rule="environment_announcement", decision="环境变化优先播报；话术由前端排队执行")
    result.update(intent="event", reply_mode="chat_only", strategy="soft_response", target_seat=None,
                  covered_fact_keys=[], applied_knowhow_ids=[], retrieved_knowhow=[], knowhow_status="not_relevant",
                  reason_codes=["environment_change"])
    result["execution"]["actions"] = []
    return result
