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
    normalize = lambda s: re.sub(r"[\s，。！？,.!?]", "", s.lower())
    guess, expected = normalize(utterance), normalize(answer)
    exact = bool(expected and trigger == "chat" and game.get("status") == "playing" and guess in
                 (expected, "答案是" + expected, "我猜" + expected, "我猜是" + expected, "是" + expected))
    p0_event = event_type in ("hard_brake", "safety_pause", "timeout", "round_timeout", "game_end")
    ended_game = trigger != "chat" and game.get("status") in ("victory", "failed", "finished") and not music_request
    p0 = p0_event or exact or ended_game
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
