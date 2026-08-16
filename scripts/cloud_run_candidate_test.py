import unittest

from cloud_run_candidate import select_candidate_url


class SelectCandidateUrlTest(unittest.TestCase):
    def service(self, traffic: list[dict[str, object]]) -> dict[str, object]:
        return {
            "status": {
                "latestReadyRevisionName": "retire-plan-00047-puf",
                "traffic": traffic,
            }
        }

    def candidate(self, **overrides: object) -> dict[str, object]:
        target: dict[str, object] = {
            "revisionName": "retire-plan-00047-puf",
            "tag": "candidate",
            "url": "https://candidate---retire-plan-example-uc.a.run.app",
        }
        target.update(overrides)
        return target

    def test_selects_candidate_after_live_target_without_url(self) -> None:
        service = self.service(
            [
                {"percent": 100, "revisionName": "retire-plan-00046-old"},
                self.candidate(percent=0),
            ]
        )

        self.assertEqual(
            select_candidate_url(service),
            "https://candidate---retire-plan-example-uc.a.run.app",
        )

    def test_selection_does_not_depend_on_traffic_order(self) -> None:
        service = self.service(
            [
                self.candidate(percent=0),
                {"percent": 100, "revisionName": "retire-plan-00046-old"},
            ]
        )

        self.assertEqual(
            select_candidate_url(service),
            "https://candidate---retire-plan-example-uc.a.run.app",
        )

    def test_rejects_missing_candidate(self) -> None:
        service = self.service(
            [{"percent": 100, "revisionName": "retire-plan-00046-old"}]
        )

        with self.assertRaisesRegex(ValueError, "found 0"):
            select_candidate_url(service)

    def test_rejects_multiple_candidates(self) -> None:
        service = self.service([self.candidate(), self.candidate()])

        with self.assertRaisesRegex(ValueError, "found 2"):
            select_candidate_url(service)

    def test_rejects_candidate_for_stale_revision(self) -> None:
        service = self.service(
            [self.candidate(revisionName="retire-plan-00046-old")]
        )

        with self.assertRaisesRegex(ValueError, "not latest ready revision"):
            select_candidate_url(service)

    def test_rejects_non_candidate_url(self) -> None:
        service = self.service(
            [self.candidate(url="https://retire-plan-example-uc.a.run.app")]
        )

        with self.assertRaisesRegex(ValueError, "unexpected format"):
            select_candidate_url(service)


if __name__ == "__main__":
    unittest.main()
