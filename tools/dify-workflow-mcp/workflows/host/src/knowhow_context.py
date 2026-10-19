import json
import re


KNOWN_KNOWHOW = {"HK{:02d}".format(index) for index in range(1, 29)}


def obj(value):
    return value if isinstance(value, dict) else {}


def items(value):
    return value if isinstance(value, list) else []


def text(value, limit=4000):
    return value.strip()[:limit] if isinstance(value, str) else ""


def parse(value):
    if isinstance(value, dict):
        return value
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, dict) else {}
    except (ValueError, TypeError):
        return {}


def content_record(chunk):
    raw = text(chunk.get("content") or chunk.get("segment_content"), 4000)
    record = {}
    try:
        decoded = json.loads(raw)
        if isinstance(decoded, dict):
            record = decoded
    except (ValueError, TypeError):
        pass
    knowhow_id = text(record.get("knowhow_id"), 20)
    if not knowhow_id:
        match = re.search(r'"knowhow_id"\s*:\s*"(HK\d{2})"', raw)
        knowhow_id = match.group(1) if match else ""
    title = text(record.get("title") or chunk.get("title") or obj(chunk.get("metadata")).get("title"), 120)
    return knowhow_id, title, raw


def make_context(context_json, chunks, status):
    context = parse(context_json)
    retrieved = []
    malformed = False
    for chunk in items(chunks)[:3]:
        if not isinstance(chunk, dict):
            malformed = True
            continue
        knowhow_id, title, content = content_record(chunk)
        if knowhow_id not in KNOWN_KNOWHOW or not content:
            malformed = True
            continue
        if all(row["knowhow_id"] != knowhow_id for row in retrieved):
            retrieved.append({"knowhow_id": knowhow_id, "title": title or knowhow_id, "content": content})

    if malformed:
        status = "failed"
        retrieved = []
    elif retrieved:
        status = "used"
    else:
        status = "empty"

    context["knowhow"] = {
        "status": status,
        "retrieved": retrieved,
        "eligible_target_seats": [],
        "retrieval_policy": "up_to_3_no_rerank",
    }
    return json.dumps(context, ensure_ascii=False, separators=(",", ":")), status, [
        {"knowhow_id": row["knowhow_id"], "title": row["title"]} for row in retrieved
    ]


def main(context_json: str, retrieval_results: list, eligible_target_seats: str) -> dict:
    director_context, status, retrieved = make_context(context_json, retrieval_results, "used")
    parsed = parse(director_context)
    knowhow = obj(parsed.get("knowhow"))
    eligible = items(json.loads(eligible_target_seats))
    knowhow["eligible_target_seats"] = eligible
    parsed["knowhow"] = knowhow
    return {
        "director_context": json.dumps(parsed, ensure_ascii=False, separators=(",", ":")),
        "knowhow_status": status,
        "retrieved_knowhow": json.dumps(retrieved, ensure_ascii=False, separators=(",", ":")),
    }


def main_without_retrieval(context_json: str, eligible_target_seats: str) -> dict:
    context = parse(context_json)
    eligible = items(json.loads(eligible_target_seats))
    context["knowhow"] = {
        "status": "not_relevant",
        "retrieved": [],
        "eligible_target_seats": eligible,
        "retrieval_policy": "skipped_by_rule",
    }
    return {"director_context": json.dumps(context, ensure_ascii=False, separators=(",", ":"))}
