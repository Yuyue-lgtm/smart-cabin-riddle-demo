def main(workflow_output: str, payload: str) -> dict:
    result = parse(workflow_output)
    current = parse(payload)
    result["context_scope"] = {key: text(current.get(key), 100) for key in ("game_id", "round_id", "scene_version")}
    if not obj(result.get("ui_change")).get("show_answer"):
        result["answer"] = None
    return {"reply_text": text(result.get("ai_reply_text"), 500), "host_result": encode(result)}
