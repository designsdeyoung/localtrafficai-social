const test=require('node:test');
const assert=require('node:assert/strict');
const {todayET,redact,verifyImage,publishEntry}=require('./post-today');
const fresh=()=>({status:'prepared',created_at:'2026-09-26T12:00:00Z',image_url:'https://example.com/post.jpg',post:{date:'2026-09-26',caption:'A test caption'}});
const noWait=async()=>{};
test('Eastern date handles midnight and both DST seasons',()=>{
  assert.equal(todayET(new Date('2026-09-26T02:00:00Z')),'2026-09-25');
  assert.equal(todayET(new Date('2026-12-26T04:30:00Z')),'2026-12-25');
  assert.equal(todayET(new Date('2026-07-26T04:30:00Z')),'2026-07-26');
});
test('missing images never create a container',async()=>{
  let calls=0;
  await assert.rejects(()=>publishEntry(fresh(),{ig:'1',api:async()=>{calls++;},save:noWait,verify:async()=>{throw Error('missing image');}}),/missing image/);
  assert.equal(calls,0);
});
test('successful publishing persists checkpoints and publishes once',async()=>{
  const entry=fresh(),stages=[],calls=[];
  const api=async(endpoint,p,method)=>{calls.push(endpoint);if(endpoint==='1/media')return{id:'container'};if(endpoint==='container')return{status_code:'FINISHED'};if(endpoint==='1/media_publish')return{id:'media'};throw Error(endpoint);};
  const services={ig:'1',api,verify:noWait,pause:noWait,save:async()=>stages.push(entry.status)};
  await publishEntry(entry,services);await publishEntry(entry,services);
  assert.deepEqual(stages,['container_created','publishing','published']);
  assert.equal(calls.filter(x=>x==='1/media_publish').length,1);
  assert.equal(entry.media_id,'media');
});
test('failed durable checkpoint prevents the publish side effect',async()=>{
  let published=false;
  const e=fresh();
  await assert.rejects(()=>publishEntry(e,{ig:'1',verify:noWait,pause:noWait,save:async()=>{if(e.status==='publishing')throw Error('git push failed');},api:async p=>{if(p==='1/media')return{id:'c'};if(p==='c')return{status_code:'FINISHED'};published=true;}}),/git push failed/);
  assert.equal(published,false);
});
test('processing timeout does not publish an unfinished container',async()=>{
  let publish=0;
  await assert.rejects(()=>publishEntry(fresh(),{ig:'1',save:noWait,verify:noWait,pause:noWait,api:async p=>{if(p==='1/media')return{id:'c'};if(p==='1/media_publish')publish++;return{status_code:'IN_PROGRESS'};}}),/timed out/);
  assert.equal(publish,0);
});
test('ambiguous publish is reconciled by recent media without posting again',async()=>{
  const e={...fresh(),status:'publishing',container_id:'c'};
  const result=await publishEntry(e,{ig:'1',save:noWait,verify:noWait,api:async(p,params,method)=>{
    assert.notEqual(method,'POST');return{data:[{id:'existing',caption:e.post.caption,timestamp:'2026-09-26T12:03:00Z',permalink:'https://instagram.com/p/test'}]};
  }});
  assert.equal(result.media_id,'existing');assert.equal(result.status,'published');
});
test('unresolved publish blocks a duplicate attempt',async()=>{
  const e={...fresh(),status:'publishing',container_id:'c'};
  await assert.rejects(()=>publishEntry(e,{ig:'1',save:noWait,verify:noWait,api:async(p,params,method)=>{assert.notEqual(method,'POST');return p==='1/media'?{data:[]}:{status_code:'FINISHED'};}}),/uncertain/);
});
test('auth failure is surfaced before publication',async()=>{
  await assert.rejects(()=>publishEntry(fresh(),{ig:'1',save:noWait,verify:noWait,api:async()=>{throw Error('Instagram code 190: token expired');}}),/token expired/);
});
test('public image check rejects HTML and accepts JPEG bytes',async()=>{
  await assert.rejects(()=>verifyImage('https://example.com',async()=>({ok:true,arrayBuffer:async()=>Buffer.from('<html>missing</html>')}),noWait),/not publicly downloadable/);
  const b=Buffer.alloc(2000);b[0]=255;b[1]=216;b[2]=255;
  await verifyImage('https://example.com',async()=>({ok:true,arrayBuffer:async()=>b}),noWait);
});
test('errors redact credentials',()=>assert.equal(redact('token SECRET access_token=OTHER&x=1','SECRET'),'token [REDACTED] access_token=[REDACTED]&x=1'));
