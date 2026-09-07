from __future__ import annotations

import json
from typing import Any

from .models import AssessmentAnswer, AssessmentResult

ASSESSMENT_FAMILIES = (
    ("phq_9", (("phq_9", 9), ("phq_2", 2))),
    ("gad_7", (("gad_7", 7), ("gad_2", 2))),
    ("lsns_6", (("lsns_6", 6), ("lsns_2", 2))),
)


def _parse_assets(bundle: dict[str, Any]) -> dict[str, dict[str, Any]]:
    assets: dict[str, dict[str, Any]] = {}
    for asset in bundle.get("data_assets", []):
        content = asset.get("content")
        if isinstance(content, str):
            try:
                content = json.loads(content)
            except json.JSONDecodeError:
                continue
        if isinstance(content, dict) and isinstance(content.get("id"), str):
            assets[content["id"]] = content
    return assets


def _classification(scoring: dict[str, Any], score: float) -> str:
    for rule in scoring.get("rules", []):
        minimum = rule.get("min_score")
        maximum = rule.get("max_score")
        if isinstance(minimum, (int, float)) and isinstance(maximum, (int, float)):
            if minimum <= score <= maximum:
                return str(rule.get("id", "unclassified"))
    return "unclassified"


def score_assessments(state: dict[str, Any], bundle: dict[str, Any]) -> list[AssessmentResult]:
    assets = _parse_assets(bundle)
    results: list[AssessmentResult] = []
    for state_key, forms in ASSESSMENT_FAMILIES:
        assessment_state = state.get(state_key)
        if not isinstance(assessment_state, dict):
            continue
        raw_answers = assessment_state.get("answers")
        if not isinstance(raw_answers, list) or not raw_answers:
            continue
        answers = [str(value) for value in raw_answers]
        # Always retain the short-form score when a longer assessment was
        # completed. This gives longitudinal reports a stable PHQ-2/GAD-2/
        # LSNS-2 baseline even when a later call expands to the full form.
        for form_id, required in reversed(forms):
            if len(answers) < required or form_id not in assets:
                continue
            form = assets[form_id]
            items = form.get("items", [])
            response_sets = form.get("response_sets", {})
            scored_answers: list[AssessmentAnswer] = []
            domain_scores: dict[str, float] = {}
            for index, response_id in enumerate(answers[: len(items)]):
                item = items[index]
                options = response_sets.get(item.get("response_set"), [])
                option = next(
                    (candidate for candidate in options if candidate.get("id") == response_id),
                    None,
                )
                if not isinstance(option, dict) or not isinstance(option.get("score"), (int, float)):
                    continue
                score = float(option["score"])
                domain = item.get("domain")
                if isinstance(domain, str):
                    domain_scores[domain] = domain_scores.get(domain, 0) + score
                scored_answers.append(
                    AssessmentAnswer(
                        item_id=str(item.get("id", f"item_{index + 1}")),
                        prompt=str(item.get("prompt", "")),
                        response_id=response_id,
                        response_label=str(option.get("label", response_id)),
                        score=int(score) if score.is_integer() else score,
                    )
                )
            scoring = form.get("scoring", {})
            required_count = int(scoring.get("required_answer_count", len(items)))
            total = sum(answer.score for answer in scored_answers)
            complete = len(scored_answers) >= required_count
            results.append(
                AssessmentResult(
                    key=str(form.get("id", state_key)),
                    title=str(form.get("title", form.get("id", state_key))),
                    form=str(form.get("id", state_key)).replace("_", "-").upper(),
                    score=total,
                    maximum=float(scoring.get("maximum", 0)),
                    classification=_classification(scoring, float(total)) if complete else "incomplete",
                    complete=complete,
                    answered_count=len(scored_answers),
                    required_count=required_count,
                    answers=scored_answers,
                    domain_scores={
                        key: int(value) if value.is_integer() else value for key, value in domain_scores.items()
                    },
                )
            )
    return results


def report_priority(assessments: list[AssessmentResult]) -> str:
    by_key = {item.key: item for item in assessments if item.complete}
    phq = by_key.get("phq_9")
    gad = by_key.get("gad_7")
    lsns = by_key.get("lsns_6")
    if phq and phq.score >= 20:
        return "review"
    if (phq and phq.score >= 10) or (gad and gad.score >= 10):
        return "review"
    if lsns and lsns.score < 12:
        return "monitor"
    if any(
        item.classification
        in {
            "further_assessment_needed",
            "moderate_depression",
            "moderate_anxiety",
            "moderately_severe_depression",
            "severe_depression",
            "severe_anxiety",
        }
        for item in assessments
    ):
        return "monitor"
    return "low"


def direction_for_delta(assessment_key: str, delta: float) -> str:
    if delta == 0:
        return "stable"
    lower_is_better = assessment_key.startswith(("phq_", "gad_"))
    improved = delta < 0 if lower_is_better else delta > 0
    return "improved" if improved else "worsened"
