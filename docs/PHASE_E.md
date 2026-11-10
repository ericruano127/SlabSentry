# Phase E — Live service: releases, patch notes, ground truth, accuracy (done 2026-11-10)

| Requirement | Delivered |
|---|---|
| Versioned releases ("patches") | `releases` bundle rules version, published library (version + hash), vision tool versions (`/health` → `app/versions.py`), app version and active models. Immutable once published (DB trigger). Every report records `release_version` (`+unreleased` suffix when the running build differs from the latest published release) |
| Two changelogs | **Public** notes (shown on `/whats-new`, footer version link, mobile Account) are **linted**: technical terms, thresholds, measurements and method names are rejected. **Internal** notes hold full detail (what changed, why, data used) |
| Pipeline for verified samples | Staff (analyst+) label sessions **genuine / counterfeit / altered** with the basis (grader confirmation, grader submission result, expert inspection, marketplace/law-enforcement, internal test sample) and a note. Only sessions whose photos are **consented for model work** (training-eligible) or internal staff samples can be labeled. Multiple independent labels; disagreements are excluded until adjudicated |
| Counterfeit technique log | Internal log (graders, generations, source, status reported → confirmed → mitigated, mitigating release) |
| Retraining / model versions | All analysis is deterministic today; `model_registry` (task, artifact, training-data/consent note, metrics, status) is ready and active models are recorded in each release |
| Accuracy tracking | Missed fakes vs false flags (plus weak catches, over-caution, abstentions), per category, grader and holder generation; missed fakes weigh **5×** (`MISSED_FAKE_WEIGHT`). Two views: as delivered, and **replay** with current rules |
| Metrics with each patch + gate | Every analysis stores the exact engine inputs; creating a release **replays** them on the labeled set and compares with the previous release. **New missed fakes or higher weighted cost block publishing**; only an owner can override, with an audited reason |

**Limits:** replay re-runs the rules engine, not the vision service — vision tool changes need the labeled images re-analysed (noted on every gate). With fewer than 100 labeled slabs the dashboard warns that rates aren't meaningful. No labeled data exists yet; the first published release in this dev database is 2026.11.6.
