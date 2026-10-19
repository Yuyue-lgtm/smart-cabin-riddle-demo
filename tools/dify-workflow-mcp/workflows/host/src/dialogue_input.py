_normalize_original = main


def main(query: str, snapshot: str, situation: str) -> dict:
    current = clean_snapshot(snapshot)
    current["trigger_type"] = "chat"
    current["player_input"] = text(query, 800)
    # Events are handled by the independent workflow, never replayed on a chat turn.
    current["event"] = {"priority": "P2"}
    normalized = _normalize_original(encode(current), "{}")
    context = parse(normalized["context_json"])
    for key in ("recent_messages", "cabin_snapshot", "event", "car", "perception", "player_input"):
        context.pop(key, None)
    context["passenger_states"] = canonical_states(current)
    boundary = obj(parse(snapshot).get("round_context"))
    current_scope = scope(current)
    previous_game = text(boundary.get("previous_game_id"), 100)
    previous_round = text(boundary.get("previous_round_id"), 100)
    transition = ("new_game" if previous_game and previous_game != current_scope["game_id"] else
                  "new_round" if previous_round and previous_round != current_scope["round_id"] else
                  "continue_round" if previous_round == current_scope["round_id"] and previous_round else
                  "conversation_resume")
    context["round_context"] = {
        **current_scope, "transition": transition,
        "previous_game_id": previous_game, "previous_round_id": previous_round,
        "current_snapshot_is_authoritative": True,
        "notice": "上一题已结束，当前题快照优先。" if transition in ("new_game", "new_round") else
                  "当前题快照优先，历史中的旧题谜底和状态不适用于当前题。",
    }
    context["knowhow"] = empty_knowhow(current, speaker=selected_seat(current))
    context["hard_constraints"] = ["当前状态覆盖历史；暂停时不推进游戏", "旧题已揭晓不代表当前题结束；普通问答只依据当前game和fact_catalog", "不透露答案或额外提示", "只邀请清醒非主驾乘员"]
    cached, cache_status = valid_situation(situation, current)
    # Reconstruct selected facts from today's input instead of replaying stale values.
    fields = obj(cached.get("selected_snapshot"))
    if fields:
        public = shareable_snapshot(current)
        context["selected_snapshot"] = {key: public[key] for key in fields if key in SHARE_FIELDS}
        context["situation_guidance"] = obj(cached.get("guidance"))
        references = obj(cached.get("knowhow"))
        context["knowhow"] = {**references, "eligible_target_seats": eligible_seats(current, selected_seat(current))}
    context["situation_status"] = cache_status
    normalized["context_json"] = encode(context)
    return normalized
