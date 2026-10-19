import json
from pathlib import Path
import unittest


SOURCE = Path(__file__).resolve().parents[1] / "workflows/host/src"


def node(name):
    scope = {}
    exec((SOURCE / "common.py").read_text() + "\n" + (SOURCE / name).read_text(), scope)
    return scope


class HostTraceTests(unittest.TestCase):
    def setUp(self):
        self.guard = node("realtime_guard.py")
        self.payload = {"trigger_type": "chat", "player_input": "下雨时用吗？",
                        "game": {"status": "playing", "current_answer": "雨伞"}}

    def reply(self, mode="answer_only", line="是，下雨时常用。"):
        raw = json.dumps({"intent": "answer_question", "reply_mode": mode, "ai_reply_text": line})
        return json.loads(self.guard["main"](raw, self.payload)["workflow_output"])

    def test_observation_is_input_not_confidence(self):
        output = self.reply()
        self.assertIsNone(output["perception"]["confidence"])
        self.assertEqual(output["perception"]["signals"][0]["value"], self.payload["player_input"])
        self.assertNotIn("fusion_conclusion", output["perception"])

    def test_environment_delta(self):
        self.payload.update(trigger_type="event", player_input="", event={
            "type": "environment_change", "previous_value": "车库", "value": "城区晴天白天", "priority": "P1"})
        output = self.reply(line="我们来到市区啦。")
        self.assertEqual(output["perception"]["signals"][0]["previous_value"], "车库")
        self.assertEqual(output["decision_trace"]["decision"], "回应新的车外环境")
        self.assertEqual(output["priority"], "P1")
        self.assertNotIn("mode", output["execution"]["timing"])

    def test_decision_records_selected_mode(self):
        self.assertEqual(self.reply("chat_then_bridge")["decision_trace"]["decision"], "接住话题，再引导回到游戏")
        self.assertEqual(self.reply("chat_only")["decision_trace"]["layer"], "llm")

    def test_hint_is_real_rule(self):
        self.payload["player_input"] = "给我一点提示"
        trace = self.reply()["decision_trace"]
        self.assertEqual(trace["layer"], "rule")
        self.assertEqual(trace["matched_rule"], "hint_request_blocked")

    def test_failed_validation_is_not_model_success(self):
        trace = self.reply(line="就是雨伞。")["decision_trace"]
        self.assertEqual(trace["layer"], "fallback")
        self.assertEqual(trace["matched_rule"], "invalid_model_reply")

    def test_music_is_plan_not_result(self):
        self.payload["player_input"] = "打开背景音乐"
        output = self.reply(line="收到，尝试打开音乐。")
        self.assertEqual(output["execution"]["kind"], "plan")
        self.assertTrue(output["execution"]["actions"][0]["enabled"])
        self.assertEqual(output["decision_trace"]["action_authorization"], "explicit_music_command")
        self.payload["player_input"] = "不要关闭音乐"
        self.assertEqual(self.reply()["execution"]["actions"], [])

    def test_missing_state_not_invented(self):
        result = self.guard["perception_snapshot"]({})
        self.assertEqual(result["signals"], [])
        self.assertIsNone(result["confidence"])

    def test_p0_branches(self):
        p0 = node("realtime_p0.py")["main"]
        for event, correct, status in [("hard_brake", False, "paused"), ("timeout", False, "failed"),
                                       ("game_end", False, "finished"), ("", True, "victory")]:
            output = json.loads(p0(self.payload, correct, event)["workflow_output"])
            self.assertEqual(output["game_status"], status)
            self.assertEqual(output["decision_trace"]["layer"], "rule")
            self.assertEqual(output["decision_trace"]["schema_version"], 2)


if __name__ == "__main__":
    unittest.main()
