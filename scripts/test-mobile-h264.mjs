import {readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const env=await readFile('D:/codex/jingcang/.env','utf8');
const password=/^JINGCANG_ADMIN_INITIAL_PASSWORD=(.+)$/m.exec(env)?.[1]?.trim();
if(!password)throw Error('Missing dev login password');
const root='http://127.0.0.1:28088';
const login=await fetch(root+'/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password})});
if(!login.ok)throw Error('Cannot authenticate');
const headers={Cookie:login.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ')};
const inventory=await fetch(root+'/api/v1/mobile/devices',{headers}).then(x=>x.json());
const device=(inventory.data?.devices||[]).find(x=>x.state==='device'&&x.booted&&x.available);
if(!device){console.log('H264_TEST_SKIPPED_NO_FREE_DEVICE=YES');process.exit(0)}
const request=await fetch(root+'/api/v1/mobile/sessions',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({deviceId:device.id,nodeId:device.nodeId,mode:'phone'})});
if(!request.ok)throw Error('Session create HTTP '+request.status);
const id=(await request.json()).data.id;
const controller=new AbortController();
try{
 const response=await fetch(root+'/api/v1/mobile/sessions/'+encodeURIComponent(id)+'/h264',{headers,signal:controller.signal});
 console.log('H264_STREAM_HTTP='+response.status);
 console.log('H264_CONTENT_TYPE='+response.headers.get('content-type'));
 if(!response.ok)throw Error('H264 HTTP unavailable');
 const reader=response.body.getReader();
 let received=0,buffer=new Uint8Array(0);const chunks=[];
 const types=new Set();
 const started=Date.now();const limit=started+14000;
 while(Date.now()<limit&&received<2000000&&(Date.now()-started<8500||!types.has(5))){
  const r=await Promise.race([reader.read(),new Promise(resolve=>setTimeout(()=>resolve({timeout:true}),4000))]);
  if(r.done||r.timeout)break;
  received+=r.value.length;chunks.push(r.value);
  const combined=new Uint8Array(buffer.length+r.value.length);combined.set(buffer);combined.set(r.value,buffer.length);
  for(let i=0;i<combined.length-5;i++){
   if(combined[i]===0&&combined[i+1]===0&&(combined[i+2]===1||(combined[i+2]===0&&combined[i+3]===1))){
    const size=combined[i+2]===1?3:4;types.add(combined[i+size]&31);
   }
  }
  buffer=combined.slice(-5);
 }
 console.log('H264_BYTES='+received);
 console.log('H264_NAL_TYPES='+[...types].sort((a,b)=>a-b).join(','));
 if(!types.has(7)||!types.has(8)||!types.has(5))throw Error('Missing SPS/PPS/IDR NAL units');
 console.log('H264_ANNEXB_REAL_DEVICE=PASS');
 const samplePath=path.join(tmpdir(),'jingcang-h264-sample.h264');
 await writeFile(samplePath,Buffer.concat(chunks.map(x=>Buffer.from(x))));
 console.log('H264_SAMPLE_PATH='+samplePath);
}finally{
 controller.abort();
 await fetch(root+'/api/v1/mobile/sessions/'+encodeURIComponent(id),{method:'DELETE',headers});
}
