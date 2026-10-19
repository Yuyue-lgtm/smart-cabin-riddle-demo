_retrieval_context_original = main


def main(context_json: str, retrieval_results: list, eligible_target_seats: str) -> dict:
    result = _retrieval_context_original(context_json, retrieval_results, eligible_target_seats)
    context = parse(result["director_context"])
    knowhow = obj(context.get("knowhow"))
    kind = context.get("event_type")
    applicable = {"game_stuck": {"HK01"}, "environment_change": {"HK06"},
                  "resume_game": {"HK08"}, "near_destination": {"HK09"},
                  "cabin_laughing": {"HK07"},
                  "passenger_inactive": {"HK28"}}.get(kind, set())
    states = obj(obj(context.get("snapshot")).get("passengers"))
    if kind == "post_result_feedback":
        applicable = set(items(obj(obj(context.get("snapshot")).get("feedback")).get("candidate_ids")))
    if any(state in {"sleeping", "asleep", "睡着"} for state in states.values()):
        applicable = applicable | {"HK05"}
    knowhow["retrieval_hits"] = json.loads(result["retrieved_knowhow"])
    knowhow["retrieved"] = [row for row in items(knowhow.get("retrieved")) if row.get("knowhow_id") in applicable]
    if knowhow.get("status") == "used" and not knowhow["retrieved"]:
        knowhow["status"] = "not_relevant"
    context["knowhow"] = knowhow
    result["director_context"] = json.dumps(context, ensure_ascii=False, separators=(",", ":"))
    result["knowhow_status"] = knowhow["status"]
    return result
