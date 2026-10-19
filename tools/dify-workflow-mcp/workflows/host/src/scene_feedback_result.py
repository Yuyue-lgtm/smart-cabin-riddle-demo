_experience_scene_result = main


def main(director_text: str, payload: str, director_context: str) -> dict:
    result = parse(_experience_scene_result(director_text, payload, director_context)["scene_output"])
    current = parse(payload)
    if obj(current.get("event")).get("type") == "post_result_feedback":
        result["feedback_id"] = feedback_snapshot(current)["id"]
        response = obj(result.get("host_response"))
        speaking = (valid_result_feedback(current) and result.get("request_proactive_speech") is True
                    and obj(response.get("decision_trace")).get("guard_status") == "passed"
                    and response.get("strategy") == "encourage" and not response.get("target_seat")
                    and not items(obj(response.get("execution")).get("actions")))
        result.update(request_proactive_speech=bool(speaking), usable_for_dialogue=False, dialogue_context={})
        result["expires_at_ms"] = result["generated_at_ms"] + 12000
        if not speaking:
            result["host_response"] = None
        else:
            response["priority"] = "P4"
            response["covered_fact_keys"] = []
            response["decision_trace"]["priority"] = "P4"
    return {"scene_output": encode(result)}
