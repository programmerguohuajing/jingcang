import {readFile,writeFile} from 'node:fs/promises';
const env=await readFile('D:/codex/jingcang/.env','utf8');
const password=/^JINGCANG_ADMIN_INITIAL_PASSWORD=(.+)$/m.exec(env)?.[1]?.trim();
const base='http://127.0.0.1:28088';
const login=await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password})});
if(!login.ok)throw Error('Auth failed');
const headers={Cookie:login.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ')};
const id=process.env.JINGCANG_TEST_EXISTING_SESSION;
if(!id){console.log('H264_LONG_TEST_SKIPPED_NO_BORROWED_TEST_SESSION=YES');process.exit(2)}
const sessions=await fetch(base+'/api/v1/mobile/sessions',{headers}).then(r=>r.json());
if(!(sessions.data||[]).some(s=>s.id===id&&s.status==='READY'))throw Error('Borrowed test lease unavailable');
const runs=Math.max(2,Math.min(5,Number(process.env.JINGCANG_VIDEO_RUNS||2)));
const duration=Math.max(10000,Math.min(55000,Number(process.env.JINGCANG_VIDEO_SECONDS||25)*1000));
const result={checkedAt:new Date().toISOString(),sessionId:id,neverModifiedSession:true,runs:[]};
for(let run=1;run<=runs;run++){
 const abort=new AbortController(),begun=Date.now(),types=new Set();
 const response=await fetch(base+'/api/v1/mobile/sessions/'+encodeURIComponent(id)+'/h264',{headers,signal:abort.signal});
 if(!response.ok||!response.body)throw Error('Video HTTP '+response.status);
 const reader=response.body.getReader();
 let bytes=0,chunks=0,firstByteMs=null,ended=false,lastChunkAt=begun;
 let tail=new Uint8Array(0),pending=reader.read();
 try{
  while(Date.now()-begun<duration){
   const outcome=await Promise.race([pending.then(value=>({value})),new Promise(resolve=>setTimeout(()=>resolve({poll:true}),500))]);
   if(outcome.poll)continue;
   if(outcome.value.done){ended=true;break}
   const blockValue=outcome.value.value;
   chunks++;bytes+=blockValue.length;lastChunkAt=Date.now();
   if(firstByteMs===null)firstByteMs=Date.now()-begun;
   const block=new Uint8Array(tail.length+blockValue.length);block.set(tail);block.set(blockValue,tail.length);
   for(let i=0;i<block.length-5;i++)if(block[i]===0&&block[i+1]===0&&(block[i+2]===1||(block[i+2]===0&&block[i+3]===1)))types.add(block[i+(block[i+2]===1?3:4)]&31);
   tail=block.slice(-6);pending=reader.read();
  }
 }finally{abort.abort();await reader.cancel().catch(()=>{})}
 const sample={run,elapsedMs:Date.now()-begun,bytes,chunks,firstByteMs,endedBeforeDeadline:ended,maxFinalSilentMs:lastChunkAt?Date.now()-lastChunkAt:null,nalTypes:[...types].sort((a,b)=>a-b)};
 result.runs.push(sample);
 console.log('H264_SUSTAINED_SAMPLE='+JSON.stringify(sample));
}
result.transportPassed=result.runs.every(r=>r.bytes>0&&r.nalTypes.includes(7)&&r.nalTypes.includes(8)&&r.nalTypes.includes(5)&&!r.endedBeforeDeadline&&r.elapsedMs>=duration-1000);
result.multiFrameVerified=result.runs.some(r=>r.nalTypes.includes(1));
console.log('H264_SUSTAINED_RESULT='+JSON.stringify({transportPassed:result.transportPassed,multiFrameVerified:result.multiFrameVerified,runs:result.runs.length,totalBytes:result.runs.reduce((x,r)=>x+r.bytes,0)}));
if(process.env.JINGCANG_VIDEO_REPORT)await writeFile(process.env.JINGCANG_VIDEO_REPORT,JSON.stringify(result,null,2));
if(!result.transportPassed)process.exitCode=1;
