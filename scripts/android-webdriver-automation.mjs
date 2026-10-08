import { existsSync } from 'node:fs';
import path from 'node:path';

const endpoint = process.env.JINGCANG_APPIUM_URL || 'http://127.0.0.1:14723';
const chromedriver = process.env.JINGCANG_CHROMEDRIVER_PATH || 'D:\\codex\\jingcang-mobile-toolchain\\chromedriver-101\\chromedriver.exe';
const smokeTarget = 'https://example.com/';

async function request(pathname, options={}, timeout=30000) {
  const response = await fetch(new URL(pathname,endpoint), {
    ...options,
    headers: {'Content-Type':'application/json',...(options.headers||{})},
    signal: AbortSignal.timeout(timeout)
  });
  const text = await response.text();
  let result;
  try {result=JSON.parse(text);}catch {result={value:{error:'INVALID_APPIUM_RESPONSE',message:text.slice(0,300)}};}
  if (!response.ok || result.value?.error) throw new Error(String(result.value?.message || result.value?.error || 'APPIUM_HTTP_'+response.status).slice(0,350));
  return result.value;
}

export async function appiumDiagnostics(){
  try {
    const status=await request('/status',{},4500);
    return {available:Boolean(status?.ready),version:status?.build?.version||'unknown',chromeDriverInstalled:existsSync(chromedriver)};
  }catch{return {available:false,version:null,chromeDriverInstalled:existsSync(chromedriver)};}
}

export async function runChromeSmoke(serial){
  if(!/^[a-zA-Z0-9._:-]{1,80}$/.test(serial))throw new Error('INVALID_DEVICE');
  if(!existsSync(chromedriver))throw new Error('CHROMEDRIVER_NOT_INSTALLED');
  const startedAt=Date.now();
  let sessionId;
  try {
    const created=await request('/session',{
      method:'POST',
      body:JSON.stringify({capabilities:{alwaysMatch:{
        platformName:'Android',
        browserName:'Chrome',
        'appium:automationName':'UiAutomator2',
        'appium:udid':serial,
        'appium:deviceName':serial,
        'appium:chromedriverExecutable':chromedriver,
        'appium:noReset':true,
        'appium:newCommandTimeout':45,
        'appium:adbExecTimeout':120000,
        'appium:uiautomator2ServerLaunchTimeout':90000
      },firstMatch:[{}]}})
    },100000);
    sessionId=created?.sessionId;
    if(!sessionId)throw new Error('APPIUM_SESSION_MISSING');
    await request('/session/'+sessionId+'/url',{method:'POST',body:JSON.stringify({url:smokeTarget})},45000);
    const title=await request('/session/'+sessionId+'/title',{},20000);
    if(typeof title!=='string' || !title.includes('Example'))throw new Error('PAGE_TITLE_MISMATCH: '+String(title).slice(0,80));
    return {success:true,title,url:smokeTarget,durationMs:Date.now()-startedAt};
  }finally{
    if(sessionId){
      await request('/session/'+sessionId,{method:'DELETE'},15000).catch(()=>{});
    }
  }
}
