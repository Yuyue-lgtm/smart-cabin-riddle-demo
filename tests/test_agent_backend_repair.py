import copy
import importlib.util
from pathlib import Path
import secrets
import unittest

PATH = Path(__file__).resolve().parents[1] / "deploy/alibaba-cloud/repair-agent-secret.py"
SPEC = importlib.util.spec_from_file_location("agent_repair", PATH)
repair = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(repair)


class AgentSecretTests(unittest.TestCase):
    def test_only_unpadded_32_byte_base64url_is_valid(self):
        self.assertTrue(repair.valid_secret(secrets.token_urlsafe(32)))
        for value in (None, "", secrets.token_urlsafe(36), "a" * 32, "=" * 43,
                      secrets.token_urlsafe(32) + "=", "not a secret"):
            self.assertFalse(repair.valid_secret(value))

    def test_replacement_preserves_other_settings(self):
        source = "# comment\nSECRET_KEY=unchanged\nDIFY_AGENT_SERVER_SECRET_KEY=invalid\nNEXT=unchanged\n"
        self.assertEqual(repair.replace_secret(source, "new-value"), source.replace("=invalid", "=new-value"))

    def test_missing_or_duplicate_key_is_rejected(self):
        for source in ("OTHER=x\n", "DIFY_AGENT_SERVER_SECRET_KEY=a\nDIFY_AGENT_SERVER_SECRET_KEY=b\n"):
            with self.assertRaises(RuntimeError):
                repair.replace_secret(source, "new-value")

    def test_compose_diff_is_strictly_one_variable(self):
        before = {"services": {name: {"environment": {repair.KEY: "old", "OTHER": "keep"}}
                              for name in ("api", "agent_backend")}}
        after = copy.deepcopy(before)
        for service in after["services"].values():
            service["environment"][repair.KEY] = "new"
        self.assertEqual(repair.verify_config_change(before, after, "new"), ["api", "agent_backend"])
        self.assertEqual(before["services"]["api"]["environment"][repair.KEY], "old")
        after["services"]["api"]["environment"]["OTHER"] = "changed"
        with self.assertRaises(RuntimeError):
            repair.verify_config_change(before, after, "new")

    def test_public_agent_port_is_rejected(self):
        before = {"services": {"agent_backend": {"environment": {repair.KEY: "old"},
                                                "ports": [{"published": "5050"}]}}}
        after = copy.deepcopy(before)
        after["services"]["agent_backend"]["environment"][repair.KEY] = "new"
        with self.assertRaises(RuntimeError):
            repair.verify_config_change(before, after, "new")


if __name__ == "__main__":
    unittest.main()
