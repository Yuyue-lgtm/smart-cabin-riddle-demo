import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
folder = root / "tmp/dify-import/host-experiences"
graphs = {kind: json.loads((folder / f"{kind}-candidate.json").read_text())["graph"]
          for kind in ("situation", "dialogue")}
records = [json.loads(line) for line in (root / "docs/主持经验库-v1.jsonl").read_text().splitlines()]
assert len(records) == len({row["knowhow_id"] for row in records}) == 28
assert next(row for row in records if row["knowhow_id"] == "HK28")["recommended_strategy"] == "invite_collaboration"


def code(kind, node_id):
    node = next(row for row in graphs[kind]["nodes"] if row["id"] == node_id)
    value = node["data"]["code"]
    compile(value, node_id, "exec")
    return value


for graph in graphs.values():
    for node in graph["nodes"]:
        if node["data"]["type"] == "code":
            compile(node["data"]["code"], node["id"], "exec")

situation_retrieval = code("situation", "3000000000011")
assert '"passenger_inactive": {"HK28"}' in situation_retrieval
assert "range(1, 29)" in situation_retrieval
analysis_result = code("situation", "3000000000014")
assert "2[0-8]" in analysis_result

chat_input = code("dialogue", "1000000000002")
assert '"participation"' in chat_input
assert "participation_snapshot_present" in chat_input
for node_id in ("1000000000006", "1000000000021", "1000000000024"):
    guard = code("dialogue", node_id)
    assert "range(1, 29)" in guard, node_id
    assert '"HK28": {"invite_collaboration"}' in guard, node_id

print("PASS: 28 unique experiences, HK28 retrieval applicability, participation handoff and all model guards allow HK28.")
