_experience_scene_input = main


def main(snapshot: str) -> dict:
    result = _experience_scene_input(snapshot)
    current = clean_snapshot(snapshot)
    feedback_event = obj(current.get("event")).get("type") == "post_result_feedback"
    result["feedback_fast_path"] = False
    if feedback_event:
        valid = valid_result_feedback(current) and all(scope(current).values()) and bool(text(obj(current.get("event")).get("id")))
        current["event"]["priority"] = "P4"
        result.update(payload=encode(current), is_p0=False, can_analyze=bool(valid),
                      feedback_fast_path=bool(valid), priority="P4")
        context = {"event_type": "post_result_feedback", "snapshot": shareable_snapshot(current),
                   "eligible_collaborators": [], "proactive_allowed": bool(valid),
                   "active_constraints": ["只认可可信统计中的表现", "P0完成后才由前端决定播出", "不改变游戏或车辆状态"]}
        result["context_json"] = encode(context)
    return result
