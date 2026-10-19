def main(director_text: str, previous_result: str, director_structured: dict = None, payload: str = "", director_context: str = "") -> dict:
    result, _ = normalize_dialogue_output(director_text, director_structured, previous_result, payload, director_context)
    return {"model_result": result}
