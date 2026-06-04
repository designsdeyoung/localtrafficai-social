# Posting Automation Setup

This wires `@localtrafficai` to the Instagram Graph API so n8n can post for you
on schedule. Plan about 30 to 45 minutes the first time. Most of it is Meta's
account plumbing, which you only do once.

The hard truth up front: Instagram has no simple "post for me" API. Publishing
goes through the Instagram Graph API, which requires a Business (or Creator)
account connected to a Facebook Page, inside a Meta app. The steps below get
you there.

---

## Part 1: Convert @localtrafficai to a Business account

1. Open the Instagram app, go to your profile.
2. Menu (top right) → **Settings and privacy**.
3. **Account type and tools** → **Switch to professional account**.
4. Choose **Business** (not Creator. The publishing API wants Business).
5. Pick a category (Software / Internet Company works).
6. Finish the prompts. You can skip the contact info if you want.

Your account is now a Business account. Nothing about how it looks changes.

## Part 2: Create and link a Facebook Page

The API talks to Instagram *through* a Facebook Page. You need one even if you
never plan to use Facebook.

1. Go to https://www.facebook.com/pages/create
2. Name it (e.g. "Local Traffic AI"), pick a category, create it.
3. In the **Instagram app**: Settings → **Accounts Center** (or
   Settings → Business tools → "Connected accounts/Page").
4. Link the new Facebook Page to your Instagram Business account.
5. Confirm the link from the Facebook side too: Page → Settings → **Linked
   accounts** → Instagram should show `@localtrafficai` connected.

## Part 3: Create a Meta app

1. Go to https://developers.facebook.com/apps → **Create app**.
2. Use case: choose **Other**, then app type **Business**.
3. Name it (e.g. "LTA IG Poster"), attach your Business portfolio if asked.
4. In the app dashboard, **Add product** → add **Instagram** (Instagram Graph
   API). Some dashboards list it as "Instagram" with a "Set up" button.

## Part 4: Get your IG Business ID and a long-lived token

The fastest path is the Graph API Explorer.

1. Open https://developers.facebook.com/tools/explorer
2. Top right: select your app from the dropdown.
3. Click **Generate Access Token**. Approve the popup.
4. Add these permissions (Add permissions dropdown), then regenerate:
   - `instagram_basic`
   - `instagram_content_publish`
   - `pages_show_list`
   - `pages_read_engagement`
   - `business_management`
5. You now have a **short-lived user token** (about 1 hour). Keep this tab open.

### 4a. Find your Facebook Page ID

In the Explorer, run a GET on:

```
me/accounts
```

The response lists your Pages. Copy the `id` of your Local Traffic AI Page.
Call it `PAGE_ID`.

### 4b. Find your Instagram Business ID

Run a GET on (swap in your PAGE_ID):

```
{PAGE_ID}?fields=instagram_business_account
```

The response has `instagram_business_account.id`. That number is your
**IG_BUSINESS_ID**. Save it.

### 4c. Upgrade to a long-lived token (about 60 days)

Short-lived tokens die in an hour. Exchange it for a long-lived one. Replace
the placeholders and run this in a terminal:

```bash
curl -s "https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=YOUR_APP_ID&client_secret=YOUR_APP_SECRET&fb_exchange_token=YOUR_SHORT_LIVED_TOKEN"
```

- `YOUR_APP_ID` and `YOUR_APP_SECRET` are in your Meta app → **Settings → Basic**.
- `YOUR_SHORT_LIVED_TOKEN` is the one from the Explorer.

The response `access_token` is your **IG_ACCESS_TOKEN** (lasts ~60 days).

> Token refresh: long-lived tokens expire in ~60 days. Set a calendar reminder
> for day 50 to re-run the exchange, or add an n8n cron that refreshes it
> monthly and writes the new value back to your credential store. Do not let it
> lapse or posting silently stops.

## Part 5: Host your assets so Instagram can fetch them

The Graph API does not accept a file upload for images. It needs a **public
`image_url`** it can fetch from its own servers. So the rendered files in
`content/assets/` have to live somewhere public.

Pick one:

- **Cloudflare R2 / AWS S3** (recommended): upload the assets folder, make the
  bucket/objects public-read, use the bucket URL.
- **A static host / your own site**: drop the files under
  `https://yourdomain.com/ig-assets/`.

Whatever you pick, the public base URL becomes `ASSET_BASE_URL`. The workflow
builds each image URL as `ASSET_BASE_URL/{filename}`, where the filename matches
exactly what `generate.js` produced (e.g. `2026-06-08_post-01_education.png`).

## Part 6: Configure n8n

1. Import `automation/n8n-workflow.json` (n8n → **Workflows → Import from File**).
2. Open n8n **Settings → Variables / Environment** (or set OS env on the n8n
   host) and add:

   | Variable          | Value                                                        |
   |-------------------|--------------------------------------------------------------|
   | `IG_BUSINESS_ID`  | from step 4b                                                 |
   | `IG_ACCESS_TOKEN` | long-lived token from step 4c                                |
   | `ASSET_BASE_URL`  | public base URL of your hosted assets (step 5), no trailing slash |
   | `CALENDAR_JSON`   | the full contents of `content/calendar.json` as one string  |

   > Prefer not to paste the whole calendar into an env var? Delete the env
   > fallback and wire an n8n **Read/Write Files from Disk** node (or an HTTP
   > Request fetching the raw calendar.json) into the "Pick Today's Post" node
   > so it arrives on `$json.calendar`. The Code node supports both.

3. Set the n8n instance timezone to **America/New_York** (Settings → matches the
   calendar's timezone) so the 9am cron and the "today" lookup agree.
4. Open the workflow, click **Execute Workflow** once to dry-run today's post.
   If today has no scheduled entry, it ends at "Nothing Scheduled" (expected).
5. When happy, toggle the workflow **Active**.

---

## Rate limits and the rules that bite

Read these once so nothing surprises you.

- **25 posts per 24 hours.** Each IG Business account can publish a maximum of
  **25 API posts in a rolling 24-hour window** (`media_publish` calls). This
  calendar posts once a day, so you are nowhere near it. It matters if you ever
  batch-publish or run catch-up. Don't loop publishes without a counter.
- **Graph API call volume** is governed by Meta's app-level rate limiting (calls
  scale with your number of users/impressions). One post a day is trivial. If
  you see error code `4` or `17` (rate limit), back off and retry later.
- **`image_url` must be publicly reachable** by Facebook's servers, be a real
  JPEG/PNG, and not be behind auth. Localhost, signed-expiring URLs, and
  private buckets will fail with a vague container error.
- **Image specs**: aspect ratio between 4:5 and 1.91:1 (our 1:1 squares are
  fine), under 8MB, JPEG/PNG. Oversized files fail at the container step.
- **Two-step publish**: you create a container, then publish it. The workflow
  waits 30s between the two so IG can fetch and process the image. For carousels
  or video you'd poll the container's `status_code` until `FINISHED` instead.
- **Caption limit**: 2,200 characters and up to 30 hashtags. Our captions sit
  well under both.
- **No editing via API**: published posts can't be edited through the API.
  Delete and repost if you must change one.
- **Business account is mandatory.** A personal account cannot use
  `instagram_content_publish`. If publish returns a permissions error, recheck
  Part 1 and that the token has `instagram_content_publish`.

## Quick troubleshooting

| Symptom | Likely cause |
|---|---|
| Container creation fails | `image_url` not public, wrong size/format, or expired token |
| Publish returns permission error | account not Business, or token missing `instagram_content_publish` |
| Posts stop after ~2 months | long-lived token expired, re-run the exchange (step 4c) |
| Wrong day posts | n8n timezone not set to America/New_York |
| Nothing posts, no error | no calendar entry matches today's date (expected after the 30-day run ends) |
