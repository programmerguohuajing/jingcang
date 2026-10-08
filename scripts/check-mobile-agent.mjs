const base = process.env.JINGCANG_MOBILE_AGENT_URL;
const token = process.env.JINGCANG_MOBILE_AGENT_TOKEN;
if(!base || !token) throw new Error('Agent configuration missing');
const r=await fetch(new URL('/devices',base),{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(8000)});
console.log('AGENT_HTTP='+r.status);
const j=await r.json();
console.log('DEVICE_COUNT='+((j.devices||[]).length));
if(!r.ok)process.exitCode=1;
const caps=await fetch(new URL('/capabilities',base),{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(25000)});
console.log('CAPABILITIES_HTTP='+caps.status);
if(caps.ok){const result=await caps.json();console.log('APPIUM_HOST_AVAILABLE='+result.appiumHostAvailable);console.log('CHROMEDRIVER_INSTALLED='+result.chromedriverInstalled);console.log('AUTOMATION_TOOLCHAIN_READY='+result.automationReady);}
else process.exitCode=1;
