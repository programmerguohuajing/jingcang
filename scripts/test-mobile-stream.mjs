import {readFile} from 'node:fs/promises';
const root='D:/codex/jingcang';
const data=await readFile(root+'/.env','utf8');
const match=/^JINGCANG_ADMIN_INITIAL_PASSWORD=(.+)$/m.exec(data);
if(!match)throw Error('Missing dev password');
const base='http://127.0.0.1:28088';
const login=await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:match[1].trim()})});
if(!login.ok)throw Error('Unable to login to isolated dev environment');
const cookie=login.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');
const headers={Cookie:cookie};
const sessions=await fetch(base+'/api/v1/mobile/sessions',{headers}).then(r=>r.json());
const active=(sessions.data||[]).find(s=>s.status==='READY'&&s.device_id==='emulator-5554');
if(!active){console.log('STREAM_TEST_SKIPPED_NO_ACTIVE_DEVICE=YES');process.exit(0)}
const controller=new AbortController();
const started=Date.now();
const response=await fetch(base+'/api/v1/mobile/sessions/'+encodeURIComponent(active.id)+'/stream',{headers,signal:controller.signal});
console.log('STREAM_HTTP='+response.status);
console.log('STREAM_CONTENT_TYPE='+response.headers.get('content-type'));
if(!response.ok)throw Error('Stream authorization failed');
const reader=response.body.getReader();
const buffers=[];let count=0;
try{
 while(Date.now()-started<18000 && count<25000000){
  const block=await Promise.race([reader.read(),new Promise((_,reject)=>setTimeout(()=>reject(Error('FRAME_TIMEOUT')),18000))]);
  if(block.done)break;
  buffers.push(block.value);
  count+=block.value.length;
  const candidate=Buffer.concat(buffers);
  if(candidate.includes(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))){
   console.log('MJPEG_FIRST_PNG=PASS');
   console.log('FIRST_FRAME_MS='+(Date.now()-started));
   break;
  }
 }
}finally{controller.abort();await reader.cancel().catch(()=>{})}
if(!buffers.length)throw Error('No stream response bytes');
if(!Buffer.concat(buffers).includes(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])))process.exitCode=1;
