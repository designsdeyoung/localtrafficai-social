# LocalTrafficAI Instagram recovery

Prepared September 26, 2026 for designsdeyoung/localtrafficai-social.
Base commit: 5f94e9efbb9a33930f109969ae52dc86bb28a21f.

## What stopped

The old GitHub Actions job referenced a 120-post calendar but the repository
contained only post-01.png through post-06.png. Runs succeeded through June 7;
the first failing run was June 8. The August 3 log explicitly reports an
Instagram media-download error for the absent post-63.png. No later runs were
returned. Old June logs had expired, so the exact first error cannot be read.
The separate n8n template is not the publisher used by these GitHub runs.

## What this patch changes

- Generates a fresh 1080 x 1350 RGB JPEG for every posting date before publishing.
- Uses 30 reviewed evergreen tips in a rolling sequence. The sequence repeats
  every 30 days; it is not an unlimited source of novel AI-written material.
  Update content/evergreen-posts.json to keep the channel editorially fresh.
- Uses navy, teal, and blue branded graphics with plain ASCII copy.
- No Higgsfield, OpenAI, or other paid generation API is required.
- Verifies the connected Instagram username is exactly localtrafficai.
- Saves generated images and posting state on main before publishing, then
  uses an immutable raw GitHub image URL and checks public JPEG availability.
- Saves a container ID and a pre-publish checkpoint. Ambiguous network outcomes
  reconcile against recent Instagram media. If still uncertain, publishing stops
  for human review rather than risking duplicates.
- Waits for FINISHED, fails on ERROR/EXPIRED, and never publishes after a timeout.
- Skips dates already recorded as published, serializes runs, and never backfills.
- Replaces the exhausted calendar with rolling content and schedules at about
  9:17 AM Eastern. Two UTC slots handle daylight saving changes; the second
  is skipped. GitHub can delay scheduled execution.
- Pushes and pull requests run offline checks only. Manual preview is the default.
- Failed runs and actionable errors appear in GitHub Actions and its run summary.
  Enable GitHub Actions failure notifications for email delivery if desired.

## Deploy and verify

Deploy the eight repair files together through the repository's normal review
process. Pushes and pull requests run the offline validation job. Existing
Actions secrets IG_BUSINESS_ID and IG_ACCESS_TOKEN are reused.

1. Run the local checks when changing the publisher or graphics:

       python -m pip install -r automation/requirements.txt
       node --test automation/post-today.test.js
       python automation/test-render.py
       TEST_DATE=2026-09-26 node automation/post-today.js

2. Review .output/post.jpg and .output/post.json.
3. Merge the repair after the validate job succeeds.
4. In GitHub Actions, enable Daily IG Post if disabled. The cron expression has
   changed, which can reactivate inactivity-disabled schedules when committed
   by an authorized writer. Confirm the workflow is enabled in the UI.
5. Existing Actions secrets IG_BUSINESS_ID and IG_ACCESS_TOKEN are reused.
   The publishing job needs Contents write access for its image and journal
   commits. Respect branch protections; if they prevent journal writes, adapt
   storage to an authorized durable store before enabling live publishing.
6. Run Daily IG Post manually with mode=preview and inspect its artifact.
7. Run it with mode=publish on main, without test_date. This posts today's item
   only after account, JPEG, journal, and container checks pass. Verify the
   PUBLISHED media ID, published journal entry, and live Instagram post.
8. Run publish once more to verify the existing journal skips a duplicate.

## Credential and recovery notes

A repository repair cannot silently renew an expired Meta authorization. If the
live run reports code 190, reconnect the Meta app for the correct Instagram
business account and replace IG_ACCESS_TOKEN through GitHub's secure secrets UI.
The token's live validity has not been tested from this environment.

If publishing-state.json records status=publishing, do not delete it blindly.
The script checks recent media and container state on the next run. If it cannot
confirm the outcome, inspect Instagram first and reconcile the entry. A publish
can succeed even when its HTTP response or later git push fails.

Preview mode makes no API calls and writes only .output files. No secrets are
included in this archive. Native GitHub failure notifications depend on the
account's notification settings; this patch does not configure email services.

## Validation completed locally

- 10 mocked publisher tests: date boundaries, missing assets, successful publish,
  duplicate skipping, failed journal writes, processing timeouts, recovery from
  ambiguous outcomes, authentication errors, JPEG fetching, and token redaction.
- All 30 graphics rendered and checked for JPEG format, RGB mode, 1080 x 1350
  dimensions, file size, text layout bounds, and caption limits.
- Preview CLI generated a valid JPEG without Instagram credentials.
- Workflow YAML structure checked.
- One generated preview visually inspected.

The GitHub Actions run history and content/publishing-state.json are the source
of truth for live deployment and publishing outcomes.
