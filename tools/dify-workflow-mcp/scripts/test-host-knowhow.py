import inspect
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DSL_NAME = "realtime-host-director-v3-knowhow.yml"
KNOWHOW_PATH = ROOT / "docs/主持经验库-v1.jsonl"
document = json.load(sys.stdin)
records = [json.loads(line) for line in KNOWHOW_PATH.read_text(encoding="utf-8").splitlines() if line.strip()]
nodes = {node["id"]: node for node in document["workflow"]["graph"]["nodes"]}
edges = document["workflow"]["graph"]["edges"]
data = {node_id: node["data"] for node_id, node in nodes.items()}

assert len(records) == 27
required = {"knowhow_id", "title", "scenario", "applicability", "recommended_strategy", "recommended_actions", "exceptions", "forbidden_actions", "examples", "version"}
assert all(set(row) == required and row["examples"] for row in records)
assert len({row["knowhow_id"] for row in records}) == len(records)
assert len(nodes) == len(document["workflow"]["graph"]["nodes"])
assert sum(node["data"]["type"] == "llm" for node in nodes.values()) == 1

retrieval = next(node for node in nodes.values() if node["data"]["type"] == "knowledge-retrieval")
assert retrieval["data"]["dataset_ids"] == []
assert retrieval["data"]["multiple_retrieval_config"]["top_k"] == 3
assert retrieval["data"]["multiple_retrieval_config"]["reranking_enable"] is False
assert retrieval["data"]["metadata_filtering_mode"] == "disabled"

for edge in edges:
    assert edge["source"] in nodes and edge["target"] in nodes
    assert edge["data"]["sourceType"] == data[edge["source"]]["type"]
    assert edge["data"]["targetType"] == data[edge["target"]]["type"], (edge["id"], edge["data"]["targetType"], data[edge["target"]]["type"])

def function(node_id):
    namespace = {}
    exec(compile(data[node_id]["code"], f"{node_id}.py", "exec"), namespace)
    main = namespace["main"]
    assert set(inspect.signature(main).parameters) == {item["variable"] for item in data[node_id].get("variables", [])}
    return main


router = function("1000000000010")
retrieval_context = function("1000000000013")
skip_context = function("1000000000014")
guard = function("1000000000006")
normalize = function("1000000000002")
p0_response = function("1000000000004")

def input_for(utterance, **overrides):
    payload = {
        "trigger_type": "chat", "player_input": utterance,
        "passengers": {"selected_seat": "front", "states": {"front": "普通", "rear_left": "普通", "rear_right": "普通"}},
        "game": {"status": "playing", "current_answer": "雨伞", "round_index": 1, "total_rounds": 10,
                 "question_count": 4, "max_questions": 15, "covered_fact_keys": [],
                 "round_question_plan": {"steps": [{"fact_key": "rain_related", "expected_answer": "yes",
                                                       "variants": {"default": "下雨时会用到它吗？"}}]}},
        "interaction": {"current_speaker": "front", "recent_messages": []},
        "event": None,
    }
    payload.update(overrides)
    return payload


def normalize_input(payload):
    return normalize(json.dumps(payload, ensure_ascii=False), "{}")


def run_router(payload):
    normalized = normalize_input(payload)
    return router(normalized["payload"], normalized["context_json"]), normalized


def depth(value):
    if isinstance(value, dict):
        return 1 + max((depth(item) for item in value.values()), default=0)
    if isinstance(value, list):
        return 1 + max((depth(item) for item in value), default=0)
    return 0


base = input_for("太难了，帮帮我。")
normalized_context = {"game": base["game"], "cabin_snapshot": {"passengers": {"rear_left": "普通", "rear_right": "普通"}}}
route, normalized = run_router(base)
assert isinstance(normalized["payload"], str)
assert depth(normalized) <= 5, f"Code node output depth exceeded: {depth(normalized)}"
assert json.loads(normalized["payload"])["game"]["round_question_plan"]["steps"]
assert route["needs_knowhow"] is True
query = json.loads(route["knowhow_query"])
assert "雨伞" not in route["knowhow_query"]
assert query["current_utterance"] == "太难了，帮帮我。"

self_think, _ = run_router(input_for("太难了，但让我再想想。"))
assert self_think["needs_knowhow"] is True
ordinary, _ = run_router(input_for("答案是不是红色？"))
assert ordinary["needs_knowhow"] is False
hint_request, _ = run_router(input_for("给我一点提示吧。"))
assert hint_request["needs_knowhow"] is False

sleeping_payload = input_for("后排左睡着了，叫他来猜吧。", passengers={
    "selected_seat": "front", "states": {"front": "普通", "rear_left": "睡着", "rear_right": "普通"}
})
sleeping_context = {"game": sleeping_payload["game"], "cabin_snapshot": {"passengers": {"rear_left": "睡着", "rear_right": "普通"}}}
sleep_route, _ = run_router(sleeping_payload)
assert sleep_route["needs_knowhow"] is True
assert json.loads(sleep_route["eligible_collaborators"]) == ["rearRight"]

environment = input_for("", trigger_type="event", event={"type": "environment_change", "value": "市区夜景"})
environment_route, _ = run_router(environment)
assert environment_route["needs_knowhow"] is True

hard_brake = input_for("", trigger_type="event", event={"type": "hard_brake", "priority": "P0"})
hard_brake_normalized = normalize_input(hard_brake)
hard_brake_result = json.loads(p0_response(hard_brake_normalized["payload"], hard_brake_normalized["exact_correct"], hard_brake_normalized["event_type"])["workflow_output"])
assert hard_brake_result["game_status"] == "paused"
assert hard_brake_result["speech"]["priority"] == "P0"

record = records[3]
retrieved = [{"content": json.dumps(record, ensure_ascii=False), "title": record["title"]}]
packaged = retrieval_context(json.dumps(normalized_context, ensure_ascii=False), retrieved, route["eligible_collaborators"])
assert packaged["knowhow_status"] == "used"
parsed_package = json.loads(packaged["director_context"])
assert parsed_package["knowhow"]["retrieved"][0]["knowhow_id"] == "HK04"
empty = retrieval_context(json.dumps(normalized_context), [], route["eligible_collaborators"])
assert empty["knowhow_status"] == "empty"
malformed = retrieval_context(json.dumps(normalized_context), [{"content": "not a valid experience record"}], route["eligible_collaborators"])
assert malformed["knowhow_status"] == "failed"
assert json.loads(malformed["director_context"])["knowhow"]["retrieved"] == []
skipped = json.loads(skip_context(json.dumps(normalized_context), route["eligible_collaborators"])["director_context"])
assert skipped["knowhow"]["status"] == "not_relevant"

def run_guard(model, payload, knowhow):
    context = {"knowhow": knowhow}
    return json.loads(guard(json.dumps(model, ensure_ascii=False), json.dumps(payload, ensure_ascii=False), json.dumps(context, ensure_ascii=False))["workflow_output"])


good_invite = run_guard({
    "ai_reply_text": "后排右还醒着，要请他一起加入吗？", "strategy": "invite_collaboration",
    "target_seat": "rearRight", "reason_codes": ["explicit_help_request", "eligible_collaborator_available"],
    "applied_knowhow_ids": ["HK04"],
}, base, {"status": "used", "retrieved": [{"knowhow_id": "HK04", "title": record["title"]}], "eligible_target_seats": ["rearRight"]})
assert good_invite["strategy"] == "invite_collaboration" and good_invite["target_seat"] == "rearRight"

false_hint_refusal = run_guard({
    "ai_reply_text": "规则不让加提示哦。要请后排右一起帮你猜吗？",
    "strategy": "invite_collaboration", "target_seat": "rearRight",
    "reason_codes": ["hint_request_blocked", "explicit_help_request"],
    "applied_knowhow_ids": ["HK04"],
}, base, {"status": "used", "retrieved": [{"knowhow_id": "HK04", "title": record["title"]}], "eligible_target_seats": ["rearRight"]})
assert "提示" not in false_hint_refusal["ai_reply_text"]
assert "hint_request_blocked" not in false_hint_refusal["reason_codes"]

unknown_id = run_guard({"ai_reply_text": "我陪你换个角度想。", "strategy": "encourage", "applied_knowhow_ids": ["HK99"]}, base,
                       {"status": "used", "retrieved": [{"knowhow_id": "HK04", "title": record["title"]}], "eligible_target_seats": ["rearRight"]})
assert unknown_id["strategy"] == "soft_response" and unknown_id["applied_knowhow_ids"] == []
assert unknown_id["decision_trace"]["guard_status"] == "knowhow_fallback"

invalid_target = run_guard({"ai_reply_text": "请后排左一起想想。", "strategy": "invite_collaboration", "target_seat": "rearLeft", "applied_knowhow_ids": ["HK04"]}, sleeping_payload,
                           {"status": "used", "retrieved": [{"knowhow_id": "HK04", "title": record["title"]}], "eligible_target_seats": ["rearRight"]})
assert invalid_target["target_seat"] is None and invalid_target["strategy"] == "soft_response"

paused_payload = input_for("答案是不是红色？", game={"status": "paused", "current_answer": "雨伞", "covered_fact_keys": []})
paused = run_guard({"ai_reply_text": "是。", "strategy": "direct_answer"}, paused_payload,
                   {"status": "not_relevant", "retrieved": [], "eligible_target_seats": []})
assert paused["game_status"] == "paused" and paused["covered_fact_keys"] == []

print(f"PASS {DSL_NAME}: {len(nodes)} nodes / {len(edges)} edges; one LLM; conditional retrieval and guard scenarios verified")
