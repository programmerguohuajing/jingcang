const endpoint='http://127.0.0.1:14723';
const serial=process.env.JINGCANG_TEST_SERIAL||'emulator-5580';
const status=await fetch(endpoint+'/status',{signal:AbortSignal.timeout(5000)});
if(!status.ok)throw Error('Appium not ready: HTTP '+status.status);
console.log('APPIUM_SERVER_READY=PASS');
async function execute(name,alwaysMatch){
 let session;
 try{
  const result=await fetch(endpoint+'/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({capabilities:{alwaysMatch:{platformName:'Android','appium:automationName':'UiAutomator2','appium:udid':serial,'appium:deviceName':serial,'appium:newCommandTimeout':30,...alwaysMatch},firstMatch:[{}]}}),signal:AbortSignal.timeout(90000)});
  const body=await result.json();
  if(!result.ok||body.value?.error)throw Error(JSON.stringify(body.value||body).slice(0,1000));
  session=body.value?.sessionId||body.sessionId;
  if(!session)throw Error('No session id returned');
  console.log(name+'_SESSION=PASS');
  if(name==='CHROME'){
   const navigate=await fetch(endpoint+'/session/'+session+'/url',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:'https://example.com'}),signal:AbortSignal.timeout(40000)});
   if(!navigate.ok)throw Error('Navigation error: '+(await navigate.text()).slice(0,350));
   console.log('CHROME_NAVIGATE=PASS');
  }else{
   const source=await fetch(endpoint+'/session/'+session+'/source',{signal:AbortSignal.timeout(25000)});
   if(!source.ok)throw Error('Native page source error: '+source.status);
   console.log('ANDROID_UIAUTOMATOR2_SOURCE=PASS');
  }
  return true;
 }catch(e){console.log(name+'_ERROR='+String(e.message).slice(0,1100));return false;}
 finally{if(session){await fetch(endpoint+'/session/'+session,{method:'DELETE',signal:AbortSignal.timeout(15000)}).catch(()=>{});}}
}
const native=await execute('NATIVE',{'appium:appPackage':'com.android.settings','appium:appActivity':'.Settings','appium:noReset':true});
const chrome=await execute('CHROME',{browserName:'Chrome','appium:noReset':true,'appium:chromedriverExecutable':'D:\\codex\\jingcang-mobile-toolchain\\chromedriver-101\\chromedriver.exe'});
console.log('TEST_NATIVE='+native+' TEST_CHROME='+chrome);
if(!native||!chrome)process.exitCode=1;
