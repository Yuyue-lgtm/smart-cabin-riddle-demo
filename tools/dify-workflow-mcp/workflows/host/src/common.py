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
    car = obj(payload.get("car"))
    signals = []
    if payload.get("trigger_type") == "chat" and text(payload.get("player_input")):
        labels = {"driver": "主驾", "front": "副驾", "rearLeft": "后排左", "rearRight": "后排右"}
        signals.append({"field": "player_input", "value": text(payload.get("player_input"), 160),
                        "label": labels[selected_seat(payload)] + "说", "source": "request"})
    if event_type == "environment_change":
        signals.append({"field": "environment", "value": event.get("value"),
                        "previous_value": event.get("previous_value"), "label": "车外环境", "source": "event"})
    elif event_type == "speed_overspeed":
        signals.append({"field": "speed", "value": event.get("value"), "unit": "km/h",
                        "previous_value": event.get("previous_value"), "threshold": event.get("threshold_kmh"),
                        "label": "车速", "source": "event"})
    elif event_type in {"driver_tired", "driver_distracted"}:
        labels = {"asleep": "睡着", "fatigued": "疲惫"}
        value = "分心" if event_type == "driver_distracted" else labels.get(event.get("state"), "疲惫")
        signals.append({"field": "driver_state", "value": value,
                        "duration_ms": event.get("duration_ms"), "label": "主驾状态", "source": "event"})
    elif event_type == "passenger_inactive":
        signals.append({"field": "participation", "value": "副驾持续未参与",
                        "duration_ms": event.get("duration_ms"), "label": "乘客参与", "source": "event"})
    elif event_type:
        labels = {"hard_brake": "急刹", "safety_pause": "安全暂停", "passenger_sleep": "乘客睡着",
                  "near_destination": "即将到达", "timeout": "本题超时", "round_timeout": "本题超时",
                  "game_end": "整局结束", "start_game": "开始游戏", "resume_game": "恢复游戏",
                  "near_answer": "接近答案", "game_stuck": "猜谜停滞", "cabin_laughing": "车内欢笑",
                  "passenger_question": "乘客提问"}
        signals.append({"field": "event", "value": labels.get(event_type, "收到座舱事件"), "label": "事件", "source": "event"})
    if not signals:
        for key, label in (("environment", "车外环境"), ("speed", "车速")):
            if key in car:
                signals.append({"field": key, "value": car[key], "label": label, "source": "request"})
    # Simulation inputs are observations, not a calibrated sensor confidence.
    return {"schema_version": 2, "source": "event" if event_type else "request",
            "signals": signals, "confidence": None}


def decision_trace(layer, rule, priority, decision, guard_status="passed", hint_blocked=False):
    return {
        "schema_version": 2,
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
            "kind": "plan",
            "actions": items(actions),
            "timing": {"owner": "frontend"},
            "fallback": "ignore_unapproved_or_failed_action",
        },
        "knowhow_status": "not_relevant",
        "retrieved_knowhow": [],
        "strategy": "direct_answer",
        "target_seat": None,
        "reason_codes": [],
        "applied_knowhow_ids": [],
        "speech": {"priority": priority, "max_duration_ms": 6000, "interruptible": priority != "P0"}
    }
