import json
import re


def obj(value):
    return value if isinstance(value, dict) else {}


def text(value, limit=500):
    return value.strip()[:limit] if isinstance(value, str) else ""


def items(value):
    return value if isinstance(value, list) else []


def parse(value):
    if isinstance(value, dict):
        return value
    try:
        return obj(json.loads(value))
    except (ValueError, TypeError):
        return {}


def model_json(value):
    value = text(value, 50000)
    start, end = value.find("{"), value.rfind("}")
    return parse(value[start:end + 1]) if start >= 0 and end > start else {}


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def selected_seat(payload):
    passengers, interaction = obj(payload.get("passengers")), obj(payload.get("interaction"))
    raw = passengers.get("selected_seat") or interaction.get("current_speaker") or passengers.get("selected_seat_label")
    aliases = {"主驾": "driver", "副驾": "front", "后排左": "rearLeft", "后排右": "rearRight", "rear_left": "rearLeft", "rear_right": "rearRight"}
    raw = text(raw)
    raw = aliases.get(raw, raw)
    return raw if raw in ("driver", "front", "rearLeft", "rearRight") else "front"


def fact_catalog(payload):
    game = obj(payload.get("game"))
    plan = obj(payload.get("round_question_plan") or game.get("round_question_plan"))
    return [{"fact_key": text(s.get("fact_key"), 80), "question": obj(s.get("variants") or s.get("question_variants")).get("default", ""), "answer": text(s.get("expected_answer"), 20)}
            for s in items(plan.get("steps"))[:8] if isinstance(s, dict) and text(s.get("fact_key"), 80)]


def perception_snapshot(payload):
    event = obj(payload.get("event"))
    event_type = text(event.get("type"), 80)
    perception = obj(payload.get("perception"))
    car = obj(payload.get("car"))
    if event_type:
        source = "event"
        conclusion = text(event.get("description"), 160) or event_type.replace("_", " ")
        confidence = 1.0
    elif perception:
        source = "cabin_snapshot"
        signals = [text(perception.get(key), 80) for key in ("vehicle_state", "driver_state", "cabin_mood", "game_progress")]
        conclusion = "；".join(value for value in signals if value) or "座舱状态已更新"
        confidence = 0.9
    else:
        source = "request_state"
        conclusion = "车速{} km/h，环境{}，驾驶员{}".format(
            car.get("speed", "未知"), text(car.get("environment"), 80) or "未知", text(obj(payload.get("passengers")).get("states", {}).get("driver"), 40) or "正常"
        )
        confidence = 0.7
    return {"source": source, "fusion_conclusion": conclusion, "confidence": confidence}


def decision_trace(layer, rule, priority, decision, guard_status="passed", hint_blocked=False):
    return {
        "layer": layer, "matched_rule": rule, "priority": priority,
        "strategy_id": rule, "decision": decision,
        "policy": "frontend_arbitrates_execution",
        "guard_status": guard_status, "hint_blocked": hint_blocked,
    }


def envelope(payload, line, priority="P2", status=None, correct=False, mode="normal", animation="speak", emotion="normal", reveal=False, seat=None, layer="llm", rule="realtime_director", guard_status="passed", hint_blocked=False, actions=None, decision="生成当前事件回复"):
    game = obj(payload.get("game"))
    status = status or game.get("status") or "playing"
    if status not in ("idle", "playing", "paused", "victory", "failed", "finished"):
        status = "playing"
    return {
        "intent": "answer_question", "reply_mode": "answer_only",
        "ai_reply_text": line, "covered_fact_keys": [], "passenger_action": None,
        "game_status": status, "is_correct": correct, "answer": text(game.get("current_answer"), 100),
        "ui_change": {"cabin_mode": mode, "target_seat": seat or selected_seat(payload), "host_emotion": emotion, "animation": animation, "show_answer": reveal},
        "priority": priority,
        "perception": perception_snapshot(payload),
        "decision_trace": decision_trace(layer, rule, priority, decision, guard_status, hint_blocked),
        "execution": {
            "actions": items(actions),
            "timing": {"mode": "after_current_speech_if_p1", "owner": "frontend"},
            "fallback": "ignore_unapproved_or_failed_action",
        },
        "speech": {"priority": priority, "max_duration_ms": 6000, "interruptible": priority != "P0"}
    }
