import importlib.util
import json
import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "tools/dify-workflow-mcp/workflows/preview/src" / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.main


compact = load("preview_input")
guard = load("preview_guard")


def step(index):
    return {
        "id": "q" + str(index), "fact_key": "fact_" + str(index),
        "stage": ["category", "location", "function", "feature"][index - 1],
        "depends_on": ["fact_" + str(index - 1)] if index > 1 else [],
        "expected_answer": "yes", "variants": {"default": "它常见吗？"},
        "host_reply_text": "是的。",
    }


def run(steps, repair=None):
    context = {"answer": "安全带", "step_count": 4, "variant_groups": ["default"]}
    if repair:
        context["repair"] = repair
    return json.loads(guard(json.dumps({"steps": steps}, ensure_ascii=False), json.dumps(context))["workflow_output"])


class PreviewGuardTests(unittest.TestCase):
    def test_complete_valid_chain_is_ready(self):
        output = run([step(index) for index in range(1, 5)])
        self.assertEqual(output["preview_status"], "ready")
        self.assertEqual(len(output["round_question_plan"]["steps"]), 4)
        self.assertEqual(output["ai_reply_text"], "")
        self.assertEqual(output["covered_fact_keys"], [])

    def test_safe_prefix_stops_at_first_rejected_step(self):
        steps = [step(index) for index in range(1, 5)]
        steps[1]["variants"]["default"] = "它是安全带吗？"
        output = run(steps)
        self.assertEqual(output["preview_status"], "partial")
        self.assertEqual(len(output["round_question_plan"]["steps"]), 1)
        self.assertIn("answer_leak_2", output["preview_diagnostic"]["validation_errors"])
        self.assertTrue(output["preview_diagnostic"]["repairable"])

    def test_repair_only_appends_suffix_and_preserves_plan_identity(self):
        prefix = run([step(1)])["round_question_plan"]["steps"]
        repair = {"attempt": 1, "plan_id": "stable-plan", "accepted_steps": prefix}
        output = run([step(index) for index in range(2, 5)], repair)
        self.assertEqual(output["preview_status"], "ready")
        self.assertEqual(output["round_question_plan"]["plan_id"], "stable-plan")
        self.assertEqual(output["round_question_plan"]["steps"][:1], prefix)
        self.assertFalse(output["preview_diagnostic"]["repairable"])

    def test_failed_repair_retains_prefix_without_retry(self):
        prefix = run([step(1)])["round_question_plan"]["steps"]
        output = run([], {"attempt": 1, "accepted_steps": prefix})
        self.assertEqual(output["preview_status"], "partial")
        self.assertEqual(output["round_question_plan"]["steps"], prefix)
        self.assertFalse(output["preview_diagnostic"]["repairable"])

    def test_forward_dependency_discards_dependent_suffix(self):
        steps = [step(index) for index in range(1, 5)]
        steps[2]["depends_on"] = ["fact_4"]
        output = run(steps)
        self.assertEqual(len(output["round_question_plan"]["steps"]), 2)
        self.assertIn("unknown_or_forward_dependency_3", output["preview_diagnostic"]["validation_errors"])

    def test_first_step_failure_returns_empty_plan_with_reason(self):
        first = step(1)
        first["variants"]["default"] = "这是安全带吗？"
        output = run([first, *[step(index) for index in range(2, 5)]])
        self.assertEqual(output["preview_status"], "failed")
        self.assertEqual(output["round_question_plan"]["steps"], [])
        self.assertIn("answer_leak_1", output["preview_diagnostic"]["validation_errors"])
        self.assertFalse(output["preview_diagnostic"]["repair_attempted"])

    def test_hint_overlap_is_rejected_at_early_stage(self):
        context = {"answer": "灯笼", "hint": "夜晚会发出蓝色光芒", "step_count": 4, "variant_groups": ["default"]}
        first = step(1)
        first["variants"]["default"] = "它会发出蓝色光芒吗？"
        output = json.loads(guard(json.dumps({"steps": [first, *[step(index) for index in range(2, 5)]]}), json.dumps(context))["workflow_output"])
        self.assertEqual(len(output["round_question_plan"]["steps"]), 0)
        self.assertIn("early_question_clue_leak_1", output["preview_diagnostic"]["validation_errors"])

    def test_invalid_fact_key_stops_before_later_steps(self):
        first = step(1)
        first["fact_key"] = "Not a valid key"
        output = run([first, *[step(index) for index in range(2, 5)]])
        self.assertEqual(output["round_question_plan"]["steps"], [])
        self.assertIn("invalid_fact_key_1", output["preview_diagnostic"]["validation_errors"])
        self.assertNotIn("invalid_fact_key_2", output["preview_diagnostic"]["validation_errors"])

    def test_reply_leak_is_checked_without_removing_reply_generation(self):
        steps = [step(index) for index in range(1, 5)]
        steps[3]["host_reply_text"] = "它就是安全带。"
        output = run(steps)
        self.assertEqual(len(output["round_question_plan"]["steps"]), 3)
        self.assertEqual(output["round_question_plan"]["steps"][0]["host_reply_text"], "是的。")
        self.assertEqual(output["ai_reply_text"], "")

    def test_early_clue_and_invalid_prefix_are_still_rejected(self):
        first = step(1)
        first["variants"]["default"] = "它是金属做的吗？"
        output = run([], {"attempt": 1, "accepted_steps": [first]})
        self.assertEqual(output["preview_status"], "failed")
        self.assertIn("accepted_prefix_invalid", output["preview_diagnostic"]["validation_errors"])

    def test_malformed_input_and_persona_fallback(self):
        context = json.loads(compact(json.dumps({"game": [], "passengers": {"personas": {"driver": {"age_group": "elder"}}}}))["context_json"])
        self.assertEqual(context["variant_groups"], ["default", "elder"])
        result = json.loads(guard("not json", json.dumps(context))["workflow_output"])
        self.assertFalse(result["preview_diagnostic"]["repairable"])
        self.assertIn("missing_answer", result["preview_diagnostic"]["validation_errors"])

    def test_second_repair_attempt_is_rejected(self):
        context = json.loads(compact(json.dumps({"game": {"current_answer": "安全带"}, "round_question_plan_request": {"repair": {"attempt": 2, "accepted_steps": []}}}))["context_json"])
        result = json.loads(guard(json.dumps({"steps": [step(1)]}), json.dumps(context))["workflow_output"])
        self.assertEqual(result["preview_status"], "failed")
        self.assertIn("invalid_repair_request", result["preview_diagnostic"]["validation_errors"])

    def test_repair_without_plan_id_is_rejected_but_keeps_safe_prefix(self):
        prefix = run([step(1)])['round_question_plan']['steps']
        payload = {"game": {"current_answer": "安全带"}, "round_question_plan_request": {
            "step_count": 4, "persona_age_groups": ["adult"],
            "repair": {"attempt": 1, "accepted_steps": prefix}
        }}
        context = json.loads(compact(json.dumps(payload, ensure_ascii=False))["context_json"])
        output = json.loads(guard(json.dumps({"steps": []}), json.dumps(context))["workflow_output"])
        self.assertEqual(output["preview_status"], "partial")
        self.assertEqual(output["round_question_plan"]["steps"], prefix)
        self.assertIn("invalid_repair_request", output["preview_diagnostic"]["validation_errors"])
        self.assertFalse(output["preview_diagnostic"]["repairable"])


if __name__ == "__main__":
    unittest.main()
