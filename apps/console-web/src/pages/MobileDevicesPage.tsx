import React, { useCallback, useEffect, useRef, useState } from 'react';
type Device = {id:string;kind:string;state:string;model?:string;osVersion?:string;booted?:boolean;available?:boolean;leased?:boolean};
type Session = {id:string;device_id:string;mode:string;status:string};
type Capability = {id:string;apiLevel:number|null;abi:string;chromeInstalled:boolean;securityPatch:string;appiumStatus:string};
type SystemImage = {apiLevel:number;flavor:string;abi:string;installed:boolean};
type Profile = {id:string;model:string;apiLevel:number|null;systemImage:string;managed?:boolean;lifecycle?:{status:string;serial:string}|null};
export const MobileDevicesPage: React.FC = () => {
 const [devices,setDevices]=useState<Device[]>([]);
 const [profiles,setProfiles]=useState<Profile[]>([]);
 const [images,setImages]=useState<SystemImage[]>([]);
 const [capabilities,setCapabilities]=useState<Capability[]>([]);
 const [appiumReady,setAppiumReady]=useState(false);
 const [sessions,setSessions]=useState<Session[]>([]);
 const managedPortBusy=sessions.some(s=>s.device_id==='emulator-5580'&&s.status==='READY');
 const [status,setStatus]=useState('loading');
 const [error,setError]=useState('');
 const [selected,setSelected]=useState<Session|null>(null);
 const [shot,setShot]=useState('');
 const [streaming,setStreaming]=useState(false);
 const [streamEpoch,setStreamEpoch]=useState(0);
 const [startUrl,setStartUrl]=useState('https://example.com');
 const [typed,setTyped]=useState('');
 const [apps,setApps]=useState<string[]>([]);
 const [installing,setInstalling]=useState(false);
 const [automating,setAutomating]=useState(false);
 const [automationResult,setAutomationResult]=useState('');
 const pointerStart=useRef<{x:number;y:number;time:number}|null>(null);
 const refresh=useCallback(async()=>{
  try{
   const [r,s,p,c,i]=await Promise.all([fetch('/api/v1/mobile/devices'),fetch('/api/v1/mobile/sessions'),fetch('/api/v1/mobile/profiles'),fetch('/api/v1/mobile/capabilities'),fetch('/api/v1/mobile/system-images')]);
   if(i.ok){const info=await i.json();setImages(info.data?.images||[]);}
   if(c.ok){const data=await c.json();setCapabilities(data.data?.diagnostics||[]);setAppiumReady(Boolean(data.data?.automationReady));}else{setCapabilities([]);setAppiumReady(false);}
   if(p.ok){const profilePayload=await p.json();setProfiles(profilePayload.data?.profiles||[]);}
   if(!r.ok||!s.ok)throw Error('登录已失效或服务不可用');
   const a=await r.json(), b=await s.json();
   setDevices(a.data?.devices||[]);setStatus(a.data?.status||'offline');
   setSessions(b.data||[]);setError('');
  }catch(e){setError(String(e));setStatus('offline');}
 },[]);
 const screenshot=useCallback(async(id:string)=>{
  const r=await fetch('/api/v1/mobile/sessions/'+encodeURIComponent(id)+'/screenshot');
  if(!r.ok)throw Error('无法从设备获取画面');
  const blob=await r.blob();setShot(old=>{if(old)URL.revokeObjectURL(old);return URL.createObjectURL(blob);});
 },[]);
 useEffect(()=>{void refresh();const i=setInterval(()=>void refresh(),10000);return()=>clearInterval(i)},[refresh]);
 useEffect(()=>{if(!selected||streaming)return;void screenshot(selected.id).catch(e=>setError(String(e)));const i=setInterval(()=>void screenshot(selected.id).catch(()=>{}),1800);return()=>clearInterval(i)},[selected,screenshot,streaming]);
 useEffect(()=>{if(!selected||!streaming)return;const i=setInterval(()=>setStreamEpoch(x=>x+1),90000);return()=>clearInterval(i)},[selected,streaming]);
 async function create(deviceId:string,mode:'phone'|'browser'){
  const r=await fetch('/api/v1/mobile/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceId,mode,startUrl})});
  const json=await r.json();
  if(!r.ok){setError(json.error?.message||json.error?.code||'设备占用或无法连接');return;}
  await refresh();setSelected({id:json.data.id,device_id:deviceId,mode,status:'READY'});
 }
 async function action(body:object){
  if(!selected)return;
  const r=await fetch('/api/v1/mobile/sessions/'+encodeURIComponent(selected.id)+'/actions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!r.ok)setError('操作失败：设备连接不可用');else void screenshot(selected.id).catch(()=>{});
 }
 async function createAvd(apiLevel:number){
  const res=await fetch('/api/v1/mobile/profiles/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiLevel})});
  const data=await res.json();
  if(!res.ok)setError(data.error?.error||'创建测试 AVD 失败');else setError('');
  await refresh();
 }
 async function deleteAvd(id:string){
  if(!window.confirm('删除 JingCang 管理的测试 AVD？该操作会删除测试设备的数据。'))return;
  const res=await fetch('/api/v1/mobile/profiles/'+encodeURIComponent(id)+'/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  const data=await res.json();
  if(!res.ok)setError(data.error?.error||'删除测试 AVD 失败');else setError('');
  await refresh();
 }
 async function controlProfile(profile:Profile,operation:'start'|'stop'){
  if(!window.confirm(operation==='start'?'启动该 Android 模拟器？':'停止由当前 Agent 启动的模拟器？'))return;
  const response=await fetch('/api/v1/mobile/profiles/'+encodeURIComponent(profile.id)+'/'+operation,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  const payload=await response.json();
  if(!response.ok)setError(payload.error?.error||'操作失败');
  else setError('');
  await refresh();
 }
 async function runAutomation(){
  if(!selected||automating)return;
  setAutomating(true);setAutomationResult('');setError('');
  try{
    const response=await fetch('/api/v1/mobile/sessions/'+encodeURIComponent(selected.id)+'/automation',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    const result=await response.json();
    if(!response.ok)throw Error(result.error?.message||result.error?.code||'自动化测试失败');
    setAutomationResult('测试通过 · 页面标题：'+result.data.title+' · 耗时 '+result.data.durationMs+'ms');
  }catch(e){setError('Appium 自动化失败：'+String(e));}
  finally{setAutomating(false);}
 }
 async function loadApps(){
  if(!selected)return;
  const response=await fetch('/api/v1/mobile/sessions/'+encodeURIComponent(selected.id)+'/apps');
  const json=await response.json();
  if(!response.ok){setError('获取 App 列表失败');return;}
  setApps(json.data?.packages||[]);
 }
 async function installApk(file:File){
  if(!selected)return;
  if(!file.name.toLowerCase().endsWith('.apk')||file.size>8*1024*1024||file.size<128){setError('仅支持不超过 8MB 的 APK 测试包');return;}
  setInstalling(true);setError('');
  try{
   const buffer=await file.arrayBuffer();
   const bytes=new Uint8Array(buffer);let binary='';
   for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
   const response=await fetch('/api/v1/mobile/sessions/'+encodeURIComponent(selected.id)+'/install',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({base64:btoa(binary)})});
   if(!response.ok)throw Error('APK 安装失败，请检查文件格式与 Android 兼容性');
   await loadApps();
  }catch(e){setError(String(e));}finally{setInstalling(false);}
 }
 async function stop(s:Session){
  await fetch('/api/v1/mobile/sessions/'+encodeURIComponent(s.id),{method:'DELETE'});
  if(selected?.id===s.id){setSelected(null);setShot('');}await refresh();
 }
 return <main style={{maxWidth:1100,margin:'30px auto',padding:'0 24px',color:'var(--text-main)'}}>
  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><div><h1>移动设备池</h1><p>Agent 状态：{status==='online'?'在线':status==='loading'?'检测中':'离线'} · Android 优先</p></div><button className="btn-secondary" onClick={()=>void refresh()}>刷新</button></div>
  {error&&<p role="alert" style={{color:'#dc2626'}}>{error}</p>}
  <label style={{display:'block',marginBottom:16}}>浏览器起始网址：<input value={startUrl} onChange={e=>setStartUrl(e.target.value)} style={{width:360,maxWidth:'100%',marginLeft:10,padding:8}} placeholder="https://example.com" /></label>
  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(270px,1fr))',gap:16}}>
   {devices.map(d=><section key={d.id} style={{border:'1px solid var(--nav-border)',padding:20,borderRadius:12}}>
    <h3>{d.model||d.id}</h3><p>{d.kind==='android-emulator'?'Android 模拟器':'Android 真机'} · Android {d.osVersion||'未知'}</p>
    <p>状态：{d.leased?'已被会话独占':d.booted?'就绪':d.state}</p>
    <div style={{display:'flex',gap:8}}><button className="btn-secondary" disabled={!d.available} onClick={()=>void create(d.id,'phone')}>完整云手机</button><button className="btn-secondary" disabled={!d.available} onClick={()=>void create(d.id,'browser')}>浏览器模式</button></div>
   </section>)}
  </div>
  {devices.length===0&&<p>暂无在线 Android 设备，请检查 Windows Agent、ADB 与 Docker 连通性。</p>}
  <h2 style={{marginTop:28}}>自动化环境诊断</h2><p>Appium 工具链：{appiumReady?'已连接（设备兼容性须实测）':'未就绪'}</p>
  <p style={{color:'var(--text-muted)'}}>展示实际检测结果，不代表 Appium 已安装或可以运行测试。</p>
  {capabilities.map(c=><div key={c.id} style={{padding:10,border:'1px solid var(--nav-border)',borderRadius:8,marginBottom:8}}><strong>{c.id}</strong> · API {c.apiLevel??'未知'} · {c.abi} · Chrome：{c.chromeInstalled?'已安装':'未安装'} · Appium：{appiumReady?'主机工具链在线':'不可用'}</div>)}
  <h2 style={{marginTop:28}}>本机 Android 系统镜像</h2>
  <p style={{fontSize:13,color:'var(--text-muted)'}}>仅列出本机现有镜像；API 24 和 27 支持创建受控测试 AVD，新系统镜像自动下载尚未实现。</p>
  {images.map(i=><div key={i.apiLevel+'-'+i.flavor+'-'+i.abi} style={{padding:9,border:'1px solid var(--nav-border)',borderRadius:8,marginBottom:7}}>Android API {i.apiLevel} · {i.flavor} · {i.abi} · 已安装 {([24,27].includes(i.apiLevel)&&i.abi==='x86'&&i.flavor==='google_apis_playstore')&&<button className="btn-secondary" onClick={()=>void createAvd(i.apiLevel)}>创建测试 AVD</button>}</div>)}
  <h2 style={{marginTop:28}}>本机已安装的 Android 模拟器配置</h2>
  <p style={{color:'var(--text-muted)'}}>展示实际存在的 AVD；仅允许删除由 JingCang 创建且没有运行的测试配置。</p>
  {profiles.map(p=><div key={p.id} style={{padding:10,border:'1px solid var(--nav-border)',borderRadius:8,marginBottom:8}}><strong>{p.id}</strong> · {p.model} · API {p.apiLevel??'未知'} <button className="btn-secondary" disabled={managedPortBusy||p.lifecycle?.status==='external'} onClick={()=>void controlProfile(p,p.managed?'stop':'start')}>{p.lifecycle?.status==='external'?'外部进程占用':p.managed?'停止托管模拟器':'启动模拟器'}</button> {/^JingCang_Test_API(?:24|27)_x86$/.test(p.id)&&<button className="btn-secondary" disabled={p.managed||p.lifecycle?.status==='external'} onClick={()=>void deleteAvd(p.id)}>删除测试 AVD</button>} {p.lifecycle&&<span style={{fontSize:12,marginLeft:8}}>运行状态：{p.lifecycle.status==='ready'?'已就绪':p.lifecycle.status==='starting'?'启动中':p.lifecycle.status==='timeout'?'启动超时':p.lifecycle.status}</span>}<div style={{fontSize:12,color:'var(--text-muted)'}}>{p.systemImage}</div></div>)}
  <h2 style={{marginTop:28}}>移动会话</h2>
  {sessions.filter(s=>s.status==='READY').map(s=><div key={s.id} style={{marginBottom:12,display:'flex',gap:12,alignItems:'center'}}>
   <span>{s.device_id} · {s.mode==='phone'?'完整云手机':'浏览器模式'}</span>
   <button className="btn-secondary" onClick={()=>setSelected(s)}>连接画面</button><button className="btn-secondary" onClick={()=>void stop(s)}>结束</button>
  </div>)}
  {selected&&<section style={{marginTop:24,border:'1px solid var(--nav-border)',borderRadius:12,padding:20}}>
   <h3>远程控制：{selected.device_id}</h3>
   <p style={{fontSize:12}}>支持 MJPEG 连续截图或定时截图模式；点击、滑动、导航按键与简单英文输入。MJPEG 不是 H.264 视频。</p>
   <button className="btn-secondary" onClick={()=>{setStreaming(x=>!x);setStreamEpoch(x=>x+1);}}>{streaming?'切换定时截图':'开启连续画面（MJPEG）'}</button>
   {selected.mode==='browser'&&<div style={{marginBottom:12}}><button className="btn-secondary" disabled={automating||!appiumReady} onClick={()=>void runAutomation()}>{automating?'Appium 自动化执行中…':'执行 Chrome 示例自动化'}</button> {automationResult&&<span role="status" style={{color:'#059669'}}>{automationResult}</span>}<p style={{fontSize:12}}>自动运行预设 https://example.com/ 页面标题检查，使用设备的独立 WebDriver 会话。</p></div>}
   {(shot||streaming)&&<img src={streaming?'/api/v1/mobile/sessions/'+encodeURIComponent(selected.id)+'/stream?v='+streamEpoch:shot} onError={()=>{if(streaming){setStreaming(false);setError('连续画面连接已断开，已恢复定时截图');}}} alt="Android 设备画面" style={{display:'block',maxWidth:'100%',maxHeight:650,cursor:'crosshair',margin:'auto',touchAction:'none'}}
    onPointerDown={e=>{const b=e.currentTarget.getBoundingClientRect();pointerStart.current={x:Math.round((e.clientX-b.left)/b.width*e.currentTarget.naturalWidth),y:Math.round((e.clientY-b.top)/b.height*e.currentTarget.naturalHeight),time:Date.now()};e.currentTarget.setPointerCapture(e.pointerId);}}
    onPointerUp={e=>{const start=pointerStart.current;pointerStart.current=null;if(!start)return;const b=e.currentTarget.getBoundingClientRect();const x=Math.round((e.clientX-b.left)/b.width*e.currentTarget.naturalWidth),y=Math.round((e.clientY-b.top)/b.height*e.currentTarget.naturalHeight);if(Math.hypot(x-start.x,y-start.y)<15)void action({type:'tap',x,y});else void action({type:'swipe',x1:start.x,y1:start.y,x2:x,y2:y,duration:Math.max(100,Math.min(2000,Date.now()-start.time))});}}
    onPointerCancel={()=>{pointerStart.current=null;}}/>}
   <div style={{marginTop:16}}><label>安装测试 APK（最大 8MB）：<input type="file" accept=".apk,application/vnd.android.package-archive" disabled={installing} onChange={e=>{const file=e.target.files?.[0];if(file)void installApk(file);e.target.value='';}} /></label>{installing&&<p>正在安装测试应用…</p>}<button className="btn-secondary" onClick={()=>void loadApps()}>查看第三方 App</button>{apps.map(pkg=><div key={pkg} style={{display:'flex',gap:8,alignItems:'center',marginTop:8}}><code>{pkg}</code><button className="btn-secondary" onClick={()=>void action({type:'launchApp',package:pkg})}>启动</button><button className="btn-secondary" onClick={()=>void action({type:'stopApp',package:pkg})}>停止</button><button className="btn-secondary" onClick={()=>{if(window.confirm('确定卸载 '+pkg+'？应用数据可能丢失。'))void action({type:'uninstallApp',package:pkg}).then(()=>loadApps());}}>卸载</button></div>)}</div>
   <div style={{display:'flex',gap:8,justifyContent:'center',marginTop:12}}><input aria-label="输入英文文本" value={typed} onChange={e=>setTyped(e.target.value)} placeholder="英文/数字输入" maxLength={120}/><button className="btn-secondary" onClick={()=>{void action({type:'text',text:typed});setTyped('');}}>输入</button></div>
   <div style={{display:'flex',justifyContent:'center',gap:12,marginTop:12}}><button className="btn-secondary" onClick={()=>void action({type:'rotate',orientation:'portrait'})}>竖屏</button><button className="btn-secondary" onClick={()=>void action({type:'rotate',orientation:'landscape'})}>横屏</button>{(['BACK','HOME','APP_SWITCH'] as const).map(k=><button key={k} className="btn-secondary" onClick={()=>void action({type:'key',key:k})}>{k}</button>)}</div>
  </section>}
 </main>;
};
