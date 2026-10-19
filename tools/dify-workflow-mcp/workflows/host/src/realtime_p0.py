def main(payload: object, exact_correct: bool, event_type: str) -> dict:
    payload = parse(payload)
    game = obj(payload.get("game"))
    answer = text(game.get("current_answer"), 100)
    seat = selected_seat(payload)
    label = {"driver": "主驾", "front": "副驾", "rearLeft": "后排左", "rearRight": "后排右"}[seat]
    if event_type in ("hard_brake", "safety_pause"):
        result = envelope(payload, "大家坐稳，游戏先暂停，主驾专心看路。", "P0", "paused", mode="safety_pause", animation="pause", emotion="serious", seat="all", layer="rule", rule="hard_brake_safety", decision="安全优先，立即暂停游戏")
    elif event_type == "game_end" or game.get("status") == "finished":
        result = envelope(payload, "这一局结束啦，谢谢大家一起找线索！", "P0", "finished", mode="summary", animation="summary", seat="all", layer="rule", rule="game_end", decision="结束本局并进入结算")
    elif event_type in ("timeout", "round_timeout") or game.get("status") == "failed":
        result = envelope(payload, f"时间到了，谜底是“{answer}”。我们接着挑战下一题。", "P0", "failed", mode="reveal", animation="reveal", reveal=True, seat="all", layer="rule", rule="timeout_reveal", decision="超时后揭晓谜底")
    else:
        actions = [{
            "type": "ambient_light.play_preset", "preset": "cabin-correct-light",
            "label": "答对氛围灯预设", "trigger": "answer_correct",
            "execution_owner": "frontend_correctness",
        }]
        result = envelope(payload, f"{label}答对了，谜底就是“{answer}”！", "P0", "victory", correct=True, mode="victory", animation="victory", emotion="excited", reveal=True, layer="rule", rule="correct_answer_reveal", decision="答对后揭晓并触发庆祝计划", actions=actions)
    result["intent"] = "p0_event"
    return {"workflow_output": encode(result)}
