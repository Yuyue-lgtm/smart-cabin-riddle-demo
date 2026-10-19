_dialogue_base_guard_main = main


def main(director_text: str, payload: str, director_context: str, model_result: str = "") -> dict:
    model = parse(model_result)
    if model:
        director_text = text(model.get("canonical_text"), 50000)
    result = parse(_dialogue_base_guard_main(director_text, payload, director_context)["workflow_output"])
    current = parse(payload)
    if model:
        attempts = items(model.get("attempts"))[:2]
        result["debug"] = {**obj(result.get("debug")), "model_output_status": model.get("status"),
                           "model_attempts": attempts, "model_retry_count": max(0, len(attempts) - 1)}
        if model.get("status") == "retry_exhausted":
            reasons = list(dict.fromkeys(reason for attempt in attempts
                for reason in items(obj(attempt).get("reason_codes"))))
            result["debug"]["model_failure_reason_codes"] = reasons
            result["debug"]["fallback_reason_codes"] = list(dict.fromkeys(
                items(result["debug"].get("fallback_reason_codes")) + ["model_retry_exhausted"] + reasons))
            if obj(result.get("decision_trace")).get("hint_blocked"):
                result["ai_reply_text"] = "我先不额外给提示哦，可以继续问我一个是或否问题。"
                result.update(intent="game_related_chat", reply_mode="chat_then_bridge", covered_fact_keys=[])
            elif obj(current.get("game")).get("status") != "paused":
                lines = ["刚才没接上你的问题，能再说一次吗？", "这句我还没听明白，换个问法再问一次好吗？", "刚才没能回答上来，你可以再问我一次。"]
                seed = text(obj(current.get("event")).get("id"), 200) or text(current.get("player_input"), 800)
                answer = text(obj(current.get("game")).get("current_answer"), 100)
                choices = lines + ["刚才没接上，请再问一次。", "抱歉。", "嗯。"]
                start = sum(ord(char) for char in seed) % len(lines)
                choices = choices[start:] + choices[:start]
                result["ai_reply_text"] = next((line for line in choices if not answer or answer not in line), "")
                result.update(intent="fallback", reply_mode="answer_only", covered_fact_keys=[], passenger_action=None,
                              strategy="soft_response", target_seat=None, applied_knowhow_ids=[])
            result["decision_trace"].update(guard_status="model_output_fallback", matched_rule="model_retry_exhausted",
                decision="模型输出无效，重试一次后仍失败；采用不增加事实的回应",
                guard_reason_codes=result["debug"]["fallback_reason_codes"])
    return {"workflow_output": encode(result)}
