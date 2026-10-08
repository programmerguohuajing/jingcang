import http from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';

const exec = promisify(execFile);
const managedAvds = new Map();
const MANAGED_SERIAL = 'emulator-5580';
const STARTUP_TIMEOUT_MS = 120000;
async function managedStatus(name){
  const entry=managedAvds.get(name);
  if(!entry)return null;
  const online=(await devices()).find(d=>d.id===MANAGED_SERIAL);
  if(online?.booted){entry.status='ready';return {status:'ready',serial:MANAGED_SERIAL};}
  if(Date.now()-entry.startedAt>STARTUP_TIMEOUT_MS){
    entry.status='timeout';return {status:'timeout',serial:MANAGED_SERIAL};
  }
  return {status:entry.status,serial:MANAGED_SERIAL};
}
const host = process.env.JINGCANG_ANDROID_AGENT_HOST || '127.0.0.1';
const token = process.env.JINGCANG_MOBILE_AGENT_TOKEN || '';
const port = Number(process.env.JINGCANG_ANDROID_AGENT_PORT || 19879);
const adb = process.env.JINGCANG_ADB_PATH || 'D:\\Program Files\\platform-tools\\adb.exe';
const emulator = process.env.JINGCANG_EMULATOR_PATH || path.join(process.env.LOCALAPPDATA || path.join(homedir(),'AppData','Local'),'Android','Sdk','emulator','emulator.exe');
if (host !== '127.0.0.1' && token.length < 32) throw new Error('Remote binding requires strong token');
async function command(args, maxBuffer = 1024 * 1024) {
  return exec(adb, args, { timeout: 18000, maxBuffer, windowsHide: true, encoding: 'buffer' });
}
async function adbText(args) { return (await command(args)).stdout.toString('utf8').trim(); }
function validSerial(serial) { return typeof serial === 'string' && /^[a-zA-Z0-9._:-]{1,80}$/.test(serial); }
async function devices() {
  const out = await adbText(['devices','-l']);
  const found = [];
  for (const line of out.split(/\r?\n/).slice(1)) {
    const m = /^(\S+)\s+(device|offline|unauthorized)\b/.exec(line);
    if (!m) continue;
    const [ , id, state ] = m;
    const item = { id, kind: id.startsWith('emulator-')?'android-emulator':'android-real', state };
    if (state === 'device') {
      const props = await Promise.all(['ro.product.model','ro.build.version.release','sys.boot_completed'].map(x=>adbText(['-s',id,'shell','getprop',x]).catch(()=>'unknown')));
      item.model=props[0]; item.osVersion=props[1]; item.booted=props[2]==='1';
    }
    found.push(item);
  }
  return found;
}
async function profiles(){
  const {stdout}=await exec(emulator,['-list-avds'],{timeout:15000,windowsHide:true});
  const names=stdout.split(/\r?\n/).map(x=>x.trim()).filter(x=>/^[A-Za-z0-9._-]{1,80}$/.test(x));
  return Promise.all(names.map(async name=>{
    const file=path.join(homedir(),'.android','avd',name+'.avd','config.ini');
    const config=await readFile(file,'utf8').catch(()=>'');
    const image=/^image\.sysdir\.1\s*=\s*(.+)$/m.exec(config)?.[1]?.trim()||'';
    const api=/android-(\d+)/.exec(image)?.[1]||null;
    const model=/^hw\.device\.name\s*=\s*(.+)$/m.exec(config)?.[1]?.trim()||name;
    return {id:name,model,apiLevel:api?Number(api):null,systemImage:image};
  }));
}
function send(res, status, data) {
  res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' });
  res.end(JSON.stringify(data));
}
async function jsonBody(req, limit = 4096) {
  let data='';
  for await (const chunk of req) {
    data+=chunk;
    if (data.length>limit) throw Error('Request too large');
  }
  return JSON.parse(data || '{}');
}
const allowedKeys = new Set(['HOME','BACK','APP_SWITCH','ENTER']);
const keyCodes = {HOME:'3',BACK:'4',APP_SWITCH:'187',ENTER:'66'};
http.createServer(async(req,res)=>{
  if (!token || req.headers.authorization !== 'Bearer '+token) return send(res,401,{error:'UNAUTHORIZED'});
  const url = new URL(req.url || '/', 'http://localhost');
  if(req.method==='GET' && url.pathname==='/health') return send(res,200,{status:'ok',platform:process.platform});
  try {
    if(req.method==='GET' && url.pathname==='/devices') return send(res,200,{devices:await devices()});
    if(req.method==='GET' && url.pathname==='/profiles'){
      const current=await profiles();
      return send(res,200,{profiles:await Promise.all(current.map(async p=>({...p,managed:managedAvds.has(p.id),lifecycle:await managedStatus(p.id)})))});
    }
    const avdAction=/^\/profiles\/([A-Za-z0-9._-]{1,80})\/(start|stop)$/.exec(url.pathname);
    if(req.method==='POST' && avdAction){
      const name=avdAction[1],operation=avdAction[2];
      if(operation==='stop'){
        const entry=managedAvds.get(name);
        if(!entry)return send(res,409,{error:'NOT_MANAGED_BY_AGENT'});
        const online=(await devices()).find(d=>d.id===MANAGED_SERIAL);
        if(online){
          const actual=await adbText(['-s',MANAGED_SERIAL,'emu','avd','name']).catch(()=>'');
          if(actual.split(/\r?\n/)[0].trim()!==name)return send(res,409,{error:'MANAGED_DEVICE_MISMATCH'});
          await adbText(['-s',MANAGED_SERIAL,'emu','kill']);
        }else{entry.child.kill();}
        managedAvds.delete(name);
        return send(res,200,{success:true,status:'stopping'});
      }
      if(managedAvds.has(name))return send(res,409,{error:'ALREADY_MANAGED'});
      const online=(await devices()).filter(x=>x.id.startsWith('emulator-'));
      for(const current of online){const activeName=await adbText(['-s',current.id,'emu','avd','name']).catch(()=>'');if(activeName.split(/\r?\n/)[0].trim()===name)return send(res,409,{error:'AVD_ALREADY_RUNNING'});}
      if(online.some(x=>x.id==='emulator-5580'))return send(res,409,{error:'PORT_IN_USE'});
      const list=await profiles();
      if(!list.some(p=>p.id===name))return send(res,404,{error:'AVD_NOT_FOUND'});
      if(managedAvds.size>=1)return send(res,409,{error:'POC_EMULATOR_LIMIT'});
      const child=spawn(emulator,['-avd',name,'-port','5580','-no-snapshot-save'],{detached:false,stdio:'ignore',windowsHide:true});
      child.on('error',()=>{if(managedAvds.get(name)?.child===child)managedAvds.delete(name);});
      child.on('exit',()=>{if(managedAvds.get(name)?.child===child)managedAvds.delete(name);});
      managedAvds.set(name,{child,status:'starting',startedAt:Date.now()});
      return send(res,202,{success:true,status:'starting',serial:MANAGED_SERIAL});
    }
    const match=/^\/devices\/([^/]+)\/(screenshot|action|apps|install)$/.exec(url.pathname);
    if (!match || !validSerial(match[1])) return send(res,404,{error:'NOT_FOUND'});
    const serial=match[1];
    const found=(await devices()).find(d=>d.id===serial && d.state==='device');
    if (!found) return send(res,404,{error:'DEVICE_OFFLINE'});
    if(req.method==='GET' && match[2]==='apps'){
      const result=await adbText(['-s',serial,'shell','pm','list','packages','-3']);
      const packages=result.split(/\r?\n/).filter(x=>x.startsWith('package:')).map(x=>x.slice(8)).filter(x=>/^[a-zA-Z][a-zA-Z0-9_.]{1,180}$/.test(x));
      return send(res,200,{packages});
    }
    if(req.method==='POST' && match[2]==='install'){
      const body=await jsonBody(req,12*1024*1024);
      if(typeof body.base64!=='string' || body.base64.length>11*1024*1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.base64)) return send(res,400,{error:'INVALID_APK'});
      const bytes=Buffer.from(body.base64,'base64');
      if(bytes.length<128 || bytes.length>8*1024*1024 || bytes.subarray(0,4).toString('hex')!=='504b0304' || !bytes.includes(Buffer.from('AndroidManifest.xml'))) return send(res,400,{error:'INVALID_APK'});
      const directory=await mkdtemp(path.join(tmpdir(),'jc-apk-'));
      try{
        const apk=path.join(directory,'test.apk');
        await writeFile(apk,bytes,{flag:'wx'});
        const result=await adbText(['-s',serial,'install','-r',apk]);
        return send(res,200,{success:true,result:result.slice(0,500)});
      }finally{await rm(directory,{recursive:true,force:true});}
    }
    if(req.method==='GET' && match[2]==='screenshot'){
      const {stdout}=await command(['-s',serial,'exec-out','screencap','-p'],12*1024*1024);
      res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store','Content-Length':stdout.length});
      return res.end(stdout);
    }
    if(req.method==='POST' && match[2]==='action'){
      const body=await jsonBody(req);
      if(body.type==='key' && allowedKeys.has(body.key)){
        await adbText(['-s',serial,'shell','input','keyevent',keyCodes[body.key]]);
      }else if(body.type==='tap' && Number.isInteger(body.x) && Number.isInteger(body.y) && body.x>=0 && body.x<=10000 && body.y>=0 && body.y<=10000){
        await adbText(['-s',serial,'shell','input','tap',String(body.x),String(body.y)]);
      }else if((body.type==='launchApp'||body.type==='stopApp') && typeof body.package==='string' && /^[a-zA-Z][a-zA-Z0-9_.]{1,180}$/.test(body.package)){
        const installed=await adbText(['-s',serial,'shell','pm','path',body.package]);
        if(!installed.includes('package:')) return send(res,404,{error:'PACKAGE_NOT_INSTALLED'});
        if(body.type==='launchApp') await adbText(['-s',serial,'shell','monkey','-p',body.package,'-c','android.intent.category.LAUNCHER','1']);
        else await adbText(['-s',serial,'shell','am','force-stop',body.package]);
      }else if(body.type==='text' && typeof body.text==='string' && body.text.length>0 && body.text.length<=120 && /^[A-Za-z0-9 .@:_/-]+$/.test(body.text)){
        await adbText(['-s',serial,'shell','input','text',body.text.replace(/ /g,'%s')]);
      }else if(body.type==='navigate' && typeof body.url==='string' && body.url.length<=2048 && /^https?:\/\//i.test(body.url)){
        const target=new URL(body.url);
        if(!['http:','https:'].includes(target.protocol) || target.username || target.password) return send(res,400,{error:'INVALID_URL'});
        await adbText(['-s',serial,'shell','am','start','-a','android.intent.action.VIEW','-d',target.href,'-p','com.android.chrome']);
      }else if(body.type==='swipe' && [body.x1,body.y1,body.x2,body.y2].every(v=>Number.isInteger(v)&&v>=0&&v<=10000) && Number.isInteger(body.duration) && body.duration>=100 && body.duration<=2000){
        await adbText(['-s',serial,'shell','input','swipe',String(body.x1),String(body.y1),String(body.x2),String(body.y2),String(body.duration)]);
      }else return send(res,400,{error:'INVALID_ACTION'});
      return send(res,200,{success:true});
    }
    return send(res,405,{error:'METHOD_NOT_ALLOWED'});
  }catch(error){return send(res,503,{error:'AGENT_ERROR',message:String(error.message||error)});}
}).listen(port,host,()=>console.log('Android Device Agent listening on '+host+':'+port));
