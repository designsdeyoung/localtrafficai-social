// PUBLISH=1 is required for live calls. Preview mode is entirely offline.
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const STATE = 'content/publishing-state.json';
const GRAPH = 'https://graph.facebook.com/v21.0';
const wait = ms => new Promise(r => setTimeout(r, ms));
function todayET(now = new Date()) {
  const p = new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const get = k => p.find(x => x.type === k).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function redact(message, token = process.env.IG_ACCESS_TOKEN || '') {
  let s = String(message);
  if (token) s = s.split(token).join('[REDACTED]');
  return s.replace(/access_token=[^&\s]+/g,'access_token=[REDACTED]');
}
async function graph(endpoint, params={}, method='GET') {
  if (!process.env.IG_ACCESS_TOKEN) throw new Error('Missing IG_ACCESS_TOKEN in repository Actions secrets.');
  const url = new URL(`${GRAPH}/${endpoint}`);
  const init = {method,headers:{Authorization:`Bearer ${process.env.IG_ACCESS_TOKEN}`},signal:AbortSignal.timeout(30000)};
  if (method === 'GET') for (const [k,v] of Object.entries(params)) url.searchParams.set(k,v);
  else {init.headers['Content-Type']='application/x-www-form-urlencoded';init.body=new URLSearchParams(params);}
  const r = await fetch(url,init);
  let body;
  try {body=await r.json();} catch {throw new Error(`Instagram returned non-JSON HTTP ${r.status}.`);}
  if (!r.ok || body.error) {
    const e=body.error || {};
    const hint=e.code===190?' Reconnect Instagram and replace IG_ACCESS_TOKEN in Actions secrets.':'';
    throw new Error(redact(`Instagram HTTP ${r.status}, code ${e.code || 'unknown'}: ${e.message || 'request failed'}.${hint}`));
  }
  return body;
}
function git(args) {return execFileSync('git',args,{cwd:ROOT,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}
function saveState(state,assetPath) {
  fs.writeFileSync(path.join(ROOT,STATE),JSON.stringify(state,null,2)+'\n');
  git(['add','--',STATE,...(assetPath?[assetPath]:[])]);
  if (git(['diff','--cached','--name-only'])) {
    git(['-c','user.name=LocalTrafficAI Automation','-c','user.email=41898282+github-actions[bot]@users.noreply.github.com','commit','-m','Record Instagram posting progress [skip ci]']);
    git(['push','origin','HEAD:main']);
  }
  return git(['rev-parse','HEAD']);
}
async function verifyImage(url,fetcher=fetch,pause=wait) {
  for(let attempt=0;attempt<5;attempt++) {
    try {
      const r=await fetcher(url,{signal:AbortSignal.timeout(20000)});
      const b=Buffer.from(await r.arrayBuffer());
      if(r.ok && b.length>1000 && b.length<8*1024*1024 && b[0]===255 && b[1]===216 && b[2]===255) return;
    } catch {}
    if(attempt<4) await pause(5000);
  }
  throw new Error('Generated JPEG is not publicly downloadable. Nothing was published.');
}
async function publishEntry(entry,{api,save,verify,pause=wait,ig}) {
  if(entry.status==='published') return entry;
  if(entry.status==='publishing') {
    const recent=await api(`${ig}/media`,{fields:'id,caption,timestamp,permalink',limit:'25'});
    const match=(recent.data||[]).find(m=>m.caption===entry.post.caption && Date.parse(m.timestamp)>=Date.parse(entry.created_at)-60000);
    if(match) {
      Object.assign(entry,{status:'published',media_id:match.id,permalink:match.permalink,published_at:match.timestamp});
      await save();return entry;
    }
    const s=await api(entry.container_id,{fields:'status_code'});
    if(s.status_code==='PUBLISHED') {
      Object.assign(entry,{status:'published',published_at:new Date().toISOString(),reconciled:true});
      await save();return entry;
    }
    throw new Error(`Publish outcome uncertain for ${entry.post.date}. Check Instagram before clearing this entry. No duplicate publish attempted.`);
  }
  if(!entry.container_id) {
    await verify(entry.image_url);
    const c=await api(`${ig}/media`,{image_url:entry.image_url,caption:entry.post.caption},'POST');
    if(!c.id) throw new Error('Instagram did not return a container ID.');
    entry.container_id=c.id;entry.status='container_created';await save();
  }
  let ready=false;
  for(let i=0;i<30;i++) {
    const s=await api(entry.container_id,{fields:'status_code'});
    if(s.status_code==='FINISHED'){ready=true;break;}
    if(s.status_code==='PUBLISHED'){entry.status='published';entry.reconciled=true;await save();return entry;}
    if(['ERROR','EXPIRED'].includes(s.status_code)) throw new Error(`Instagram container ${s.status_code}. Nothing new was published.`);
    await pause(4000);
  }
  if(!ready) throw new Error('Instagram processing timed out. Container saved for retry.');
  entry.status='publishing';await save();
  const result=await api(`${ig}/media_publish`,{creation_id:entry.container_id},'POST');
  if(!result.id) throw new Error('Publish outcome uncertain: Instagram returned no media ID.');
  Object.assign(entry,{status:'published',media_id:result.id,published_at:new Date().toISOString()});
  await save();return entry;
}
async function main() {
  const live=process.env.PUBLISH==='1';
  const date=process.env.TEST_DATE || todayET();
  if(live && date!==todayET()) throw new Error('Backdated live posts are disabled. Use preview mode.');
  if(live && (process.env.GITHUB_ACTIONS!=='true' || process.env.GITHUB_REF!=='refs/heads/main' || process.env.GITHUB_REPOSITORY!=='designsdeyoung/localtrafficai-social')) throw new Error('Live publishing requires GitHub Actions on designsdeyoung/localtrafficai-social main.');
  const output=path.join(ROOT,'.output');fs.mkdirSync(output,{recursive:true});
  const render=()=>execFileSync('python',['automation/render-post.py','--date',date,'--output','.output'],{cwd:ROOT,stdio:'inherit'});
  if(!live){render();console.log('Preview complete. No Instagram requests or repository writes.');return;}
  const ig=process.env.IG_BUSINESS_ID;
  if(!ig || !/^\d+$/.test(ig)) throw new Error('Missing or invalid IG_BUSINESS_ID in repository Actions secrets.');
  const profile=await graph(ig,{fields:'id,username'});
  if(profile.username?.toLowerCase()!=='localtrafficai') throw new Error('Account mismatch. Expected @localtrafficai. Nothing was published.');
  console.log('Verified @localtrafficai.');
  git(['pull','--ff-only','origin','main']);
  const statePath=path.join(ROOT,STATE);
  const state=fs.existsSync(statePath)?JSON.parse(fs.readFileSync(statePath,'utf8')):{version:1,posts:{}};
  if(state.version!==1 || !state.posts) throw new Error('Invalid publishing-state.json.');
  const services={api:graph,save:()=>saveState(state),verify:verifyImage,ig};
  for(const old of Object.values(state.posts)) if(old.status==='publishing') await publishEntry(old,services);
  let entry=state.posts[date];
  if(entry?.status==='published'){console.log('Already posted for',date,'media:',entry.media_id||entry.container_id);return;}
  if(!entry) {
    render();
    const post=JSON.parse(fs.readFileSync(path.join(output,'post.json'),'utf8'));
    const assetPath=`content/assets/autopilot/${date}.jpg`;
    fs.mkdirSync(path.dirname(path.join(ROOT,assetPath)),{recursive:true});
    fs.copyFileSync(path.join(output,'post.jpg'),path.join(ROOT,assetPath));
    entry={status:'prepared',created_at:new Date().toISOString(),post,asset_path:assetPath};state.posts[date]=entry;
    const sha=saveState(state,assetPath);
    entry.image_url=`https://raw.githubusercontent.com/designsdeyoung/localtrafficai-social/${sha}/${assetPath}`;
    saveState(state);
  } else if(!entry.image_url) {
    entry.image_url=`https://raw.githubusercontent.com/designsdeyoung/localtrafficai-social/${git(['rev-parse','HEAD'])}/${entry.asset_path}`;
    saveState(state);
  }
  const result=await publishEntry(entry,services);
  console.log('PUBLISHED',date,'media:',result.media_id||result.container_id);
  if(process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,`Published @localtrafficai for ${date}. Media: ${result.media_id||'reconciled from container'}\n`);
}
if(require.main===module) main().catch(e=>{
  // Avoid printing subprocess output that may contain credentialed git URLs.
  const message=e.stderr || e.cmd ? 'Repository sync failed. Publishing stopped. Check Actions Contents write access and branch permissions.' : redact(e.message||e);
  console.error(message);
  if(process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,`Instagram autopilot needs attention: ${message}\n`);
  process.exitCode=1;
});
module.exports={todayET,redact,verifyImage,publishEntry};
