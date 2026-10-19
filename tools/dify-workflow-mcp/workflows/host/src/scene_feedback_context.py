def main(context_json: str) -> dict:
    scene = parse(context_json)
    feedback = obj(obj(scene.get("snapshot")).get("feedback"))
    scene["analysis_plan"] = {"share_context": False, "selected_fields": [],
                              "proactive_speech": True, "analysis_valid": True}
    scene["knowhow"] = {"status": "not_relevant", "retrieved": [], "eligible_target_seats": []}
    titles = {"HK10": "团队六题里程碑庆祝", "HK11": "个人连续破题的适度认可",
              "HK12": "个人累计六题贡献里程碑", "HK13": "每位乘员首次破题被看见",
              "HK14": "连续未破题后的反弹鼓励", "HK17": "多人接力成功的团队认可"}
    selected = text(feedback.get("selected_id"), 10)
    topics = {"HK10": "团队累计破解题目首次达到六道 团队六题里程碑庆祝",
              "HK11": "个人连续破题 两道三道 同一人 连续答对 两连三连",
              "HK12": "个人累计六题贡献里程碑 一位乘员本局累计答对六道",
              "HK13": "本局第一次答对 每位乘员首次破题被看见",
              "HK14": "团队连续至少两题无人答对 随后破解一题 反弹鼓励",
              "HK17": "同一题至少两位乘员贡献有效属性问题 多人接力成功 团队认可"}
    query = topics.get(selected, titles.get(selected, ""))
    return {"director_context": encode(scene), "knowhow_query": query, "eligible_target_seats": "[]"}
