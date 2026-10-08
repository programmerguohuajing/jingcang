import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
const sample=await readFile(path.join(tmpdir(),'jingcang-h264-sample.h264'));
if(sample.length<100)throw Error('H264 sample missing');
const directory=await mkdtemp(path.join(tmpdir(),'jc-webcodecs-'));
const html=path.join(directory,'decode.html');
const src=sample.toString('base64');
const page=`<!doctype html><html><body><main id="result">WAITING</main><script>
(async()=>{
 const output=document.getElementById('result');
 try {
  if(typeof VideoDecoder==='undefined')throw Error('VideoDecoder unavailable');
  output.textContent='DECODER_PRESENT';
  const bytes=Uint8Array.from(atob('${src}'),x=>x.charCodeAt(0));
  const nals=[];
  for(let i=0;i<bytes.length-4;i++){
   if(bytes[i]||bytes[i+1])continue;
   const size=bytes[i+2]===1?3:(bytes[i+2]===0&&bytes[i+3]===1?4:0);
   if(size)nals.push({start:i,nal:i+size});
  }
  const spsEntry=nals.find(x=>(bytes[x.nal]&31)===7);
  if(!spsEntry)throw Error('Missing SPS');
  const sps=bytes.subarray(spsEntry.nal,spsEntry.nal+4);
  const codec='avc1.'+[...sps.subarray(1,4)].map(x=>x.toString(16).padStart(2,'0')).join('').toUpperCase();
  let frames=0;
  const decoder=new VideoDecoder({
   output:frame=>{frames++;frame.close();},
   error:error=>{output.textContent='H264_BROWSER_DECODE=FAIL '+error.message;}
  });
  decoder.configure({codec,optimizeForLatency:true});
  output.textContent='DECODER_CONFIGURED '+codec;
  decoder.decode(new EncodedVideoChunk({type:'key',timestamp:0,data:bytes}));
  output.textContent='DECODE_SUBMITTED';
  await Promise.race([decoder.flush(),new Promise((_,reject)=>setTimeout(()=>reject(Error('Decoder flush timed out; frames='+frames+' queue='+decoder.decodeQueueSize)),7000))]);
  decoder.close();
  if(frames<1)throw Error('No decoded frame');
  output.textContent='H264_BROWSER_DECODE=PASS FRAMES='+frames+' CODEC='+codec;
 }catch(error){output.textContent='H264_BROWSER_DECODE=FAIL '+String(error.message||error);}
})();</script></body></html>`;
await writeFile(html,page,'utf8');
const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';
const port=19354;
const processRef=spawn(chrome,['--headless=new','--no-first-run','--disable-extensions','--disable-background-networking','--no-sandbox','--remote-allow-origins=*','--remote-debugging-port='+port,'--user-data-dir='+path.join(directory,'profile'),pathToFileURL(html).href],{windowsHide:true,stdio:'ignore'});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
 let target;
 for(let i=0;i<35;i++){
  try{
   const list=await fetch('http://127.0.0.1:'+port+'/json/list').then(x=>x.json());
   target=list.find(x=>x.type==='page'&&x.url.startsWith('file:'));
   if(target)break;
  }catch{}
  await sleep(200);
 }
 if(!target)throw Error('Chrome debugging port unavailable');
 const ws=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true})});
 let id=0;
 const pending=new Map();
 ws.addEventListener('message',evt=>{
  const message=JSON.parse(evt.data);
  const settle=pending.get(message.id);
  if(settle){pending.delete(message.id);settle(message.result?.result?.value||'CDP_ERROR')}
 });
 const evaluate=()=>new Promise(resolve=>{
  const reqId=++id;pending.set(reqId,resolve);
  ws.send(JSON.stringify({id:reqId,method:'Runtime.evaluate',params:{expression:"document.querySelector('#result')?.textContent",returnByValue:true}}));
 });
 let marker='WAITING';
 for(let i=0;i<40;i++){
  marker=await evaluate();
  if(marker.startsWith('H264_BROWSER_DECODE='))break;
  await sleep(300);
 }
 console.log(marker);
 if(!marker.includes('H264_BROWSER_DECODE=PASS'))process.exitCode=1;
 ws.close();
}finally{
 await exec('taskkill',['/PID',String(processRef.pid),'/T','/F'],{windowsHide:true}).catch(()=>{});
 await rm(directory,{recursive:true,force:true}).catch(()=>{});
}
