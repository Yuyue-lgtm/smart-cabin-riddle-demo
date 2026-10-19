import json
import re


def obj(value):
    return value if isinstance(value, dict) else {}


def text(value, limit=1000):
    return value.strip()[:limit] if isinstance(value, str) else ""


def parse(value):
    if isinstance(value, dict):
        return value
    try:
        return obj(json.loads(value))
    except (ValueError, TypeError):
        return {}


def normalized(value):
    return re.sub(r"[\s，。！？、,.!?：:；;“”‘’（）()【】\[\]《》]", "", text(value))


def cjk_runs(value):
    return re.findall(r"[\u4e00-\u9fff]{2,}", text(value, 500))


def early_clue(value, answer, hint=""):
    candidate = normalized(value)
    markers = (
        "下雨", "雨天", "挡雨", "遮雨", "防雨", "下雪", "雪天", "刮风", "防晒", "天气",
        "折叠", "收起来", "撑开", "展开", "开合", "按下", "旋转", "拉开", "插入",
        "辐条", "伞柄", "塑料", "金属", "木头", "布料", "材质", "按钮", "充电",
    )
    if any(marker in candidate for marker in markers):
        return True
    normalized_answer = normalized(answer)
    if len(normalized_answer) >= 3 and any(normalized_answer[i:i + 2] in candidate for i in range(len(normalized_answer) - 1)):
        return True
    if normalized_answer and normalized_answer in candidate:
        return True

    hint_pairs = set()
    for run in cjk_runs(hint):
        hint_pairs.update(run[i:i + 2] for i in range(len(run) - 1))
    generic_pairs = {
        "日常", "生活", "常见", "常用", "一般", "通常", "可以", "是否", "东西", "物品",
        "用品", "用途", "使用", "出门", "身边", "有时", "时候", "一种", "一个", "它是",
        "它有", "它能", "会用", "用它", "跟人", "有关", "相关", "主要", "是不是",
    }
    clue_matches = {pair for pair in hint_pairs - generic_pairs if pair in candidate}
    return len(clue_matches) >= 2


def main(director_text: str, context_json: str) -> dict:
    context = parse(context_json)
    content = text(director_text, 50000).rsplit("</think>", 1)[-1]
    start, end = content.find("{"), content.rfind("}")
    raw = parse(content[start:end + 1]) if start >= 0 and end > start else {}
    plan = obj(raw.get("round_question_plan")) or raw
    generated = plan.get("steps")
    generated = generated if isinstance(generated, list) else []
    repair = obj(context.get("repair"))
    prefix = repair.get("accepted_steps") or []
    prefix = prefix if isinstance(prefix, list) else []
    try:
        count = max(2, min(8, int(context.get("step_count", 4))))
    except (ValueError, TypeError, OverflowError):
        count = 4
    required = context.get("variant_groups")
    required = [group for group in required if group in ("default", "child", "adult", "elder")] if isinstance(required, list) else []
    required = required or ["default"]
    answer = normalized(context.get("answer"))
    errors, cleaned, keys, aliases = [], [], set(), {}
    if not raw:
        errors.append("invalid_model_json")
    if len(prefix) + len(generated) != count:
        errors.append("step_count_mismatch")
    if not prefix and not generated:
        errors.append("empty_question_plan")
    if not answer:
        errors.append("missing_answer")
    if repair.get("invalid"):
        errors.append("invalid_repair_request")

    stages = {"category": 0, "location": 1, "function": 2, "feature": 3, "near_answer": 4}
    previous_rank = -1
    combined = prefix + ([] if repair.get("invalid") else generated)
    for index, raw_step in enumerate(combined[:count] if answer else []):
        step = obj(raw_step)
        step_errors = []
        key = text(step.get("fact_key"), 1000)
        if not re.fullmatch(r"[a-z][a-z0-9_]{0,79}", key) or key in keys:
            errors.append(f"invalid_fact_key_{index + 1}")
            if index < len(prefix):
                errors.append("accepted_prefix_invalid")
            break
        variants = obj(step.get("variants") or step.get("question_variants"))
        if not variants.get("default") and variants.get("adult"):
            variants = dict(variants, default=variants["adult"])
        variants = {group: text(variants.get(group)) for group in required}
        reply = text(step.get("host_reply_text"))
        if any(not question or len(question) > 20 for question in variants.values()) or not reply or len(reply) > 40:
            step_errors.append(f"invalid_or_long_text_{index + 1}")
        if any(answer in normalized(value) for value in [reply, *variants.values()]):
            step_errors.append(f"answer_leak_{index + 1}")

        stage = text(step.get("stage"), 40)
        expected = step.get("expected_answer")
        if stage not in stages or expected not in ("yes", "no", "partial", "uncertain"):
            step_errors.append(f"invalid_enum_{index + 1}")
        elif index < min(count, 3):
            if stage != ("category", "location", "function")[index]:
                step_errors.append(f"wrong_broad_stage_order_{index + 1}")
            if any(early_clue(question, answer, context.get("hint", "")) for question in variants.values()):
                step_errors.append(f"early_question_clue_leak_{index + 1}")
            if early_clue(reply, answer):
                step_errors.append(f"early_reply_clue_leak_{index + 1}")
        elif stages.get(stage, -1) < previous_rank or stage not in ("feature", "near_answer"):
            step_errors.append(f"specificity_not_progressive_{index + 1}")

        dependencies = step.get("depends_on", [])
        if not isinstance(dependencies, list):
            step_errors.append(f"invalid_dependencies_{index + 1}")
            dependencies = []
        mapped = []
        for dependency in dependencies:
            dependency = text(dependency, 80)
            dependency = dependency if dependency in keys else aliases.get(dependency, dependency)
            if dependency not in keys:
                step_errors.append(f"unknown_or_forward_dependency_{index + 1}")
            elif dependency not in mapped:
                mapped.append(dependency)
        if index > 0 and cleaned[-1]["fact_key"] not in mapped:
            step_errors.append(f"missing_previous_answer_dependency_{index + 1}")
        if step_errors:
            errors.extend(step_errors)
            if index < len(prefix):
                errors.append("accepted_prefix_invalid")
            break

        step_id = f"q{index + 1}"
        cleaned.append({
            "id": step_id, "order": index + 1, "fact_key": key, "depends_on": mapped,
            "stage": stage, "expected_answer": expected, "variants": variants,
            "host_reply_text": reply, "host_emotion": "normal",
        })
        previous_rank = stages[stage]
        keys.add(key)
        aliases[step_id] = key
        original_id = text(step.get("id"), 80)
        if original_id:
            aliases[original_id] = key

    if len(cleaned) < count and not errors:
        errors.append("incomplete_plan")
    status = "ready" if len(cleaned) == count else "partial" if cleaned else "failed"
    diagnostic = {
        "status": status,
        "accepted_step_count": len(cleaned),
        "requested_step_count": count,
        "repair_attempted": bool(repair),
        "repairable": status != "ready" and not repair and bool(answer),
        "validation_errors": list(dict.fromkeys(errors)),
    }
    result = {
        "ai_reply_text": "", "covered_fact_keys": [],
        "preview_status": status, "preview_diagnostic": diagnostic,
        "round_question_plan": {
            "plan_id": text(repair.get("plan_id"), 150) or "round-" + str(context.get("round_index", 0)),
            "reasoning_path": [step["stage"] for step in cleaned],
            "steps": cleaned,
        },
        "debug": {"validation_errors": diagnostic["validation_errors"]},
    }
    return {"workflow_output": json.dumps(result, ensure_ascii=False, separators=(",", ":"))}
