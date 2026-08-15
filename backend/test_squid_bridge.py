import unittest

from squid_bridge import macro_playback_policy, should_repeat_macro


class MacroPlaybackPolicyTests(unittest.TestCase):
    def test_legacy_macro_runs_once(self):
        self.assertEqual(macro_playback_policy({"durationMs": 450}), (450, 1, 450))

    def test_finite_replay_multiplies_progress_duration(self):
        self.assertEqual(
            macro_playback_policy({"cycleDurationMs": 450, "repeatMode": "count", "repeatCount": 3}),
            (450, 3, 1350),
        )

    def test_infinite_replay_uses_no_repeat_limit(self):
        self.assertEqual(
            macro_playback_policy({"cycleDurationMs": 450, "repeatMode": "infinite", "repeatCount": 0}),
            (450, None, 450),
        )

    def test_invalid_values_are_safe_and_bounded(self):
        self.assertEqual(macro_playback_policy({"cycleDurationMs": "bad", "repeatCount": 10000}), (1, 999, 999))
        self.assertEqual(macro_playback_policy(None), (1, 1, 1))

    def test_repeat_decision_stops_finite_runs_and_keeps_infinite_runs_alive(self):
        self.assertTrue(should_repeat_macro(3, 1))
        self.assertTrue(should_repeat_macro(3, 2))
        self.assertFalse(should_repeat_macro(3, 3))
        self.assertTrue(should_repeat_macro(None, 1000000))


if __name__ == "__main__":
    unittest.main()
