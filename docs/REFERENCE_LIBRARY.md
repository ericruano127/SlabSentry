# Reference library: verified templates

The label layout/colour, UV-pattern and microprint checks compare a slab with a **verified genuine** slab of the same holder generation.

Until a template is approved, those checks report "inconclusive". They never guess.

Staff manage templates at **Staff tools → Verified templates** (`/admin/templates`).

## Workflow
1. **Find the gap.** The coverage grid shows, for every holder generation and check, how many templates are approved and how many are pending.
2. **Submit.** Analysts, admins and owners can submit. Each submission needs:
   - a photo: an upload, or the image id of a photo already uploaded in a session;
   - the holder generation and the check (label, UV or microprint);
   - an optional variant name, such as "regular", "gold label" or "autograph";
   - optionally, the source slab's cert number;
   - an **evidence type** and a note on how authenticity was established outside this app.

   The evidence types are:
   - confirmed by the grader;
   - submitted by us;
   - matches the grader's own registry image;
   - trusted dealer, with the cert verified on the grader's site;
   - other.
3. **Automatic checks** run before anything reaches a reviewer. A failure is shown immediately and nothing is stored.

   | Check | Refused when |
   |---|---|
   | Metadata | Always stripped (EXIF, GPS, XMP), using the same lossless sanitizer as user uploads |
   | Photo quality | Any major issue, such as blur, glare or exposure |
   | Right kind of photo | Label: the whole slab isn't found. UV: it doesn't look like a blacklight photo. Microprint: the fine print isn't resolved |
   | Duplicate | The exact same template is already pending or approved for that generation |
   | Consistency | Never refused. The new photo is compared with the templates already approved for that generation, and the verdict is shown to the reviewer: first template / matches an approved template / unclear / **differs from all** (check the generation and the source slab) |

   For label templates, the label is cropped automatically. The full photo is kept so reviewers can see what it was cut from.
4. **Review (two-person rule).** An admin or owner who **did not submit it** approves or rejects. A rejection needs a reason.
   - The rule is enforced twice: by the API (`two_person_rule`, 403) and by a database constraint, so it holds even if application code were bypassed.
   - **Single-operator deployments:** set `TEMPLATE_SELF_APPROVAL=1` to let an *owner* approve their own submission. It's recorded as self-approved and shown in the UI.
5. **In use.** Only approved templates are used, and new analyses use them straight away.
   - Each generation can have up to 3 variants: the most recently approved template per variant name.
   - The photo is compared with each variant and the **best match** is used. A special label is then compared with the special-label template, not flagged against the regular one.
   - The template id and variant used are stored with the evidence. Cache keys include the template id, so approving or retiring a template re-runs the comparison.
6. **Retire.** An admin or owner can retire an approved template, with a reason. New analyses stop using it immediately.

Every step is written to the admin audit log and shown as the template's history.

## Releases
Approved templates change analysis results, so the set of approved templates is part of the release record. A release records the count plus a fingerprint of the template ids (`components.templates`), next to the rules, library and vision versions.

## What makes a good template
- **Label:**
  - straight-on, with all four edges in frame;
  - even, diffuse light and no glare;
  - the phone parallel to the slab.

  The in-app camera's live guidance helps with all of these.
- **UV:**
  - a dark room, with a 365–395 nm blacklight held at a consistent distance;
  - straight on, with no visible light leaking in.
- **Microprint:**
  - as close as the phone can focus;
  - sharp, with no motion blur.
- **Several examples per variant.** Add more than one example and retire weaker ones as better photos arrive.

## Roles
| Action | Analyst | Admin | Owner |
|---|:-:|:-:|:-:|
| View templates and coverage | ✓ | ✓ | ✓ |
| Submit | ✓ | ✓ | ✓ |
| Approve / reject / retire (not one's own submission) | | ✓ | ✓ |

All staff actions require a two-factor (aal2) session.

## Limits
- **Evidence isn't verified by the app.** The app records how authenticity was established; it cannot check that evidence itself. The quality of the library depends on the evidence and the second reviewer.
- **The consistency verdict uses the same comparisons as analysis.** It is a signal for the reviewer, not proof.
- **Scores need tuning.** Thresholds for layout, colour, UV overlap and microprint inliers were set on synthetic test images. They should be tuned once real genuine and counterfeit samples exist (see the accuracy dashboard).
