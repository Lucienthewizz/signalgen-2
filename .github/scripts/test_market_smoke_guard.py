import datetime as dt
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("guard", Path(__file__).with_name("market-smoke-guard.py"))
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class GuardTests(unittest.TestCase):
    def test_final_allowed_attempt_and_expiry(self):
        armed = dt.datetime(2026, 11, 19, tzinfo=dt.timezone.utc)
        self.assertTrue(guard.decision(armed, armed + dt.timedelta(minutes=59), 6, "schedule")["collect"])
        self.assertTrue(guard.decision(armed, armed, 7, "schedule")["disable"])
        self.assertTrue(guard.decision(armed, armed + dt.timedelta(hours=1), 1, "schedule")["disable"])
        self.assertTrue(guard.decision(armed, armed - dt.timedelta(seconds=1), 0, "schedule")["disable"])
        self.assertFalse(guard.decision(armed, armed, 0, "workflow_dispatch")["disable"])


if __name__ == "__main__":
    unittest.main()
