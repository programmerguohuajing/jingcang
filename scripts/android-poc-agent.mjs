import http from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm, readFile, readdir, stat, mkdir } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import {appiumDiagnostics,runChromeSmoke} from './android-webdriver-automation.mjs';

const exec = promisify(execFile);
const managedAvds = new Map();
const MANAGED_SERIAL = 'emulator-5580';
const STARTUP_TIMEOUT_MS = 120000;
let lifecycleBusy = false;
const automationBusy = new Set();
async function managedStatus(name){
  const entry=managedAvds.get(name);
  if(!entry)return null;
  const online=(await devices()).find(d=>d.id===MANAGED_SERIAL);
  if(online?.booted){entry.status='ready';return {status:'ready',serial:MANAGED_SERIAL};}
  if(entry.status==='failed')return {status:'failed',serial:MANAGED_SERIAL,errorCode:'EMULATOR_PROCESS_EXITED'};
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
async function systemImages(){
  const root=path.join(process.env.ANDROID_HOME||path.join(process.env.LOCALAPPDATA||path.join(homedir(),'AppData','Local'),'Android','Sdk'),'system-images');
  const result=[];
  for(const level of await readdir(root,{withFileTypes:true}).catch(()=>[])){
    if(!level.isDirectory()||!/^android-[0-9]+$/.test(level.name))continue;
    for(const flavor of await readdir(path.join(root,level.name),{withFileTypes:true}).catch(()=>[])){
      if(!flavor.isDirectory()||!/^[A-Za-z0-9_-]+$/.test(flavor.name))continue;
      for(const abi of await readdir(path.join(root,level.name,flavor.name),{withFileTypes:true}).catch(()=>[])){
        if(!abi.isDirectory()||!/^[A-Za-z0-9_-]+$/.test(abi.name))continue;
        const dir=path.join(root,level.name,flavor.name,abi.name);
        if((await stat(path.join(dir,'system.img')).catch(()=>null))?.isFile())result.push({apiLevel:Number(level.name.slice(8)),flavor:flavor.name,abi:abi.name,installed:true});
      }
    }
  }
  return result.sort((a,b)=>b.apiLevel-a.apiLevel);
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
    if(req.method==='GET' && url.pathname==='/capabilities'){
      const list=await devices();
      const diagnostics=[];
      for(const device of list.filter(x=>x.state==='device')){
        const serial=device.id;
        const props=await Promise.all([
          adbText(['-s',serial,'shell','getprop','ro.build.version.sdk']).catch(()=>'unknown'),
          adbText(['-s',serial,'shell','getprop','ro.product.cpu.abi']).catch(()=>'unknown'),
          adbText(['-s',serial,'shell','pm','path','com.android.chrome']).catch(()=>''),
          adbText(['-s',serial,'shell','getprop','ro.build.version.security_patch']).catch(()=>'unknown')
        ]);
        diagnostics.push({id:serial,apiLevel:Number(props[0])||null,abi:props[1],chromeInstalled:props[2].includes('package:'),securityPatch:props[3],appiumStatus:'not-verified'});
      }
      const appium=await appiumDiagnostics();
      return send(res,200,{diagnostics,appiumHostAvailable:appium.available,appiumVersion:appium.version,chromedriverInstalled:appium.chromeDriverInstalled,automationReady:appium.available&&appium.chromeDriverInstalled,note:'Availability describes the host toolchain only; device-specific Chrome versions still require compatible Chromedriver.'});
    }
    if(req.method==='GET' && url.pathname==='/system-images')return send(res,200,{images:await systemImages()});
    if(req.method==='GET' && url.pathname==='/devices') return send(res,200,{devices:await devices()});
    if(req.method==='GET' && url.pathname==='/profiles'){
      const current=await profiles();
      const external=(await devices()).find(d=>d.id===MANAGED_SERIAL);
      let externalName='';
      if(external)externalName=(await adbText(['-s',MANAGED_SERIAL,'emu','avd','name']).catch(()=>'' )).split(/\r?\n/)[0].trim();
      return send(res,200,{profiles:await Promise.all(current.map(async p=>({...p,managed:managedAvds.has(p.id)&&managedAvds.get(p.id)?.status!=='failed',lifecycle:await managedStatus(p.id) || (p.id===externalName?{status:'external',serial:MANAGED_SERIAL}:null)})))});
    }
    if(req.method==='POST' && url.pathname==='/profiles/create'){
      if(lifecycleBusy)return send(res,409,{error:'LIFECYCLE_BUSY'});
      lifecycleBusy=true;
      try{
        const body=await jsonBody(req);
        if(!Number.isInteger(body.apiLevel)||![24,27,34].includes(body.apiLevel))return send(res,400,{error:'UNSUPPORTED_IMAGE'});
        const desired=body.apiLevel===34?{abi:'x86_64',flavor:'google_apis'}:{abi:'x86',flavor:'google_apis_playstore'};
        const image=(await systemImages()).find(x=>x.apiLevel===body.apiLevel&&x.abi===desired.abi&&x.flavor===desired.flavor);
        if(!image)return send(res,409,{error:'IMAGE_NOT_INSTALLED'});
        const name='JingCang_Test_API'+body.apiLevel+'_'+image.abi;
        const avdRoot=path.join(homedir(),'.android','avd');
        const targetDir=path.join(avdRoot,name+'.avd');
        const iniPath=path.join(avdRoot,name+'.ini');
        if((await stat(targetDir).catch(()=>null))||(await stat(iniPath).catch(()=>null)))return send(res,409,{error:'AVD_ALREADY_EXISTS'});
        const templatePath=path.join(avdRoot,'Pixel_2.avd','config.ini');
        const template=await readFile(templatePath,'utf8');
        if(!template.includes('image.sysdir.1='))return send(res,503,{error:'TEMPLATE_UNAVAILABLE'});
        const config=template.split(/\r?\n/).filter(line=>!/^AvdId=|^avd.ini.displayname=|^image.sysdir.1=|^abi.type=|^hw.cpu.arch=|^tag.id=|^fastboot\./.test(line)).join('\n')
          +'\nAvdId='+name+'\navd.ini.displayname='+name+'\nabi.type='+image.abi+'\nhw.cpu.arch='+image.abi+'\ntag.id='+image.flavor+'\nimage.sysdir.1=system-images\\android-'+body.apiLevel+'\\'+image.flavor+'\\'+image.abi+'\\\nfastboot.forceColdBoot=yes\n';
        await mkdir(targetDir,{recursive:false});
        try{
          await writeFile(path.join(targetDir,'config.ini'),config,{flag:'wx'});
          await writeFile(path.join(targetDir,'.jingcang-mobile-managed'),'v1\n',{flag:'wx'});
          await writeFile(iniPath,'avd.ini.encoding=UTF-8\npath='+targetDir+'\npath.rel=avd\\'+name+'.avd\ntarget=android-'+body.apiLevel+'\n',{flag:'wx'});
        }catch(error){await rm(targetDir,{recursive:true,force:true});await rm(iniPath,{force:true});throw error;}
        return send(res,201,{success:true,id:name,apiLevel:body.apiLevel});
      }finally{lifecycleBusy=false;}
    }
    const removeProfile=/^\/profiles\/(JingCang_Test_API(?:24|27)_x86|JingCang_Test_API34_x86_64)\/delete$/.exec(url.pathname);
    if(req.method==='POST' && removeProfile){
      if(lifecycleBusy)return send(res,409,{error:'LIFECYCLE_BUSY'});
      lifecycleBusy=true;
      try{
        const name=removeProfile[1];
        const base=path.join(homedir(),'.android','avd');
        const directory=path.join(base,name+'.avd');
        if(!(await stat(path.join(directory,'.jingcang-mobile-managed')).catch(()=>null)))return send(res,403,{error:'NOT_MANAGED_AVD'});
        if(managedAvds.has(name))return send(res,409,{error:'MANAGED_AVD_BUSY'});
        const existing=await devices();
        for(const device of existing.filter(x=>x.id.startsWith('emulator-'))){
          const runningName=await adbText(['-s',device.id,'emu','avd','name']).catch(()=>'');
          if(runningName.split(/\r?\n/)[0].trim()===name)return send(res,409,{error:'AVD_RUNNING'});
        }
        // Refuse deletion if Windows Emulator still holds its instance lock.
        // Remove the lock first: a locked handle fails atomically before touching AVD data.
        try{await rm(path.join(directory,'multiinstance.lock'),{force:true});}
        catch{return send(res,409,{error:'AVD_FILE_LOCKED'});}
        try{await rm(directory,{recursive:true,force:true});}
        catch(error){return send(res,409,{error:'AVD_FILES_BUSY',message:String(error.code||'FILE_BUSY')});}
        await rm(path.join(base,name+'.ini'),{force:true});
        return send(res,200,{success:true,id:name});
      }finally{lifecycleBusy=false;}
    }
    const avdAction=/^\/profiles\/([A-Za-z0-9._-]{1,80})\/(start|stop)$/.exec(url.pathname);
    if(req.method==='POST' && avdAction){
      if(lifecycleBusy)return send(res,409,{error:'LIFECYCLE_BUSY'});
      lifecycleBusy=true;
      try{
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
      if(managedAvds.get(name)?.status==='failed')managedAvds.delete(name);
      if(managedAvds.has(name))return send(res,409,{error:'ALREADY_MANAGED'});
      const online=(await devices()).filter(x=>x.id.startsWith('emulator-'));
      for(const current of online){const activeName=await adbText(['-s',current.id,'emu','avd','name']).catch(()=>'');if(activeName.split(/\r?\n/)[0].trim()===name)return send(res,409,{error:'AVD_ALREADY_RUNNING'});}
      if(online.some(x=>x.id==='emulator-5580'))return send(res,409,{error:'PORT_IN_USE'});
      const list=await profiles();
      if(!list.some(p=>p.id===name))return send(res,404,{error:'AVD_NOT_FOUND'});
      if([...managedAvds.values()].some(v=>v.status!=='failed'))return send(res,409,{error:'POC_EMULATOR_LIMIT'});
      const child=spawn(emulator,['-avd',name,'-port','5580','-no-snapshot-save'],{detached:false,stdio:'ignore',windowsHide:true});
      const entry={child,status:'starting',startedAt:Date.now(),error:''};
      // Emulator GUI launcher may fork QEMU; do not pipe stderr through a headless agent.
      child.on('error',error=>{if(managedAvds.get(name)?.child===child){entry.status='failed';entry.error=String(error.message);}});
      child.on('exit',(code,signal)=>{if(managedAvds.get(name)?.child===child){entry.error=('Launcher exit '+code+' '+(signal||'')+' '+entry.error).slice(-900);/* QEMU may outlive emulator.exe launcher; readiness is checked via ADB. */}});
      managedAvds.set(name,entry);
      return send(res,202,{success:true,status:'starting',serial:MANAGED_SERIAL});
      }finally{lifecycleBusy=false;}
    }
    const match=/^\/devices\/([^/]+)\/(screenshot|action|apps|install|automation)$/.exec(url.pathname);
    if (!match || !validSerial(match[1])) return send(res,404,{error:'NOT_FOUND'});
    const serial=match[1];
    const found=(await devices()).find(d=>d.id===serial && d.state==='device');
    if (!found) return send(res,404,{error:'DEVICE_OFFLINE'});
    if(req.method==='POST' && match[2]==='automation'){
      if(automationBusy.has(serial))return send(res,409,{error:'AUTOMATION_ALREADY_RUNNING'});
      automationBusy.add(serial);
      try{return send(res,200,await runChromeSmoke(serial));}
      catch(error){return send(res,503,{success:false,error:'AUTOMATION_FAILED',message:String(error.message||error).slice(0,350)});}
      finally{automationBusy.delete(serial);}
    }
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
      if(automationBusy.has(serial))return send(res,409,{error:'AUTOMATION_RUNNING'});
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
      }else if(body.type==='uninstallApp' && typeof body.package==='string' && /^[a-zA-Z][a-zA-Z0-9_.]{1,180}$/.test(body.package)){
        const userPackages=await adbText(['-s',serial,'shell','pm','list','packages','-3']);
        if(!userPackages.split(/\r?\n/).includes('package:'+body.package))return send(res,403,{error:'NOT_THIRD_PARTY_APP'});
        const output=await adbText(['-s',serial,'uninstall',body.package]);
        if(!output.includes('Success'))return send(res,409,{error:'UNINSTALL_FAILED'});
      }else if(body.type==='rotate' && (body.orientation==='portrait'||body.orientation==='landscape')){
        const rotation=body.orientation==='landscape'?'1':'0';
        await adbText(['-s',serial,'shell','settings','put','system','accelerometer_rotation','0']);
        await adbText(['-s',serial,'shell','settings','put','system','user_rotation',rotation]);
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
