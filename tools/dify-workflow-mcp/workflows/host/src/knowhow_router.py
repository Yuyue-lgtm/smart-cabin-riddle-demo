import json
import re


def obj(value):
    return value if isinstance(value, dict) else {}


def items(value):
    return value if isinstance(value, list) else []


def text(value, limit=300):
    return value.strip()[:limit] if isinstance(value, str) else ""


def parse(value):
    if isinstance(value, dict):
        return value
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, dict) else {}
    except (ValueError, TypeError):
        return {}


def seat(value):
    return {
        "主驾": "driver", "副驾": "front", "后排左": "rearLeft", "后排右": "rearRight",
        "rear_left": "rearLeft", "rear_right": "rearRight",
    }.get(text(value), text(value))


def passenger_states(payload, context):
    current = obj(obj(payload.get("passengers")).get("states"))
    snapshot = obj(obj(context.get("cabin_snapshot")).get("passengers"))
    driver = obj(obj(context.get("cabin_snapshot")).get("driver"))
    return {
        "driver": text(current.get("driver") or driver.get("mood") or driver.get("state") or "未知", 30),
        "front": text(current.get("front") or snapshot.get("front") or "未知", 30),
        "rearLeft": text(current.get("rear_left") or current.get("rearLeft") or snapshot.get("rear_left") or "未知", 30),
        "rearRight": text(current.get("rear_right") or current.get("rearRight") or snapshot.get("rear_right") or "未知", 30),
    }


def needs_retrieval(payload, context):
    game = obj(payload.get("game"))
    event_type = text(obj(payload.get("event")).get("type"), 80)
    utterance = text(payload.get("player_input"), 800)
    lowered = utterance.lower()
    if game.get("status") == "paused":
        return False

    if event_type in {
        "environment_change", "speed_overspeed", "driver_tired", "passenger_sleep",
        "near_destination", "game_stuck", "near_answer", "cabin_laughing", "resume_game",
    }:
        return True

    if not utterance or payload.get("trigger_type") != "chat":
        return False

    if re.search(r"(?:打开|开启|播放|关掉|关闭|停止|暂停|静音).{0,8}(?:背景音乐|音乐)|(?:背景音乐|音乐).{0,8}(?:打开|开启|播放|关掉|关闭|停止|暂停|静音)", utterance):
        return False

    # Explicit hint requests are handled by the hard-rule guard, not by retrieval.
    if re.search(r"提示|线索|暗示", utterance):
        return False

    help_or_stuck = re.search(r"太难|好难|不会|想不出|没头绪|卡住|帮帮我|帮我(?:一下|想想|分析)?|救救我|再错了|连续猜错", utterance)
    independent = re.search(r"让我(?:自己)?(?:再)?想想|我想自己猜|先别帮|不用帮我", utterance)
    collaboration = re.search(r"邀请|叫上|让.{0,5}(?:参与|一起|回答|猜)|(?:后排|副驾|大家).{0,5}(?:帮忙|一起猜|参与)", utterance)
    if help_or_stuck or independent or collaboration:
        return True

    conversation = obj(payload.get("conversation_context"))
    if conversation.get("just_had_smalltalk") or conversation.get("should_gently_bridge_if_natural"):
        return True

    if re.search(r"(?:太难|卡住|没头绪).{0,15}(?:第\s*[2-9]|连续|又错|猜错)", utterance):
        return True

    # Ordinary factual yes/no questions remain on the fast path.
    if re.search(r"(?:是不是|是否|有没有|会不会|能不能|可不可以|算不算|属于|有吗|是吗|对吗|吗[？?]?$|能用吗|常见吗)", utterance):
        return False

    # Other conversational free text may need a lightweight strategy reference.
    return game.get("status") == "playing" and len(utterance) >= 4


def main(payload: object, context_json: str) -> dict:
    payload = parse(payload)
    context = parse(context_json)
    event = obj(payload.get("event"))
    game = obj(payload.get("game"))
    interaction = obj(payload.get("interaction"))
    speaker = seat(obj(payload.get("passengers")).get("selected_seat") or interaction.get("current_speaker"))
    states = passenger_states(payload, context)
    eligible = [candidate for candidate in ("front", "rearLeft", "rearRight")
                if candidate != speaker and states.get(candidate) not in ("睡着", "sleeping", "asleep")]
    utterance = text(payload.get("player_input"), 360)

    recent = []
    answer = text(game.get("current_answer"), 100)
    for message in items(interaction.get("recent_messages"))[-2:]:
        if not isinstance(message, dict):
            continue
        line = text(message.get("text") or message.get("content"), 120)
        if line and (not answer or answer not in line):
            recent.append(line)

    progress = {
        "phase": text(game.get("status"), 24),
        "round": game.get("round_index"),
        "rounds_total": game.get("total_rounds"),
        "question_count": game.get("question_count"),
        "question_limit": game.get("max_questions"),
    }
    query = {
        "game_progress": progress,
        "current_utterance": utterance,
        "speaker_seat": speaker,
        "passenger_states": states,
        "eligible_collaborators": eligible,
        "event_type": text(event.get("type"), 80),
        "relevant_recent_turns": recent,
        "active_constraints": [
            "不得透露谜底、额外事实或隐藏提示",
            "安全暂停时不得推进游戏或计时",
            "协作对象必须清醒、非主驾且不是当前发言者",
            "睡着乘员不得被邀请或打扰",
            "只建议前端已支持的动作；知识经验不能授权执行动作",
        ],
    }
    return {
        "needs_knowhow": needs_retrieval(payload, context),
        "knowhow_query": json.dumps(query, ensure_ascii=False, separators=(",", ":")),
        "eligible_collaborators": json.dumps(eligible, ensure_ascii=False, separators=(",", ":")),
    }
