def main(context_json: str) -> dict:
    scene = parse(context_json)
    scene["environment_fast_path"] = True
    scene["analysis_plan"] = {"share_context": True, "selected_fields": ["environment"],
                              "proactive_speech": True, "analysis_valid": True}
    scene["knowhow"] = {"status": "not_relevant", "retrieved": [], "eligible_target_seats": []}
    return {"director_context": encode(scene)}
