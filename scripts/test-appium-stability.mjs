import {writeFile} from 'node:fs/promises';
import {appiumDiagnostics} from './android-webdriver-automation.mjs';

const rounds=Math.min(60,Math.max(3,Number.parseInt(process.env.JINGCANG_APPIUM_CHECK_ROUNDS||'10',10)||10));
const intervalMs=Math.max(1000,Number.parseInt(process.env.JINGCANG_APPIUM_CHECK_INTERVAL_MS||'3000',10)||3000);
const samples=[];
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
console.log('APPIUM_STABILITY_MODE=NON_INVASIVE');
console.log('APPIUM_STABILITY_ROUNDS='+rounds);
for(let i=0;i<rounds;i++){
 const started=Date.now();
 const data=await appiumDiagnostics();
 const item={sequence:i+1,ready:data.available===true,version:data.version||null,chromedriverInstalled:data.chromeDriverInstalled,latencyMs:Date.now()-started,timestamp:new Date().toISOString()};
 samples.push(item);
 console.log('APPIUM_SAMPLE='+item.sequence+' READY='+item.ready+' LATENCY_MS='+item.latencyMs);
 if(i+1<rounds)await pause(intervalMs);
}
const failures=samples.filter(item=>!item.ready);
const result={checkedAt:new Date().toISOString(),rounds,healthy:rounds-failures.length,failures:failures.length,availabilityPercent:Math.round(10000*(rounds-failures.length)/rounds)/100,maxResponseMs:Math.max(...samples.map(s=>s.latencyMs)),samples};
if(process.env.JINGCANG_APPIUM_REPORT_PATH)await writeFile(process.env.JINGCANG_APPIUM_REPORT_PATH,JSON.stringify(result,null,2)+'\n','utf8');
console.log('APPIUM_STABILITY_RESULT='+JSON.stringify({rounds:result.rounds,healthy:result.healthy,failures:result.failures,availabilityPercent:result.availabilityPercent,maxResponseMs:result.maxResponseMs}));
if(failures.length)process.exitCode=1;
