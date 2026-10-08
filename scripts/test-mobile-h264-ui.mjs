import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
const root='http://127.0.0.1:28088';
const env=await readFile('D:/codex/jingcang/.env','utf8');
const password=/^JINGCANG_ADMIN_INITIAL_PASSWORD=(.+)$/m.exec(env)?.[1]?.trim();
if(!password)throw Error('Dev login is not configured');
const auth=await fetch(root+'/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password})});
if(!auth.ok)throw Error('Dev API authentication failed');
const headers={Cookie:auth.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ')};
const inventory=await fetch(root+'/api/v1/mobile/devices',{headers}).then(x=>x.json());
const device=(inventory.data?.devices||[]).find(x=>x.available&&x.booted&&x.state==='device');
const borrowedSessionId=process.env.JINGCANG_H264_UI_EXISTING_SESSION;
if(!device&&!borrowedSessionId){console.log('H264_UI_SKIPPED_NO_FREE_DEVICE=YES');process.exit(0)}
let sessionId=borrowedSessionId;
let createdHere=false;
const directory=await mkdtemp(path.join(tmpdir(),'jc-h264-ui-'));
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--disable-extensions','--disable-background-networking','--no-sandbox','--remote-allow-origins=*','--remote-debugging-port=19355','--user-data-dir='+path.join(directory,'profile'),root+'/mobile'],{windowsHide:true,stdio:'ignore'});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let ws;
try{
 let target;
 for(let i=0;i<35;i++){
  try{const list=await fetch('http://127.0.0.1:19355/json/list').then(x=>x.json());target=list.find(x=>x.type==='page'&&x.url.includes(':28088'));if(target)break}catch{}
  await sleep(200);
 }
 if(!target)throw Error('Chrome headless page not available');
 ws=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true})});
 let nextId=0;const waiting=new Map();
 ws.addEventListener('message',event=>{
  const msg=JSON.parse(event.data),resolve=waiting.get(msg.id);
  if(resolve){waiting.delete(msg.id);resolve(msg.result?.result?.value??msg.result?.exceptionDetails?.text??'NO_RESULT');}
 });
 const evalJs=(expression,awaitPromise=false)=>new Promise(resolve=>{
  const id=++nextId;waiting.set(id,resolve);
  ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise,returnByValue:true}}));
 });
 for(let i=0;i<40;i++){
  const baseUri=await evalJs('document.baseURI');
  if(typeof baseUri==='string'&&baseUri.startsWith(root+'/'))break;
  await sleep(200);
 }
 const loggedIn=await evalJs("(async()=>{const res=await fetch('/api/v1/auth/login',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:"+JSON.stringify(password)+"})});return res.status})()",true);
 if(loggedIn!==200){console.log('H264_UI_LOGIN_RESULT='+JSON.stringify(loggedIn));console.log('H264_UI_PAGE_URL='+await evalJs('location.href'));console.log('H264_UI_BASE_URI='+await evalJs('document.baseURI'));console.log('H264_UI_DOC_TITLE='+await evalJs('document.title'));throw Error('Headless browser login failed');}
 if(!sessionId){
  const created=await fetch(root+'/api/v1/mobile/sessions',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({deviceId:device.id,nodeId:device.nodeId,mode:'phone'})});
  if(!created.ok)throw Error('Cannot create isolated device lease');
  sessionId=(await created.json()).data.id;createdHere=true;
 }
 await evalJs("location.assign('/mobile')");
 let selected=false,decoded=false,last='none',selectedAt=0;
 for(let i=0;i<70;i++){
  const state=await evalJs("JSON.stringify({title:document.querySelector('h1')?.textContent,buttons:[...document.querySelectorAll('button')].filter(b=>b.textContent?.includes('连接画面')).length,canvas:(()=>{const c=document.querySelector('canvas[aria-label=\"Android H.264 视频画面\"]');return c?{width:c.width,height:c.height}:null})(),text:document.querySelector('[role=alert]')?.textContent})");
  try{
   const value=JSON.parse(state);last=state;
   if(!selected&&value.buttons>0){
    await evalJs("[...document.querySelectorAll('button')].find(b=>b.textContent?.includes('连接画面'))?.click()");
    selected=true;selectedAt=Date.now();console.log('H264_UI_SESSION_SELECTED=PASS');
   }
   if(value.canvas?.width>300&&value.canvas?.height>150){decoded=true;console.log('H264_UI_DECODED_CANVAS=PASS '+value.canvas.width+'x'+value.canvas.height);console.log('H264_UI_FIRST_FRAME_MS='+(Date.now()-selectedAt));break;}
  }catch{}
  await sleep(350);
 }
 if(!decoded)throw Error('Canvas did not render H264 frame: '+last);
}finally{
 ws?.close();
 await exec('taskkill',['/PID',String(chrome.pid),'/T','/F'],{windowsHide:true}).catch(()=>{});
 if(createdHere&&sessionId)await fetch(root+'/api/v1/mobile/sessions/'+encodeURIComponent(sessionId),{method:'DELETE',headers}).catch(()=>{});
 await rm(directory,{recursive:true,force:true}).catch(()=>{});
}
