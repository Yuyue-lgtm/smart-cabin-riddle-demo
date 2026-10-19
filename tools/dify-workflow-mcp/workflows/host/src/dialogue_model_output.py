import json
import re


def output_object(value):
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except ValueError:
            pass
    return {}


def output_schema_errors(value, schema, path="output"):
    kinds = {"object": dict, "array": list, "string": str, "null": type(None), "boolean": bool}
    expected = schema.get("type", [])
    expected = [expected] if isinstance(expected, str) else expected
    if expected and not any(isinstance(value, kinds[kind]) for kind in expected):
        return [path + ":invalid_type"]
    if "enum" in schema and value not in schema["enum"]:
        return [path + ":invalid_enum"]
    errors = []
    if isinstance(value, dict):
        fields = schema.get("properties", {})
        errors += [path + "." + name + ":missing" for name in schema.get("required", []) if name not in value]
        if schema.get("additionalProperties") is False:
            errors += [path + "." + name + ":unknown" for name in value if name not in fields]
        for name, field in fields.items():
            if name in value:
                errors += output_schema_errors(value[name], field, path + "." + name)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            errors += output_schema_errors(item, schema.get("items", {}), path + "[" + str(index) + "]")
    return errors[:20]


def inspect_dialogue_output(director_text, director_structured, payload="", director_context=""):
    structured = output_object(director_structured)
    raw = director_text if isinstance(director_text, str) else ""
    final = re.sub(r"<think\b[^>]*>.*?</think\s*>", "", raw, flags=re.I | re.S).strip()
    if re.search(r"<think\b", final, re.I):
        final = ""
    final = re.sub(r"^```(?:json)?\s*|\s*```$", "", final, flags=re.I).strip()
    parsed_text = output_object(final)
    reasons = []
    for source, value in (("structured_output", structured), ("text", parsed_text)):
        if not value:
            continue
        errors = output_schema_errors(value, json.loads(DIALOGUE_OUTPUT_SCHEMA))
        reply = value.get("ai_reply_text")
        if not isinstance(reply, str) or not reply.strip():
            errors.append("missing_model_reply")
        elif len(reply.strip()) > 60 or re.search(r"</?think\b", reply, re.I):
            errors.append("invalid_model_reply")
        preflight = globals().get("_preflight_dialogue_guard")
        if not errors and payload and director_context and callable(preflight):
            guarded = output_object(preflight(json.dumps(value, ensure_ascii=False), payload, director_context).get("workflow_output"))
            trace = guarded.get("decision_trace") or {}
            if trace.get("guard_status") not in ("passed", "hint_blocked"):
                debug = guarded.get("debug") or {}
                codes = debug.get("validation_errors", []) + debug.get("fallback_reason_codes", []) + trace.get("guard_reason_codes", [])
                errors += ["content_guard:" + str(code) for code in codes[:12]] or ["content_guard:reply_rejected"]
        if not errors:
            return value, {"source": source, "status": "valid", "reason_codes": reasons}
        reasons += [source + ":" + error for error in errors]
    if not final and re.search(r"<think\b", raw, re.I):
        reasons.append("think_only_output")
    elif not structured and (not final or final == "{}"):
        reasons.append("empty_model_output")
    elif not parsed_text and final:
        reasons.append("invalid_model_json")
    if not reasons:
        reasons.append("invalid_model_json")
    return {}, {"source": "none", "status": "invalid", "reason_codes": list(dict.fromkeys(reasons))}


def normalize_dialogue_output(director_text, director_structured, previous_result=None, payload="", director_context=""):
    value, attempt = inspect_dialogue_output(director_text, director_structured, payload, director_context)
    previous = output_object(previous_result)
    attempts = previous.get("attempts", [])
    attempts = attempts[:1] if isinstance(attempts, list) else []
    attempt["attempt"] = len(attempts) + 1
    attempts = attempts + [attempt]
    result = {"canonical_text": json.dumps(value, ensure_ascii=False), "attempts": attempts,
              "status": "valid" if value else "retry_exhausted" if previous else "retry_needed"}
    return json.dumps(result, ensure_ascii=False, separators=(",", ":")), not bool(value)


def main(director_text: str, director_structured: dict = None, payload: str = "", director_context: str = "") -> dict:
    result, retry = normalize_dialogue_output(director_text, director_structured, payload=payload, director_context=director_context)
    return {"model_result": result, "needs_retry": retry}
