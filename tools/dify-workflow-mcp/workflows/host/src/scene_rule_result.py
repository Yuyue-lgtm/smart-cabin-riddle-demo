def main(payload: str, workflow_output: str) -> dict:
    current, response = parse(payload), parse(workflow_output)
    result = scene_envelope(current, status="rule", speak=False)
    result.update(perception=response.get("perception"), decision_trace=response.get("decision_trace"),
                  execution={"kind": "observation", "actions": [], "timing": {"owner": "frontend"}})
    return {"scene_output": encode(result)}
