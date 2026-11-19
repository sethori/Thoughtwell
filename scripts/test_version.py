"""Tests for scripts/version.py. Run: python3 -m unittest discover -s scripts"""
import json
import tempfile
import unittest
from pathlib import Path

import version as v


class Rollover(unittest.TestCase):
    def test_patch(self):
        self.assertEqual(v.bump((1, 0, 1)), (1, 0, 2))
        self.assertEqual(v.bump((1, 0, 8)), (1, 0, 9))

    def test_patch_rolls_into_minor(self):
        self.assertEqual(v.bump((1, 0, 9)), (1, 1, 0))
        self.assertEqual(v.bump((1, 4, 9)), (1, 5, 0))

    def test_minor_rolls_into_major(self):
        self.assertEqual(v.bump((1, 9, 9)), (2, 0, 0))
        self.assertEqual(v.bump((9, 9, 9)), (10, 0, 0))

    def test_full_walk_has_no_gaps(self):
        cur, seen = (1, 0, 1), []
        while cur < (2, 0, 0):
            seen.append(cur)
            cur = v.bump(cur)
        self.assertEqual(len(seen), 99)  # 1.0.1 .. 1.9.9
        self.assertEqual(cur, (2, 0, 0))


class FromTags(unittest.TestCase):
    def test_first_release(self):
        self.assertEqual(v.next_version([]), (1, 0, 1))
        self.assertEqual(v.next_version(["desktop-v0.1.0", "nightly"]), (1, 0, 1))

    def test_continues_from_highest(self):
        self.assertEqual(v.next_version(["v1.0.3", "v1.0.9", "v1.0.2"]), (1, 1, 0))
        self.assertEqual(v.next_version(["v1.2.3", "v1.9.9"]), (2, 0, 0))

    def test_out_of_range_tags_carry(self):
        self.assertEqual(v.next_version(["v1.0.10"]), (1, 1, 1))
        self.assertEqual(v.next_version(["v1.2.3", "v1.10.0"]), (2, 0, 1))

    def test_two_part_tags(self):
        self.assertEqual(v.parse_tag("v2.3"), (2, 3, 0))
        self.assertEqual(v.next_version(["v2.3"]), (2, 3, 1))
        self.assertEqual(v.latest_tag_name(["v1.0.1", "v2.3"]), "v2.3")

    def test_ignores_other_tags(self):
        for t in ("1.0.0", "v1", "v1.0.0-rc1", "release-v3.0.0"):
            self.assertIsNone(v.parse_tag(t), t)


class Stamp(unittest.TestCase):
    def test_stamps_only_top_level_version(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "apps" / "desktop").mkdir(parents=True)
            (root / "package.json").write_text('{\n  "name": "x",\n  "version": "0.0.0"\n}\n')
            desk = root / "apps" / "desktop" / "package.json"
            desk.write_text('{\n  "version": "0.0.0",\n  "dependencies": {\n    "version": "1.2.3"\n  }\n}\n')
            changed = v.stamp("1.4.2", root)
            self.assertEqual(len(changed), 2)
            self.assertEqual(json.loads(desk.read_text())["version"], "1.4.2")
            self.assertEqual(json.loads(desk.read_text())["dependencies"]["version"], "1.2.3")

    def test_rejects_bad_version(self):
        with self.assertRaises(ValueError):
            v.stamp("1.0", Path("/nonexistent"))


if __name__ == "__main__":
    unittest.main()
