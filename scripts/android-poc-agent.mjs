import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const host = process.env.JINGCANG_ANDROID_AGENT_HOST || '127.0.0.1';
const token = process.env.JINGCANG_MOBILE_AGENT_TOKEN || '';
const port = Number(process.env.JINGCANG_ANDROID_AGENT_PORT || 19879);
const adb = process.env.JINGCANG_ADB_PATH || 'D:\\Program Files\\platform-tools\\adb.exe';
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
function send(res, status, data) {
  res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' });
  res.end(JSON.stringify(data));
}
async function jsonBody(req) {
  let data='';
  for await (const chunk of req) {
    data+=chunk;
    if (data.length>4096) throw Error('Request too large');
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
    const match=/^\/devices\/([^/]+)\/(screenshot|action|apps)$/.exec(url.pathname);
    if (!match || !validSerial(match[1])) return send(res,404,{error:'NOT_FOUND'});
    const serial=match[1];
    const found=(await devices()).find(d=>d.id===serial && d.state==='device');
    if (!found) return send(res,404,{error:'DEVICE_OFFLINE'});
    if(req.method==='GET' && match[2]==='apps'){
      const result=await adbText(['-s',serial,'shell','pm','list','packages','-3']);
      const packages=result.split(/\r?\n/).filter(x=>x.startsWith('package:')).map(x=>x.slice(8)).filter(x=>/^[a-zA-Z][a-zA-Z0-9_.]{1,180}$/.test(x));
      return send(res,200,{packages});
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
