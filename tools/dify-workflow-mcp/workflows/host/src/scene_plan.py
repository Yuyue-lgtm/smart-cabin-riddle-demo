def main(analysis_text: str, context_json: str) -> dict:
    scene = parse(context_json)
    value = model_json(analysis_text)
    valid = isinstance(value.get("needs_knowhow"), bool) and isinstance(value.get("share_context"), bool)
    fields = [key for key in items(value.get("selected_fields")) if isinstance(key, str) and key in SHARE_FIELDS]
    fields = list(dict.fromkeys(fields))
    share = valid and value.get("share_context") is True and bool(fields)
    need = valid and value.get("needs_knowhow") is True
    allowed = scene.get("proactive_allowed") is True
    scene["analysis_plan"] = {
        "share_context": share, "selected_fields": fields if share else [],
        "proactive_speech": valid and allowed and value.get("proactive_speech") is True,
        "analysis_valid": valid,
    }
    # Retrieval uses only trusted current observations, never the model's free text.
    scene["knowhow"] = {"status": "not_relevant" if valid else "failed", "retrieved": [],
                        "eligible_target_seats": items(scene.get("eligible_collaborators"))}
    kind = scene.get("event_type", "")
    event_topics = {
        "environment_change": ("环境变化何时回应、何时不打断", ["environment"]),
        "passenger_sleep": ("乘员睡着时轻柔关怀，不邀请睡眠乘员", ["passengers"]),
        "passenger_wake": ("乘员醒来后互动恢复", ["passengers"]),
        "passenger_inactive": ("HK28 主动邀请经验：系统确认真实副驾持续未参与时，是否适合低压力邀请；尊重独立思考、拒绝邀请与当前对话，不打断问答", ["HK28", "副驾未参与", "主动邀请", "participation"]),
        "driver_tired": ("主驾疲惫或睡着的关怀，不分散驾驶注意力", ["driver"]),
        "speed_overspeed": ("车速超限，简短关怀驾驶安全", ["speed"]),
        "near_destination": ("临近目的地如何自然收尾", ["destination", "progress"]),
        "game_stuck": ("玩家卡壳与连续猜错，鼓励而不提供额外提示", ["progress", "passengers"]),
        "resume_game": ("游戏被打断后的恢复", ["progress"]),
    }
    topic, relevant = event_topics.get(kind, (kind, ["progress"]))
    facts = {key: obj(scene.get("snapshot")).get(key) for key in relevant}
    query = "主持经验：{}；当前状态：{}；不得泄露答案或推进暂停中的游戏。".format(topic, encode(facts))
    return {"needs_knowhow": bool(need), "knowhow_query": query if need else "",
            "director_context": encode(scene),
            "eligible_target_seats": encode(items(scene.get("eligible_collaborators")))}
