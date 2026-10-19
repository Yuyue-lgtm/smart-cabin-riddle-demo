_cabin_policy_input = main


def main(query: str, snapshot: str, situation: str) -> dict:
    result = _cabin_policy_input(query, snapshot, situation)
    current, context = parse(result["payload"]), parse(result["context_json"])
    current["game"]["pause_reason"] = text(obj(parse(snapshot).get("game")).get("pause_reason"), 30)
    public = [text(line, 160) for line in items(obj(parse(snapshot).get("game")).get("public_clues"))
              if isinstance(line, str) and text(line, 160)]
    current["game"]["public_clues"] = public[-12:]
    context["hard_constraints"] = [rule for rule in items(context.get("hard_constraints")) if rule != "不透露答案或额外提示"]
    context["public_clues"] = public[-12:]
    context["capabilities"] = {"allowed": ["music.set_enabled", "cabin.set_zone_light", "game.set_paused"],
        "game_pause_reason": current["game"]["pause_reason"],
        "sleep_event_only": ["cabin.apply_sleep_comfort", "cabin.restore_sleep_comfort"],
        "unsupported": ["theme_change", "arrival_time", "climate_control", "zone_volume_control"],
        "speaker_seat": selected_seat(current)}
    context["hard_constraints"].append("求助只重述public_clues，不新增属性；允许明确暂停/继续游戏game.set_paused，但只恢复pause_reason=user的主动暂停，不解除安全暂停，不重置题目或次数；车控只允许明确音乐开关或明确座位灯光，目标不明先澄清。其他任务婉拒且保留进度。主驾困倦或分心交车辆安全策略，不靠游戏提神，不邀请主驾。")
    result.update(payload=encode(current), context_json=encode(context))
    return result
