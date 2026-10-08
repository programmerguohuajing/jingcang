const base = process.env.JINGCANG_MOBILE_AGENT_URL;
const token = process.env.JINGCANG_MOBILE_AGENT_TOKEN;
if(!base || !token) throw new Error('Agent configuration missing');
const r=await fetch(new URL('/devices',base),{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(8000)});
console.log('AGENT_HTTP='+r.status);
const j=await r.json();
console.log('DEVICE_COUNT='+((j.devices||[]).length));
if(!r.ok)process.exitCode=1;
