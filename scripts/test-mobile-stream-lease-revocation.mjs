import {readFile} from 'node:fs/promises';
const env=await readFile('D:/codex/jingcang/.env','utf8');
const pass=/^JINGCANG_ADMIN_INITIAL_PASSWORD=(.+)$/m.exec(env)?.[1]?.trim();
if(!pass)throw Error('Missing isolated dev password');
const base='http://127.0.0.1:28088';
const login=await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:pass})});
if(!login.ok)throw Error('Dev login failed');
const headers={Cookie:login.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ')};
const devices=await fetch(base+'/api/v1/mobile/devices',{headers}).then(r=>r.json());
const selected=(devices.data?.devices||[]).find(d=>d.state==='device'&&d.booted&&d.available);
if(!selected){console.log('STREAM_REVOKE_TEST_SKIPPED_DEVICE_LEASED=YES');process.exit(0)}
const created=await fetch(base+'/api/v1/mobile/sessions',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({deviceId:selected.id,nodeId:selected.nodeId,mode:'phone'})});
if(!created.ok)throw Error('Test session create failed: '+created.status);
const id=(await created.json()).data.id;
const abort=new AbortController();
try{
 const response=await fetch(base+'/api/v1/mobile/sessions/'+encodeURIComponent(id)+'/stream',{headers,signal:abort.signal});
 if(!response.ok)throw Error('Stream status '+response.status);
 const reader=response.body.getReader();
 const first=await Promise.race([reader.read(),new Promise((_,reject)=>setTimeout(()=>reject(Error('First frame timed out')),12000))]);
 if(first.done||!first.value.length)throw Error('No first frame');
 console.log('STREAM_INITIAL_FRAME=PASS');
 const release=await fetch(base+'/api/v1/mobile/sessions/'+encodeURIComponent(id),{method:'DELETE',headers});
 if(!release.ok)throw Error('Release failed');
 console.log('STREAM_SESSION_RELEASE=PASS');
 let stopped=false,extraChunks=0;
 const deadline=Date.now()+8000;
 while(Date.now()<deadline){
  const result=await Promise.race([reader.read(),new Promise(resolve=>setTimeout(()=>resolve({timeout:true}),2500))]);
  if(result.done){stopped=true;break}
  if(result.timeout)break;
  extraChunks++;
 }
 console.log('STREAM_BUFFERED_CHUNKS_AFTER_RELEASE='+extraChunks);
 if(!stopped)throw Error('Stream remained open after lease release');
 console.log('STREAM_TERMINATES_AFTER_RELEASE=PASS');
}finally{
 abort.abort();
 await fetch(base+'/api/v1/mobile/sessions/'+encodeURIComponent(id),{method:'DELETE',headers}).catch(()=>{});
}
