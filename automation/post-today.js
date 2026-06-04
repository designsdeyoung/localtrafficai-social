// Daily Instagram poster. Picks today's post from content/calendar.json and
// publishes it to the IG Business account via the Instagram Graph API.
// Env: IG_BUSINESS_ID, IG_ACCESS_TOKEN, ASSET_BASE_URL, optional DRY_RUN=1
const fs = require("fs");
const path = require("path");

const TOKEN = process.env.IG_ACCESS_TOKEN;
const IG = process.env.IG_BUSINESS_ID;
const ASSET_BASE = (process.env.ASSET_BASE_URL || "").replace(/\/$/, "");
const DRY = process.env.DRY_RUN === "1";
const G = "https://graph.facebook.com/v21.0";

if (!TOKEN || !IG) {
  console.error("Missing IG_ACCESS_TOKEN or IG_BUSINESS_ID");
  process.exit(1);
}

function todayET() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

async function main() {
  const cal = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "content", "calendar.json"), "utf8"));
  const today = process.env.TEST_DATE || todayET();
  const post = (cal.posts || []).find((p) => p.date === today && !p.posted);
  if (!post) {
    console.log("Nothing scheduled for", today);
    return;
  }
  const imageUrl = `${ASSET_BASE}/${post.image_file}`;
  console.log("Posting", today, "| pillar:", post.pillar, "| image:", imageUrl);

  const cRes = await fetch(`${G}/${IG}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ image_url: imageUrl, caption: post.caption, access_token: TOKEN }),
  });
  const c = await cRes.json();
  if (!c.id) throw new Error("Container failed: " + JSON.stringify(c.error || c));
  console.log("Container:", c.id);

  if (DRY) {
    console.log("DRY_RUN set, not publishing.");
    return;
  }

  for (let i = 0; i < 12; i++) {
    const s = await (await fetch(`${G}/${c.id}?fields=status_code&access_token=${TOKEN}`)).json();
    if (s.status_code === "FINISHED") break;
    if (s.status_code === "ERROR") throw new Error("Container processing error");
    await new Promise((r) => setTimeout(r, 3000));
  }

  const pub = await (await fetch(`${G}/${IG}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ creation_id: c.id, access_token: TOKEN }),
  })).json();
  if (!pub.id) throw new Error("Publish failed: " + JSON.stringify(pub.error || pub));
  console.log("PUBLISHED media id:", pub.id);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
