_normalize_original = main


def valid_environment_change(snapshot):
    event, car = obj(snapshot.get("event")), obj(snapshot.get("car"))
    current, previous = text(car.get("environment"), 100), text(event.get("previous_value"), 100)
    return (event.get("type") == "environment_change" and bool(current) and bool(previous)
            and event.get("value") == current and previous != current
            and obj(snapshot.get("game")).get("status") in {"opening", "playing"})


def main(snapshot: str) -> dict:
    current = clean_snapshot(snapshot)
    current["trigger_type"] = "event"
    current["player_input"] = ""
    event = obj(current.get("event"))
    kind = text(event.get("type"), 80)
    event["priority"] = "P0" if kind in P0_EVENTS else "P1" if kind in {"environment_change", "speed_overspeed", "driver_tired", "driver_distracted"} else "P2" if kind in {"passenger_sleep", "near_destination"} else "P4" if kind in {"passenger_inactive", "cabin_laughing"} else "P3"
    current["event"] = event
    normalized = _normalize_original(encode(current), "{}")
    normalized["is_p0"] = normalized["is_p0"] or kind in P0_EVENTS
    valid = kind in SCENE_EVENTS and all(scope(current).values()) and bool(text(event.get("id")))
    if kind == "driver_tired":
        duration = event.get("duration_ms")
        state = text(event.get("state"), 30)
        valid = valid and isinstance(duration, (int, float)) and duration > 15000 and state in {"fatigued", "asleep", "疲惫", "睡着"}
    if kind == "speed_overspeed":
        before, after = event.get("previous_value"), event.get("value")
        valid = valid and isinstance(before, (int, float)) and isinstance(after, (int, float)) and before <= 120 < after
    if kind == "passenger_inactive":
        valid = valid and valid_participation_candidate(current)
    if kind == "environment_change":
        valid = valid and valid_environment_change(current)
    if obj(current.get("game")).get("status") == "paused":
        valid = False
    scene = {"event_type": kind, "snapshot": shareable_snapshot(current),
             "eligible_collaborators": ["front"] if kind == "passenger_inactive" and valid else eligible_seats(current),
             "proactive_allowed": valid and kind in SCENE_EVENTS and kind not in {"round_changed", "resume_game"},
             "active_constraints": ["睡眠和未知状态乘员不可邀请，主驾不可邀请", "暂停时不得推进游戏", "不得提供谜底或额外提示", "动作执行和抢占只由前端负责"]}
    # Do not expose arbitrary event.value or hidden game facts to the analyst/RAG.
    normalized["context_json"] = encode(scene)
    normalized["can_analyze"] = bool(valid and not normalized["is_p0"])
    normalized["priority_fast_path"] = bool(valid and event["priority"] == "P1" and not normalized["is_p0"])
    return normalized
