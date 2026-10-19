def main(context_json: str) -> dict:
    scene = parse(context_json)
    field = {"environment_change": "environment", "speed_overspeed": "speed", "driver_tired": "driver", "driver_distracted": "driver"}.get(scene.get("event_type"))
    scene["analysis_plan"] = {"share_context": True, "selected_fields": [field] if field else [],
                              "proactive_speech": bool(field), "analysis_valid": bool(field)}
    scene["priority_fast_path"] = True
    scene["knowhow"] = {"status": "not_relevant", "retrieved": [], "eligible_target_seats": []}
    return {"director_context": encode(scene)}
