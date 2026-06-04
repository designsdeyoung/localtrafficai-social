# @localtrafficai: Instagram Launch System

The Instagram launch kit for **Local Traffic AI** ([localtrafficai.com](https://localtrafficai.com)),
AI-powered local SEO for home service businesses: plumbers, HVAC, roofers,
electricians, and the rest of the trades.

Everything here is built to get the account live and posting on autopilot:
brand kit, a 30-day content calendar, an image generator wired to Higgsfield,
and an n8n workflow that posts to Instagram on schedule.

## What's in here

```
brand/
  bio.md                 3 IG bio options (under 150 chars) + profile fields
  profile-pic-prompt.md  Higgsfield prompt for the logo-style avatar
  voice.md               tone rules. Read this before writing anything
content/
  calendar.json          30-day calendar: hooks, captions, hashtags, visual prompts
  generate.js            reads the calendar, drives Higgsfield, saves assets
  assets/                rendered post images land here
automation/
  n8n-workflow.json      pulls today's post + asset, publishes to Instagram
  SETUP.md               exact steps to connect the IG Graph API + n8n
.env.example             every secret this repo touches, named and stubbed
```

## Launch checklist

Do these in order. The profile setup is manual (one time), the rest runs itself.

### 1. Set up the profile (Instagram app, 10 min)

- [ ] **Profile picture**, generate the avatar from `brand/profile-pic-prompt.md`
      (Higgsfield, `nano_banana_2`, 1:1). Run the 110px test. Upload at 1080x1080.
- [ ] **Bio**, pick one option from `brand/bio.md`, paste it into Edit Profile.
- [ ] **Name field**, set to `Local Traffic AI · Local SEO` (it's searchable).
- [ ] **Link in bio**, website field: `https://localtrafficai.com`
- [ ] **Contact button**, add Email so prospects can reach you without a DM.
- [ ] **Switch to a Business account**, required for auto-posting. See
      `automation/SETUP.md` Part 1.

### 2. Generate the visuals

```bash
# Agent mode (no API key): builds the manifest for Claude + the Higgsfield MCP
node content/generate.js
# then tell the agent: "generate the assets from content/assets/manifest.json"

# OR headless REST mode (set the key first):
export HIGGSFIELD_API_KEY=...        # see .env.example
node content/generate.js --rest
```

- [ ] Run `generate.js` to produce all 30 visuals into `content/assets/`.
- [ ] **Review every asset.** Check it reads at thumbnail size, on-brand colors
      (orange `#f97316`, green `#4ade80`, near-black `#0a0a0a`), no garbled text.
- [ ] Regenerate any weak ones: `node content/generate.js --only 6,14 --force`.

### 3. Wire up posting

- [ ] Host `content/assets/` somewhere public (see `SETUP.md` Part 5) and note
      the `ASSET_BASE_URL`.
- [ ] Follow `automation/SETUP.md` to get `IG_BUSINESS_ID` and `IG_ACCESS_TOKEN`.
- [ ] Import `automation/n8n-workflow.json` into n8n, set the env vars, set the
      instance timezone to `America/New_York`.
- [ ] **Execute Workflow** once as a dry run. Confirm it posts (or cleanly ends
      if today has no scheduled entry).

### 4. Go live

- [ ] Toggle the n8n workflow **Active**. It posts the scheduled entry daily at
      9am ET and stops on days with nothing scheduled.
- [ ] Day 50: refresh the long-lived token (`SETUP.md` step 4c) so posting
      doesn't lapse around the 60-day mark.

## How the pieces connect

```
calendar.json ──> generate.js ──> content/assets/*.png ──> (public host)
      │                                                          │
      └──────────────> n8n-workflow.json ──> Instagram Graph API ┘
        (reads today's caption + hashtags)     (container -> publish)
```

`generate.js` reuses the Artisan agent pattern: a JSON queue drives the work,
each item goes to Higgsfield (`nano_banana_2` for stills, `soul` for the
cinematic proof frames), jobs are polled, finished assets are saved with
deterministic filenames the n8n workflow can find.

## Notes

- All copy follows `brand/voice.md`: no em dashes, no corporate filler, written
  like an operator talking to other small business owners.
- The calendar runs `2026-06-08` through `2026-07-07`. Duplicate the pattern and
  shift dates for month two.
- Secrets are never committed. Copy `.env.example` to `.env` and fill it in.
