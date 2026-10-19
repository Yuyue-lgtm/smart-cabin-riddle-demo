_cabin_policy_guard = main
STRATEGY_BY_ID["HK02"].add("soft_response")


def zone_light_authorization(utterance, speaker):
    line = text(utterance, 800).strip()
    if re.search(r"(?:它|谜底|答案|假如|如果|假设|能不能用|能关灯吗|会关灯吗)|(?:不要|别|先别).{0,5}(?:关|开)", line):
        return None
    # Require an actual command, not a mention, question about an object, or quotation.
    if re.search(r"[“”\"‘’]|怎么|如何|为什么|是不是|是否", line):
        return None
    match = re.search(r"(?:关掉|关闭|关一下|关了|关上|打开|开启|开一下|开了).{0,12}灯|灯.{0,8}(?:关掉|关闭|关一下|关了|关上|打开|开启|开一下|开了)", line)
    if not match:
        return None
    seats = [seat for label, seat in (("主驾", "driver"), ("副驾", "front"), ("后排左", "rearLeft"), ("后排右", "rearRight")) if label in line]
    if not seats and re.search(r"我这|我的|我这边|这边", line):
        seats = [speaker]
    if len(set(seats)) != 1 or re.search(r"全车|全部|所有|大家|后排两", line):
        return None
    return {"type": "cabin.set_zone_light", "seat": seats[0], "enabled": bool(re.search(r"打开|开启|开一下|开了", match.group()))}


def help_request(line):
    return bool(re.search(r"给.{0,8}(?:提示|线索|暗示)|(?:提示|线索|暗示).{0,5}(?:一下|一点|吧|呢|吗)|提示下|太难|好难|帮帮我|没头绪|重述.{0,4}线索|复述.{0,4}线索", line))


def game_pause_authorization(utterance):
    line = text(utterance, 800).strip()
    if re.search(r"它|谜底|答案|假如|如果|假设|[“”\"‘’]|怎么|如何|为什么|是否|是不是|要不要|该不该|音乐|歌曲|视频|导航|(?:不要|别|先别|不用|不想|不愿).{0,6}(?:暂停|停|继续|恢复|接着)", line):
        return None
    pause = bool(re.search(r"(?:暂停|先停|停下|停一停|停一下).{0,5}(?:游戏|猜谜)|(?:游戏|猜谜).{0,5}(?:暂停|先停|停一下)|^(?:请|帮我|先)?暂停(?:一下|吧|下)?[。！!？?]*$", line))
    resume = bool(re.search(r"(?:继续|恢复|接着).{0,5}(?:游戏|猜谜|玩)|(?:游戏|猜谜).{0,5}(?:继续|恢复)|^(?:请|帮我)?继续(?:吧|一下)?[。！!？?]*$", line))
    return None if pause == resume else pause


def main(director_text: str, payload: str, director_context: str, model_result: str = "") -> dict:
    result = parse(_cabin_policy_guard(director_text, payload, director_context, model_result)["workflow_output"])
    current, context = parse(payload), parse(director_context)
    if current.get("trigger_type") != "chat":
        return {"workflow_output": encode(result)}
    line = text(current.get("player_input"), 800)
    game = obj(current.get("game"))
    pause = game_pause_authorization(line)
    if pause is not None:
        eligible = game.get("status") == "playing" or game.get("status") == "paused" and game.get("pause_reason") == "user"
        actions = [{"type": "game.set_paused", "paused": pause}] if eligible else []
        candidate = text(result.get("ai_reply_text"), 500)
        usable = (eligible and obj(result.get("decision_trace")).get("guard_status") == "passed"
                  and not re.search(r"无法|不能|不支持|不具备|没有.{0,4}权限", candidate)
                  and re.search(r"暂停|先停|停住" if pause else r"继续|接着|恢复", candidate)
                  and not (text(game.get("current_answer"), 100) and text(game.get("current_answer"), 100) in candidate))
        reply = (candidate if usable else "我来暂停游戏，这题和进度都会保留。" if pause
                 else "我来继续游戏，接着刚才的题目和进度。") if eligible else "当前不是可由玩家继续的暂停状态，安全暂停需要先确认安全。"
        result.update(ai_reply_text=reply, intent="game_related_chat", reply_mode="chat_only", covered_fact_keys=[],
                      game_status=game.get("status"), is_correct=False, answer=None, passenger_action=None,
                      strategy="soft_response", target_seat=None, applied_knowhow_ids=[], reason_codes=["explicit_game_control"])
        result["execution"] = {"kind": "plan", "actions": actions, "timing": {"owner": "frontend"}}
        result["ui_change"] = {"show_answer": False, "animation": "speak", "host_emotion": "normal"}
        result["decision_trace"].update(guard_status="passed", matched_rule="explicit_game_control",
            action_authorization="explicit_game_control", decision="明确游戏暂停/继续请求；前端保留进度并检查安全状态后执行")
        return {"workflow_output": encode(result)}
    if re.search(r"它|谜底|答案|假如|如果|假设|[“”\"‘’]|(?:不要|别|先别).{0,4}(?:关闭|关掉|停止|暂停|打开|开启|启动)", line):
        result["execution"]["actions"] = []
    game = obj(current.get("game"))
    if help_request(line) and game.get("status") == "playing":
        answer = text(game.get("current_answer"), 100)
        clues = [text(clue, 160) for clue in items(game.get("public_clues"))
                 if isinstance(clue, str) and text(clue, 160) and (not answer or answer not in clue)]
        clue = next((clue for clue in reversed(clues) if len(clue) <= 54), "")
        result.update(ai_reply_text="已公开：" + clue if clue else "目前没有可重述的公开线索，可以继续问是或否问题。",
                      intent="game_related_chat", reply_mode="chat_only", covered_fact_keys=[],
                      strategy="soft_response", target_seat=None, applied_knowhow_ids=[], reason_codes=["public_clue_recap"])
        result["execution"]["actions"] = []
        result["decision_trace"].update(guard_status="passed", hint_blocked=True, matched_rule="public_clue_recap",
            decision="仅重述前端已公开线索，不新增事实或揭晓答案")
        return {"workflow_output": encode(result)}
    normalized = parse(model_result)
    model = model_json(normalized.get("canonical_text", director_text))
    proposed = items(model.get("execution_actions"))
    lights = [action for action in proposed if obj(action).get("type") == "cabin.set_zone_light"]
    authorization = zone_light_authorization(line, selected_seat(current))
    request_like = not re.search(r"它|谜底|答案|假如|如果|假设|[“”\"‘’]|不要|先别|别关|别开", line)
    refusal = None
    if request_like:
        if re.search(r"我.{0,3}(?:冷|热)|(?:调|开|关|升|降).{0,8}(?:空调|温度)", line):
            refusal = "我目前不能调节空调，你可以手动调整；游戏进度会保留。"
        elif re.search(r"还有多久到|多久能到|什么时候到|几分钟到", line):
            refusal = "我目前无法查询到达时间，你可以查看行程信息；这题的进度还在。"
        elif re.search(r"换.{0,4}主题|切换.{0,4}主题", line):
            refusal = "我目前不能切换游戏主题，我们先保留当前这题。"
        elif re.search(r"(?:分区|我这边).{0,8}(?:音量|声音).{0,5}(?:调|大|小|关)|(?:调|关闭).{0,8}分区音量", line):
            refusal = "我目前不能单独调节分区音量，可以帮你开关游戏背景音乐。"
        elif re.search(r"(?:关掉|关闭|关一下|关了|关上|打开|开启|开一下|开了).{0,12}灯|灯.{0,8}(?:关掉|关闭|关一下|关了|关上|打开|开启|开一下|开了)", line) and not authorization:
            refusal = "你想调整哪个分区的灯光？可以说副驾、主驾或后排左、后排右。"
    if refusal:
        result.update(ai_reply_text=refusal, intent="game_related_chat", reply_mode="chat_only", covered_fact_keys=[],
                      strategy="soft_response", target_seat=None, applied_knowhow_ids=[], reason_codes=["capability_boundary"])
        result["execution"]["actions"] = []
        result["decision_trace"].update(guard_status="passed", decision="能力边界或目标不明确，不执行设备动作并保留游戏进度")
        return {"workflow_output": encode(result)}
    unsupported = [action for action in proposed if obj(action).get("type") not in {"music.set_enabled", "cabin.set_zone_light"}]
    if unsupported or lights and (len(proposed) != 1 or lights != [authorization]):
        result["execution"]["actions"] = []
        result.update(ai_reply_text="", intent="fallback", covered_fact_keys=[])
        result["decision_trace"].update(guard_status="control_not_authorized", guard_reason_codes=["control_not_authorized"])
    elif lights and result["decision_trace"].get("guard_status") == "passed":
        result["execution"]["actions"] = lights
        result.update(intent="game_related_chat", reply_mode="chat_only", covered_fact_keys=[])
        result["decision_trace"].update(action_authorization="explicit_zone_light_command", decision="明确分区灯光请求，等待前端验证执行")
    return {"workflow_output": encode(result)}
