const { test }=require('node:test');
const assert=require('node:assert/strict');
const { JSDOM }=require('jsdom');
const { read,worker,until }=require('./helpers.cjs');
const base=`<form method="post" action="https://github.com/repositories/imports"><input id="vcs_url" name="vcs_url" required><input id="repository_name" name="repository[name]" required><input id="repository_visibility_public" type="radio" name="repository[visibility]" value="public" checked><input id="repository_visibility_private" type="radio" name="repository[visibility]" value="private"><button type="submit">Import</button></form>`;
// Structure observed on GitHub's signed-in /new/import page on 2026-09-26.
const modern=`<react-app app-name="repo-creation" initial-path="/new/import"><form novalidate><input name="The URL for your source repository"><input id="repository-name-input"><input type="radio" name="visibilityGroup" value="public" checked><input type="radio" name="visibilityGroup" value="private"><div class="InfoMessage-module__InfoMessage__fixture">You are creating a public repository in your personal account.</div><button type="submit">Begin import</button></form></react-app>`;
async function page(options={}){
 const w=worker();if(options.auto===false)w.local.state.settings.autoSubmit=false;
 const a=await w.start();const dom=new JSDOM(options.html||base,{url:'https://github.com/new/import'+(options.hash??'#f2p_task='+a.taskId),runScripts:'outside-only'});
 const win=dom.window,ticks=new Map();let intervalId=0,submits=0,nativeSubmitting=false,githubSubmits=0,nativeGetPrevented=false;
 if(options.react){
  const app=win.document.querySelector('react-app');
  app.addEventListener('change',event=>{
   if(event.target.name==='visibilityGroup' && !options.staleReactState)app.querySelector('[class*="InfoMessage-module__InfoMessage__"]').textContent=`You are creating a ${event.target.value} repository in your personal account.`;
  });
  app.addEventListener('submit',event=>{githubSubmits++;nativeGetPrevented=event.defaultPrevented;event.preventDefault();});
 }
 win.chrome={runtime:{sendMessage:msg=>w.send(msg,w.sender(a.tabId))}};
 const nativeTimeout=win.setTimeout.bind(win);
 win.setTimeout=(fn,ms)=>nativeTimeout(fn,ms===10000?20:ms===200?0:ms);
 win.setInterval=fn=>{ticks.set(++intervalId,fn);return intervalId;};win.clearInterval=id=>ticks.delete(id);
 win.HTMLFormElement.prototype.requestSubmit=function(button){
  assert.equal(button.form,this);if(nativeSubmitting)return;
  nativeSubmitting=true;
  try{if(this.dispatchEvent(new win.Event('submit',{bubbles:true,cancelable:true})))submits++;}
  finally{setTimeout(()=>{nativeSubmitting=false;},0);}
 };
 win.eval(read('shared.js'));win.eval(read('content_import.js'));
 await new Promise(resolve=>setTimeout(resolve,35));
 return {w,a,dom,win,ticks,submits:()=>submits,githubSubmits:()=>githubSubmits,nativeGetPrevented:()=>nativeGetPrevented,async tick(){for(let i=0;i<3;i++)for(const fn of [...ticks.values()])fn();await new Promise(resolve=>setTimeout(resolve,10));}};
}
test('real DOM form is filled, Private selected, and only a submission attempt is recorded',async()=>{
 const p=await page();try{assert.equal(p.win.document.querySelector('#vcs_url').value,'https://github.com/example/demo.git');await p.tick();assert.equal(p.submits(),1);assert.equal(p.w.local.state.history[0].status,'submission_requested');await p.tick();assert.equal(p.submits(),1);}finally{p.dom.window.close();}
});
for(const [name,html] of [['missing source',base.replace('<input id="vcs_url" name="vcs_url" required>','')],['missing name',base.replace('<input id="repository_name" name="repository[name]" required>','')],['missing private',base.replace('<input id="repository_visibility_private" type="radio" name="repository[visibility]" value="private">','')],['wrong action',base.replace('https://github.com/repositories/imports','https://evil.example/import')],['different form',base.replace('<input id="repository_visibility_private"','</form><form method="post" action="https://github.com/new/import"><input id="repository_visibility_private"')]]){
 test(name+' stops the import',async()=>{const p=await page({html});try{await p.tick();assert.equal(p.submits(),0);assert.match(p.win.document.body.textContent,/已停止自动导入/);assert.equal(p.w.local.state.history[0].status,'needs_attention');}finally{p.dom.window.close();}});
}
test('switching to Public or editing source during countdown stops submission',async()=>{
 for(const modify of [win=>win.document.querySelector('#repository_visibility_public').click(),win=>{win.document.querySelector('#vcs_url').value='https://github.com/example/other';}]){
  const p=await page();try{modify(p.win);await p.tick();assert.equal(p.submits(),0);assert.equal(p.w.local.state.history[0].status,'needs_attention');}finally{p.dom.window.close();}
 }
});
test('legacy external hash cannot claim a task or submit',async()=>{const p=await page({hash:'#f2p=1&src=https://github.com/example/demo&name=demo&auto=1'});try{assert.equal(p.ticks.size,0);assert.equal(p.submits(),0);assert.equal(p.win.document.querySelector('#vcs_url').value,'');}finally{p.dom.window.close();}});
test('auto off and cancel prevent countdown while manual confirmation remains available',async()=>{
 for(const mode of ['off','cancel']){
  const p=await page({auto:mode!=='off'});try{
   if(mode==='cancel')p.win.document.querySelector('.f2p-banner-cancel-btn').click();
   await p.tick();assert.equal(p.submits(),0);
   p.win.document.querySelector('.f2p-banner-btn').click();await until(()=>p.submits()===1);assert.equal(p.w.local.state.history[0].status,'submission_requested');
  }finally{p.dom.window.close();}
 }
});

test('native GitHub submit uses the same guard, records attempt and cancels countdown',async()=>{
 const p=await page();try{
  const form=p.win.document.querySelector('form');
  form.requestSubmit(form.querySelector('button[type=submit]'));
  assert.equal(p.submits(),0);
  await until(()=>p.submits()===1);await p.tick();
  assert.equal(p.submits(),1);assert.equal(p.w.local.state.history[0].status,'submission_requested');
 }finally{p.dom.window.close();}
});
for(const attribute of ['formaction="https://evil.example/upload"','formmethod="get"','formnovalidate']){
 test('submitter override is rejected: '+attribute,async()=>{
  const p=await page({html:base.replace('<button type="submit">','<button type="submit" '+attribute+'>')});
  try{await p.tick();assert.equal(p.submits(),0);assert.match(p.win.document.body.textContent,/已停止自动导入/);}finally{p.dom.window.close();}
 });
}

test('current GitHub React importer receives one guarded submission and cannot fall back to GET',async()=>{
 const p=await page({html:modern,react:true});try{
  assert.equal(p.win.document.querySelector('input[name="The URL for your source repository"]').value,'https://github.com/example/demo.git');
  assert.equal(p.win.document.querySelector('#repository-name-input').value,'demo-private');
  await p.tick();assert.equal(p.githubSubmits(),1);assert.equal(p.submits(),0);assert.equal(p.nativeGetPrevented(),true);
  assert.equal(p.w.local.state.history[0].status,'submission_requested');
  await p.tick();assert.equal(p.githubSubmits(),1);
 }finally{p.dom.window.close();}
});
test('React native button follows the same guarded path',async()=>{
 const p=await page({html:modern,react:true,auto:false});try{
  const form=p.win.document.querySelector('form');form.requestSubmit(form.querySelector('button'));
  await until(()=>p.githubSubmits()===1);assert.equal(p.nativeGetPrevented(),true);assert.equal(p.submits(),0);
 }finally{p.dom.window.close();}
});
test('React app without its submit handler never sends a native GET',async()=>{
 const p=await page({html:modern.replace('creating a public','creating a private')});try{
  await p.tick();assert.equal(p.submits(),0);
 }finally{p.dom.window.close();}
});
test('React checked radio with stale public app state is blocked',async()=>{
 const p=await page({html:modern,react:true,staleReactState:true});try{
  await p.tick();assert.equal(p.githubSubmits(),0);assert.equal(p.submits(),0);assert.equal(p.w.local.state.history[0].status,'needs_attention');
 }finally{p.dom.window.close();}
});
test('React switching to Public during the countdown is blocked',async()=>{
 const p=await page({html:modern,react:true});try{
  p.win.document.querySelector('[value="public"]').click();await p.tick();assert.equal(p.githubSubmits(),0);assert.equal(p.submits(),0);
 }finally{p.dom.window.close();}
});
for(const [label,html] of [
 ['wrong app identity',modern.replace('app-name="repo-creation"','app-name="other"')],
 ['wrong page identity',modern.replace('initial-path="/new/import"','initial-path="/new"')],
 ['explicit GET action',modern.replace('<form novalidate>','<form action="https://github.com/new/import" novalidate>')],
 ['external action',modern.replace('<form novalidate>','<form action="https://evil.example/" novalidate>')],
 ['submitter override',modern.replace('<button type="submit">','<button type="submit" formaction="https://evil.example/">')],
 ['duplicate source',modern.replace('<input id="repository-name-input">','<input name="The URL for your source repository"><input id="repository-name-input">')]
])test('React '+label+' is rejected',async()=>{
 const p=await page({html,react:true});try{await p.tick();assert.equal(p.githubSubmits(),0);assert.equal(p.submits(),0);assert.equal(p.w.local.state.history[0].status,'needs_attention');}finally{p.dom.window.close();}
});
