def main(payload: str) -> dict:
    return {"scene_output": encode(scene_envelope(parse(payload), status="skipped"))}
