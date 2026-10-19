FEEDBACK_IDS = {"HK10", "HK11", "HK12", "HK13", "HK14", "HK17"}
ALL_SEATS = {"driver", "front", "rearLeft", "rearRight"}


def count(value, maximum=100):
    return int(value) if isinstance(value, (int, float)) and not isinstance(value, bool) and 0 <= value <= maximum else 0


def host_preferences(snapshot):
    raw = obj(snapshot.get("host_preferences"))
    return {key: raw[key] if isinstance(raw.get(key), bool) else default
            for key, default in (("praise", True), ("brief", False), ("invitations", True), ("independent", False))}


def performance_snapshot(snapshot):
    raw = obj(snapshot.get("performance"))
    result = {key: count(raw.get(key)) for key in ("completed_rounds", "team_correct", "streak_count", "consecutive_unsolved")}
    result["per_seat_correct"] = {seat: count(obj(raw.get("per_seat_correct")).get(seat)) for seat in ALL_SEATS}
    result["streak_seat"] = raw.get("streak_seat") if raw.get("streak_seat") in ALL_SEATS else None
    result["recent_results"] = [{"round_index": count(row.get("round_index")),
                                 "correct_seat": row.get("correct_seat") if row.get("correct_seat") in ALL_SEATS else None}
                                for row in items(raw.get("recent_results"))[-3:] if isinstance(row, dict)]
    last = obj(raw.get("last_result"))
    result["last_result"] = {"round_index": count(last.get("round_index")),
                             "correct_seat": last.get("correct_seat") if last.get("correct_seat") in ALL_SEATS else None,
                             "contributors": list(dict.fromkeys(seat for seat in items(last.get("contributors")) if seat in ALL_SEATS))}
    return result


def feedback_snapshot(snapshot):
    raw = obj(snapshot.get("host_feedback"))
    return {"id": text(raw.get("id"), 140), "subject_seat": raw.get("subject_seat") if raw.get("subject_seat") in ALL_SEATS else None,
            "selected_id": text(raw.get("selected_id"), 10),
            "candidate_ids": [key for key in items(raw.get("candidate_ids"))[:3] if key in FEEDBACK_IDS],
            "contributors": list(dict.fromkeys(seat for seat in items(raw.get("contributors")) if seat in ALL_SEATS)),
            **{key: count(raw.get(key)) for key in ("team_correct", "personal_correct", "streak_count", "previous_unsolved")}}


def valid_result_feedback(snapshot):
    event, game = obj(snapshot.get("event")), obj(snapshot.get("game"))
    feedback, performance = feedback_snapshot(snapshot), performance_snapshot(snapshot)
    subject = feedback["subject_seat"]
    if (event.get("type") != "post_result_feedback" or event.get("source") != "performance_monitor"
            or game.get("status") != "victory" or not host_preferences(snapshot)["praise"]
            or not feedback["id"] or subject not in ALL_SEATS
            or performance["last_result"]["correct_seat"] != subject
            or performance["last_result"]["round_index"] != game.get("round_index")
            or feedback["team_correct"] != performance["team_correct"]
            or feedback["personal_correct"] != performance["per_seat_correct"][subject]
            or feedback["streak_count"] != performance["streak_count"]):
        return False
    recent = performance["recent_results"]
    valid = set()
    if feedback["team_correct"] == 6:
        valid.add("HK10")
    if performance["streak_seat"] == subject and feedback["streak_count"] in (2, 3):
        valid.add("HK11")
    if feedback["personal_correct"] == 6:
        valid.add("HK12")
    if feedback["personal_correct"] == 1:
        valid.add("HK13")
    if feedback["previous_unsolved"] >= 2 and len(recent) == 3 and all(row["correct_seat"] is None for row in recent[:-1]):
        valid.add("HK14")
    if len(feedback["contributors"]) >= 2 and set(feedback["contributors"]) == set(performance["last_result"]["contributors"]):
        valid.add("HK17")
    return bool(feedback["candidate_ids"] and feedback["selected_id"] in feedback["candidate_ids"]
                and set(feedback["candidate_ids"]).issubset(valid))


_experience_clean_snapshot = clean_snapshot


def clean_snapshot(raw):
    source = parse(raw)
    current = _experience_clean_snapshot(raw)
    current.update(host_preferences=host_preferences(source), performance=performance_snapshot(source),
                   host_feedback=feedback_snapshot(source))
    return current


_experience_shareable_snapshot = shareable_snapshot


def shareable_snapshot(snapshot):
    return {**_experience_shareable_snapshot(snapshot), "performance": performance_snapshot(snapshot),
            "host_preferences": host_preferences(snapshot), "feedback": feedback_snapshot(snapshot)}
