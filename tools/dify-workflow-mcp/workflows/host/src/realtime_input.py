def answer_candidate_kind(utterance, answer):
    normalize = lambda value: re.sub(r"[\s，。！？、,.!?:：\"'“”‘’（）()【】\[\]-]", "", value.lower())
    guess, expected = normalize(utterance), normalize(answer)
    if not expected or expected not in guess:
        return "none"
    prefixes = ("", "是", "就是", "是不是", "是否是", "会是", "会不会是", "难道是", "莫非是", "应该是", "可能是",
                "我猜", "我猜是", "我觉得是", "我认为是", "我选", "我确定是", "答案是", "答案就是", "答案应该是",
                "谜底是", "谜底就是", "我猜答案是", "我猜谜底是", "我觉得可能是", "我觉得应该是", "我的答案是",
                "那是", "那是不是", "那我猜是")
    suffixes = ("", "吗", "嘛", "么", "吧", "呢", "啦", "对吗", "对不对", "是不是", "没错吧")
    if any(guess == prefix + expected + suffix for prefix in prefixes for suffix in suffixes):
        return "confirmed"
    if re.search(r"不是|不可能|不会是|不能是|不选|别选|排除|不像", guess):
        return "negated"
    return "uncertain"


def main(input_payload: str, cabin_snapshot: str) -> dict:
    payload = parse(input_payload)
    game, event = obj(payload.get("game")), obj(payload.get("event"))
    trigger = text(payload.get("trigger_type"), 30) or "event"
    event_type = text(event.get("type"), 80)
    priority = text(event.get("priority"), 2)
    if priority not in ("P0", "P1", "P2", "P3", "P4"):
        priority = "P2"
    answer = text(game.get("current_answer"), 100)
    utterance = text(payload.get("player_input"), 800)
    music_request = trigger == "chat" and bool(re.search(
        r"(?:打开|开启|播放|放|启动|关掉|关闭|停止|暂停|静音).{0,8}(?:背景音乐|音乐)|(?:背景音乐|音乐).{0,8}(?:打开|开启|播放|关掉|关闭|停止|暂停|静音)",
        utterance,
    ))
    candidate = answer_candidate_kind(utterance, answer) if trigger == "chat" and game.get("status") == "playing" else "none"
    # Recompute from the current answer; caller-supplied confirmation is not trusted.
    payload["answer_candidate"] = {"matched": candidate != "none", "confirmation": candidate}
    exact = candidate == "confirmed"
    p0_event = event_type in ("hard_brake", "safety_pause", "timeout", "round_timeout", "game_end")
    ended_game = trigger != "chat" and game.get("status") in ("victory", "failed", "finished") and not music_request
    p0 = p0_event or candidate != "none" or ended_game
    interaction = obj(payload.get("interaction"))
    recent = [{k: text(message.get(k), 180) for k in ("role", "speaker", "seat", "text", "content") if text(message.get(k), 180)}
              for message in items(interaction.get("recent_messages"))[-8:] if isinstance(message, dict)]
    snapshot = parse(cabin_snapshot)
    context = {
        "trigger_type": trigger, "event": event, "player_input": utterance,
        "game": {k: game.get(k) for k in ("status", "current_answer", "current_theme", "round_index", "question_count", "max_questions", "covered_fact_keys")},
        "asked_questions": items(game.get("asked_questions"))[-8:], "recent_messages": recent,
        "fact_catalog": fact_catalog(payload), "car": obj(payload.get("car")),
        "perception": obj(payload.get("perception")), "cabin_snapshot": snapshot,
        "speaker_seat": selected_seat(payload),
        "speaker_persona": obj(interaction.get("current_speaker_persona") or obj(payload.get("passengers")).get("selected_persona"))
    }
    return {
        # Keep nested player payload serialized between Dify Code nodes. Dify
        # limits structured values to five levels; game plans can exceed that.
        "payload": encode(payload), "context_json": encode(context), "exact_correct": exact,
        "is_p0": p0, "event_type": event_type, "priority": priority,
        "perception": perception_snapshot(payload),
    }
