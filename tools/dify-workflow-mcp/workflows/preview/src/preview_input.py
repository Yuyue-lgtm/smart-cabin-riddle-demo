import json
import re


def obj(value):
    return value if isinstance(value, dict) else {}


def items(value):
    return value if isinstance(value, list) else []


def generation_policy(answer, count, hint=""):
    answer = re.sub(r"[\s，。！？、,.!?：:；;“”‘’（）()【】\[\]《》]", "", answer)
    fragments = [answer] if answer else []
    if len(answer) >= 3:
        fragments += [answer[index:index + 2] for index in range(len(answer) - 1)]
    generic_pairs = {
        "日常", "生活", "常见", "常用", "一般", "通常", "可以", "是否", "东西", "物品",
        "用品", "用途", "使用", "出门", "身边", "有时", "时候", "一种", "一个", "它是",
        "它有", "它能", "会用", "用它", "跟人", "有关", "相关", "主要", "是不是",
    }
    hint_pairs = {run[index:index + 2] for run in re.findall(r"[\u4e00-\u9fff]{2,}", hint[:500])
                  for index in range(len(run) - 1)} - generic_pairs
    return {
        "broad_step_count": min(count, 3),
        "broad_stages": ["category", "location", "function"][:count],
        "forbidden_answer_fragments": list(dict.fromkeys(fragments)),
        "hint_overlap_pairs": sorted(hint_pairs),
        "max_hint_pair_matches_per_question": 1,
        "forbidden_specific_markers": [
            "下雨", "雨天", "挡雨", "遮雨", "防雨", "下雪", "雪天", "刮风", "防晒", "天气",
            "折叠", "收起来", "撑开", "展开", "开合", "按下", "旋转", "拉开", "插入",
            "辐条", "伞柄", "塑料", "金属", "木头", "布料", "材质", "按钮", "充电",
        ],
        "short_replies": {"yes": "是的。", "no": "不是。", "partial": "不完全是。", "uncertain": "不确定。"},
        "question_max_chars": 20,
        "reply_max_chars": 40,
    }


def repair_guidance(errors):
    guidance = []
    if any(code.startswith("early_question_clue_leak_") for code in errors):
        guidance.append("失败问题过早暴露线索。改问更上位的属性；所有年龄变体逐字避开generation_policy中的forbidden_answer_fragments、forbidden_specific_markers和hint_overlap_pairs，不能仅把原句换同义词。")
    if any(code.startswith("early_reply_clue_leak_") for code in errors):
        guidance.append("失败回答带入了谜底片段或具体线索。只使用与expected_answer一致的short_replies，不复述用途或解释原因。")
    if any(code.startswith("answer_leak_") for code in errors):
        guidance.append("任何步骤的问题和回答都不得出现完整谜底。")
    if any("dependency" in code or "dependencies" in code for code in errors):
        guidance.append("只依赖前序fact_key，首个补全步骤必须依赖已接受前缀最后的fact_key。")
    if any(code.startswith("invalid_or_long_text_") for code in errors):
        guidance.append("缩短问题与回答，完整覆盖variant_groups。")
    return guidance


def main(input_payload: str) -> dict:
    try:
        payload = json.loads(input_payload)
        payload = payload if isinstance(payload, dict) else {}
    except (ValueError, TypeError):
        payload = {}
    game = obj(payload.get("game"))
    request = obj(payload.get("round_question_plan_request"))
    try:
        count = max(2, min(8, int(request.get("step_count", payload.get("step_count", 4)))))
    except (ValueError, TypeError, OverflowError):
        count = 4
    groups = [group for group in items(request.get("persona_age_groups")) if group in ("child", "adult", "elder")]
    if not groups:
        personas = obj(obj(payload.get("passengers")).get("personas"))
        groups = [obj(personas.get(seat)).get("age_group") for seat in ("driver", "rear_left", "rear_right")]
        groups = [group for group in groups if group in ("child", "adult", "elder")]
    groups = list(dict.fromkeys(groups))
    context = {
        "answer": str(game.get("current_answer") or "")[:100],
        "hint": str(game.get("hint") or "")[:300],
        "theme": str(game.get("current_theme") or "")[:100],
        "round_index": game.get("round_index", 0),
        "step_count": count,
        "variant_groups": ["default"] + [group for group in (groups or ["child", "adult", "elder"]) if group != "adult"],
    }
    context["generation_policy"] = generation_policy(context["answer"], count, context["hint"])
    context["remaining_step_count"] = count
    repair = request.get("repair")
    if isinstance(repair, dict):
        prefix = repair.get("accepted_steps")
        plan_id = str(repair.get("plan_id") or "")[:150]
        invalid = (
            repair.get("attempt") != 1
            or not plan_id
            or not isinstance(prefix, list)
            or len(prefix) > count
        )
        context["repair"] = {
            "attempt": 1,
            "invalid": invalid,
            "plan_id": plan_id,
            "accepted_steps": prefix[:count] if isinstance(prefix, list) else [],
            "validation_errors": [str(code)[:160] for code in items(repair.get("validation_errors"))[:30]],
        }
        context["remaining_step_count"] = count - len(context["repair"]["accepted_steps"])
        context["repair"]["rewrite_instructions"] = repair_guidance(context["repair"]["validation_errors"])
    next_index = count - context["remaining_step_count"]
    context["next_global_step"] = next_index + 1
    context["next_required_stage"] = ["category", "location", "function"][next_index] if next_index < 3 else "feature" if next_index == 3 else "near_answer"
    return {"context_json": json.dumps(context, ensure_ascii=False, separators=(",", ":"))}
