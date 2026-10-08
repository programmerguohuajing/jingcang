import React, { useCallback, useEffect, useRef, useState } from 'react';
import {H264Canvas} from '../components/H264Canvas';
import '../mobile-page.css';
import { Smartphone, MonitorSmartphone, Server, Activity, RefreshCw, HardDrive, Layers3, Radio, Settings2, Play, Wifi } from 'lucide-react';
type Device = {id:string;kind:string;state:string;model?:string;osVersion?:string;booted?:boolean;available?:boolean;leased?:boolean;nodeId?:string};
type Session = {id:string;device_id:string;mode:string;status:string;node_id?:string};
type Capability = {id:string;apiLevel:number|null;abi:string;chromeInstalled:boolean;securityPatch:string;appiumStatus:string};
type SystemImage = {apiLevel:number;flavor:string;abi:string;installed:boolean};
type Profile = {id:string;model:string;apiLevel:number|null;systemImage:string;managed?:boolean;lifecycle?:{status:string;serial:string}|null};
type RemoteDevice = {nodeId:string;id:string;kind:string;state:string;booted:boolean;online:boolean;routable?:boolean;available?:boolean;leased?:boolean};
export const MobileDevicesPage: React.FC = () => {
 const [tab,setTab]=useState<'devices'|'nodes'|'environment'|'sessions'>('devices');
 const [devices,setDevices]=useState<Device[]>([]);
 const [profiles,setProfiles]=useState<Profile[]>([]);
 const [images,setImages]=useState<SystemImage[]>([]);
 const [capabilities,setCapabilities]=useState<Capability[]>([]);
 const [appiumReady,setAppiumReady]=useState(false);
 const [sessions,setSessions]=useState<Session[]>([]);
 const managedPortBusy=sessions.some(s=>s.device_id==='emulator-5580'&&s.status==='READY');
 const [status,setStatus]=useState('loading');
 const [agentHealth,setAgentHealth]=useState<{nodeId:string;uptimeSeconds:number;managedEmulatorCount:number;automationInProgress:number}|null>(null);
 const [agentNodes,setAgentNodes]=useState<Array<{node_id:string;platform:string;online:boolean;routable?:boolean;last_seen_at:string}>>([]);
 const [remoteDevices,setRemoteDevices]=useState<RemoteDevice[]>([]);
 const [error,setError]=useState('');
 const [selected,setSelected]=useState<Session|null>(null);
 const [shot,setShot]=useState('');
 const [streaming,setStreaming]=useState(false);
 const [h264,setH264]=useState(false);
 const [h264Epoch,setH264Epoch]=useState(0);
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
   const [r,s,p,c,i,h]=await Promise.all([fetch('/api/v1/mobile/devices'),fetch('/api/v1/mobile/sessions'),fetch('/api/v1/mobile/profiles'),fetch('/api/v1/mobile/capabilities'),fetch('/api/v1/mobile/system-images'),fetch('/api/v1/mobile/agent-health')]);
   const nodesResponse=await fetch('/api/v1/mobile/nodes');
   if(nodesResponse.ok){const nodeData=await nodesResponse.json();setAgentNodes(nodeData.data?.nodes||[]);}
   const inventoryResponse=await fetch('/api/v1/mobile/node-devices');
   if(inventoryResponse.ok){const inventory=await inventoryResponse.json();setRemoteDevices(inventory.data?.devices||[]);}else setRemoteDevices([]);
   if(h.ok){const data=await h.json();setAgentHealth(data.data||null);}else setAgentHealth(null);
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
 useEffect(()=>{if(!selected||streaming||h264)return;void screenshot(selected.id).catch(e=>setError(String(e)));const i=setInterval(()=>void screenshot(selected.id).catch(()=>{}),1800);return()=>clearInterval(i)},[selected,screenshot,streaming,h264]);
 useEffect(()=>{if(!selected||!streaming)return;const i=setInterval(()=>setStreamEpoch(x=>x+1),90000);return()=>clearInterval(i)},[selected,streaming]);
 useEffect(()=>{
  if(!selected||selected.status!=='READY')return;
  const id=selected.id;
  const keepAlive=async()=>{
   try{
    const r=await fetch('/api/v1/mobile/sessions/'+encodeURIComponent(id)+'/heartbeat',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    if(!r.ok){setError('移动设备会话心跳失败，请检查会话是否已结束');if(r.status===409||r.status===404)setSelected(null);}
   }catch{setError('移动设备会话心跳连接中断');}
  };
  const interval=setInterval(()=>void keepAlive(),30000);
  return()=>clearInterval(interval);
 },[selected]);
 async function create(deviceId:string,mode:'phone'|'browser',nodeId?:string){
  const r=await fetch('/api/v1/mobile/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceId,mode,startUrl,nodeId})});
  const json=await r.json();
  if(!r.ok){setError(json.error?.message||json.error?.code||'设备占用或无法连接');return;}
  await refresh();setSelected({id:json.data.id,device_id:deviceId,mode,status:'READY',node_id:nodeId});
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
 return <main className="mobile-workspace">
  <header className="mobile-page-header">
   <div className="mobile-heading"><div className="mobile-heading-icon"><MonitorSmartphone size={24}/></div><div><div className="mobile-eyebrow">DEVICE CLOUD / 设备云</div><h1>移动设备池</h1><p>统一管理 Android 设备、Agent 节点、自动化环境与远程会话</p></div></div>
   <div className="mobile-header-actions"><span className={'mobile-status '+(status==='online'?'is-online':'is-offline')}><span className="mobile-dot"/>{status==='online'?'Agent 在线':status==='loading'?'检测中':'Agent 离线'}</span><button className="btn-secondary mobile-refresh" onClick={()=>void refresh()}><RefreshCw size={15}/>刷新数据</button></div>
  </header>
  <div className="mobile-kpis">
   <div className="card mobile-kpi"><div className="mobile-kpi-icon"><Smartphone size={21}/></div><div><span>已发现设备</span><strong>{devices.length+remoteDevices.filter(d=>!devices.some(x=>x.id===d.id&&x.nodeId===d.nodeId)).length}</strong><small>Android 模拟器 / 真机</small></div></div>
   <div className="card mobile-kpi"><div className="mobile-kpi-icon"><Wifi size={21}/></div><div><span>可用设备</span><strong>{devices.filter(d=>d.available).length+remoteDevices.filter(d=>d.available&&!devices.some(x=>x.id===d.id&&x.nodeId===d.nodeId)).length}</strong><small>可创建独占会话</small></div></div>
   <div className="card mobile-kpi"><div className="mobile-kpi-icon"><Server size={21}/></div><div><span>在线节点</span><strong>{agentNodes.filter(n=>n.online).length}</strong><small>共 {agentNodes.length} 个登记节点</small></div></div>
   <div className="card mobile-kpi"><div className="mobile-kpi-icon"><Activity size={21}/></div><div><span>活动会话</span><strong>{sessions.filter(s=>s.status==='READY').length}</strong><small>Appium {appiumReady?'已就绪':'未就绪'}</small></div></div>
  </div>
  <nav className="mobile-tabs" aria-label="移动设备管理分类">
   {([{id:'devices',label:'设备池',Icon:Smartphone},{id:'nodes',label:'节点与真机',Icon:Server},{id:'environment',label:'运行环境',Icon:Settings2},{id:'sessions',label:'会话管理',Icon:Play}] as const).map(t=><button key={t.id} type="button" className={'mobile-tab '+(tab===t.id?'active':'')} aria-current={tab===t.id?'page':undefined} onClick={()=>setTab(t.id)}><t.Icon size={16}/>{t.label}</button>)}
  </nav>
  {error&&<p role="alert" style={{color:'#dc2626'}}>{error}</p>}
  {tab==='devices'&&<section className="card mobile-panel"><div className="mobile-section-heading"><div><h2><Smartphone size={19}/> 设备资源</h2><p>选择在线设备，启动完整云手机或移动浏览器会话</p></div></div><label className="mobile-url-field">浏览器起始网址：<input value={startUrl} onChange={e=>setStartUrl(e.target.value)} style={{width:360,maxWidth:'100%',marginLeft:10}} placeholder="https://example.com" /></label>
  <div className="mobile-device-grid">
   {devices.map(d=><section key={d.nodeId+':'+d.id} className="mobile-device-card">
    <h3>{d.model||d.id}</h3><p>{d.kind==='android-emulator'?'Android 模拟器':'Android 真机'} · Android {d.osVersion||'未知'} · 节点 {d.nodeId||'windows-local-dev'}</p>
    <p>状态：{d.leased?'已被会话独占':d.booted?'就绪':d.state}</p>
    <div style={{display:'flex',gap:8}}><button className="btn-secondary" disabled={!d.available} onClick={()=>void create(d.id,'phone',d.nodeId)}>完整云手机</button><button className="btn-secondary" disabled={!d.available} onClick={()=>void create(d.id,'browser',d.nodeId)}>浏览器模式</button></div>
   </section>)}
  </div>
  {devices.length===0&&<p>暂无在线 Android 设备，请检查各节点 Agent、ADB 与网络连通性。</p>}
  </section>}
  {tab==='nodes'&&<section className="card mobile-panel"><div className="mobile-section-heading"><div><h2><Server size={19}/> Agent 节点</h2><p>认证心跳、节点可调度性与最后在线时间</p></div></div>
  {agentNodes.map(n=><p key={n.node_id}>{n.node_id} · {n.platform} · {n.online?'最近 45 秒有心跳':'心跳已超时'} · {n.routable?'可调度':(n.online?'已在线未登记端点':'不可调度')} · 最后检测 {n.last_seen_at}</p>)}
  {agentNodes.length===0&&<p>尚无节点登记。管理员可在节点上运行 Agent 并配置 JINGCANG_NODE_CONTROL_URL/JINGCANG_NODE_CREDENTIAL 主动心跳。</p>}
  </section>}
  {tab==='nodes'&&<section className="card mobile-panel"><h2><Smartphone size={19}/> Android 真机池</h2>
  <p style={{fontSize:13,color:'var(--text-muted)'}}>通过 ADB 发现的真实 Android 设备（USB/网络），节点在线且设备可用时可创建独占会话；真机断线后会话将被安全释放。</p>
  {remoteDevices.filter(d=>d.kind==='android-real').map(d=><div key={d.nodeId+':'+d.id} style={{padding:10,border:'1px solid var(--nav-border)',borderRadius:8,marginBottom:8,display:'flex',gap:10,alignItems:'center',justifyContent:'space-between'}}>
   <div><strong>{d.id}</strong> · 节点 {d.nodeId} · Android 真机 · {d.online?(d.booted?'在线已就绪':d.state):'节点离线'}{d.leased&&' · 已被会话独占'}</div>
   <div style={{display:'flex',gap:8}}><button className="btn-secondary" disabled={!d.available} onClick={()=>void create(d.id,'phone',d.nodeId)}>完整云手机</button><button className="btn-secondary" disabled={!d.available} onClick={()=>void create(d.id,'browser',d.nodeId)}>浏览器模式</button></div>
  </div>)}
  {remoteDevices.filter(d=>d.kind==='android-real').length===0&&<p>当前没有可用的 Android 真机接入。将真机通过 USB 连接并授权调试后，由节点 Agent 自动发现并纳入真机池。</p>}
  </section>}
  {tab==='nodes'&&<section className="card mobile-panel"><h2><Radio size={19}/> 远程节点设备目录</h2>
  <p style={{fontSize:13,color:'var(--text-muted)'}}>设备由各节点独立认证上报；已登记端点的在线节点设备可创建独占会话，操作请求会按节点归属安全转发。</p>
  {remoteDevices.map(d=><div key={d.nodeId+':'+d.id} style={{padding:10,border:'1px solid var(--nav-border)',borderRadius:8,marginBottom:8,display:'flex',gap:10,alignItems:'center',justifyContent:'space-between'}}><div><strong>{d.id}</strong> · 节点 {d.nodeId} · {d.kind==='android-real'?'Android 真机':'Android 模拟器'} · {d.online?(d.booted?'在线已启动':d.state):'节点离线'}{d.leased&&' · 已被独占'}</div><div style={{display:'flex',gap:8}}><button className="btn-secondary" disabled={!d.available} onClick={()=>void create(d.id,'phone',d.nodeId)}>完整云手机</button><button className="btn-secondary" disabled={!d.available} onClick={()=>void create(d.id,'browser',d.nodeId)}>浏览器模式</button></div></div>)}
  {remoteDevices.length===0&&<p>尚无远程节点设备上报。</p>}
  </section>}
  {tab==='environment'&&<section className="card mobile-panel"><h2><Activity size={19}/> 自动化环境诊断</h2><p>Appium 工具链：{appiumReady?'已连接（设备兼容性须实测）':'未就绪'}</p>
  <p style={{color:'var(--text-muted)'}}>展示实际检测结果，不代表 Appium 已安装或可以运行测试。</p>
  {capabilities.map(c=><div key={c.id} style={{padding:10,border:'1px solid var(--nav-border)',borderRadius:8,marginBottom:8}}><strong>{c.id}</strong> · API {c.apiLevel??'未知'} · {c.abi} · Chrome：{c.chromeInstalled?'已安装':'未安装'} · Appium：{appiumReady?'主机工具链在线':'不可用'}</div>)}
  </section>}
  {tab==='environment'&&<section className="card mobile-panel"><h2><HardDrive size={19}/> Android 系统镜像</h2>
  <p style={{fontSize:13,color:'var(--text-muted)'}}>仅列出本机现有镜像；本机已安装的 API 24、27 和 34 镜像可用于创建受控测试 AVD；仅显示已安装镜像，系统镜像管理仍为开发阶段。</p>
  {images.map(i=><div key={i.apiLevel+'-'+i.flavor+'-'+i.abi} style={{padding:9,border:'1px solid var(--nav-border)',borderRadius:8,marginBottom:7}}>Android API {i.apiLevel} · {i.flavor} · {i.abi} · 已安装 {(([24,27].includes(i.apiLevel)&&i.abi==='x86'&&i.flavor==='google_apis_playstore')||(i.apiLevel===34&&i.abi==='x86_64'&&i.flavor==='google_apis'))&&<button className="btn-secondary" onClick={()=>void createAvd(i.apiLevel)}>创建测试 AVD</button>}</div>)}
  </section>}
  {tab==='environment'&&<section className="card mobile-panel"><h2><Layers3 size={19}/> 本机模拟器配置</h2>
  <p style={{color:'var(--text-muted)'}}>展示实际存在的 AVD；仅允许删除由 JingCang 创建且没有运行的测试配置。</p>
  {profiles.map(p=><div key={p.id} style={{padding:10,border:'1px solid var(--nav-border)',borderRadius:8,marginBottom:8}}><strong>{p.id}</strong> · {p.model} · API {p.apiLevel??'未知'} <button className="btn-secondary" disabled={managedPortBusy||p.lifecycle?.status==='external'} onClick={()=>void controlProfile(p,p.managed?'stop':'start')}>{p.lifecycle?.status==='external'?'外部进程占用':p.managed?'停止托管模拟器':'启动模拟器'}</button> {/^JingCang_Test_API(?:24|27)_x86$|^JingCang_Test_API34_x86_64$/.test(p.id)&&<button className="btn-secondary" disabled={p.managed||p.lifecycle?.status==='external'} onClick={()=>void deleteAvd(p.id)}>删除测试 AVD</button>} {p.lifecycle&&<span style={{fontSize:12,marginLeft:8}}>运行状态：{p.lifecycle.status==='ready'?'已就绪':p.lifecycle.status==='starting'?'启动中':p.lifecycle.status==='timeout'?'启动超时':p.lifecycle.status}</span>}<div style={{fontSize:12,color:'var(--text-muted)'}}>{p.systemImage}</div></div>)}
  </section>}
  {tab==='sessions'&&<section className="card mobile-panel"><div className="mobile-section-heading"><div><h2><Play size={19}/> 移动会话</h2><p>连接正在运行的 Android 设备，管理远程操作和画面流</p></div></div>
  {sessions.filter(s=>s.status==='READY').map(s=><div key={s.id} style={{marginBottom:12,display:'flex',gap:12,alignItems:'center'}}>
   <span>{s.device_id} · {s.mode==='phone'?'完整云手机':'浏览器模式'}</span>
   <button className="btn-secondary" onClick={()=>{setSelected(s);setH264(true);setStreaming(false);}}>连接画面</button><button className="btn-secondary" onClick={()=>void stop(s)}>结束</button>
  </div>)}
  {selected&&<section className="mobile-controller">
   <h3>远程控制：{selected.device_id}</h3>
   <p style={{fontSize:12}}>优先使用 H.264/WebCodecs 低延迟视频；设备编码或浏览器解码不可用时可以使用 MJPEG 或定时截图。</p>
   <button className="btn-secondary" onClick={()=>{setH264(true);setStreaming(false);}}>开启 H.264 视频</button>
   <button className="btn-secondary" onClick={()=>{setH264(false);setStreaming(x=>!x);setStreamEpoch(x=>x+1);}}>{streaming?'切换定时截图':'开启连续画面（MJPEG）'}</button>
   {selected.mode==='browser'&&<div style={{marginBottom:12}}><button className="btn-secondary" disabled={automating||!appiumReady} onClick={()=>void runAutomation()}>{automating?'Appium 自动化执行中…':'执行 Chrome 示例自动化'}</button> {automationResult&&<span role="status" style={{color:'#059669'}}>{automationResult}</span>}<p style={{fontSize:12}}>自动运行预设 https://example.com/ 页面标题检查，使用设备的独立 WebDriver 会话。</p></div>}
   {h264&&<H264Canvas key={selected.id+':'+h264Epoch} sessionId={selected.id} onEnded={()=>{setTimeout(()=>setH264Epoch(x=>x+1),1000);}} onFailure={()=>{setH264(false);setStreaming(true);setError('H.264 视频不可用，已自动切换 MJPEG');}} onGesture={(x1,y1,x2,y2,duration)=>{if(Math.hypot(x2-x1,y2-y1)<15)void action({type:'tap',x:x2,y:y2});else void action({type:'swipe',x1,y1,x2,y2,duration:Math.max(100,Math.min(2000,duration))});}}/>}
   {!h264&&(shot||streaming)&&<img src={streaming?'/api/v1/mobile/sessions/'+encodeURIComponent(selected.id)+'/stream?v='+streamEpoch:shot} onError={()=>{if(streaming){setStreaming(false);setError('连续画面连接已断开，已恢复定时截图');}}} alt="Android 设备画面" style={{display:'block',maxWidth:'100%',maxHeight:650,cursor:'crosshair',margin:'auto',touchAction:'none'}}
    onPointerDown={e=>{const b=e.currentTarget.getBoundingClientRect();pointerStart.current={x:Math.round((e.clientX-b.left)/b.width*e.currentTarget.naturalWidth),y:Math.round((e.clientY-b.top)/b.height*e.currentTarget.naturalHeight),time:Date.now()};e.currentTarget.setPointerCapture(e.pointerId);}}
    onPointerUp={e=>{const start=pointerStart.current;pointerStart.current=null;if(!start)return;const b=e.currentTarget.getBoundingClientRect();const x=Math.round((e.clientX-b.left)/b.width*e.currentTarget.naturalWidth),y=Math.round((e.clientY-b.top)/b.height*e.currentTarget.naturalHeight);if(Math.hypot(x-start.x,y-start.y)<15)void action({type:'tap',x,y});else void action({type:'swipe',x1:start.x,y1:start.y,x2:x,y2:y,duration:Math.max(100,Math.min(2000,Date.now()-start.time))});}}
    onPointerCancel={()=>{pointerStart.current=null;}}/>}
   <div style={{marginTop:16}}><label>安装测试 APK（最大 8MB）：<input type="file" accept=".apk,application/vnd.android.package-archive" disabled={installing} onChange={e=>{const file=e.target.files?.[0];if(file)void installApk(file);e.target.value='';}} /></label>{installing&&<p>正在安装测试应用…</p>}<button className="btn-secondary" onClick={()=>void loadApps()}>查看第三方 App</button>{apps.map(pkg=><div key={pkg} style={{display:'flex',gap:8,alignItems:'center',marginTop:8}}><code>{pkg}</code><button className="btn-secondary" onClick={()=>void action({type:'launchApp',package:pkg})}>启动</button><button className="btn-secondary" onClick={()=>void action({type:'stopApp',package:pkg})}>停止</button><button className="btn-secondary" onClick={()=>{if(window.confirm('确定卸载 '+pkg+'？应用数据可能丢失。'))void action({type:'uninstallApp',package:pkg}).then(()=>loadApps());}}>卸载</button></div>)}</div>
   <div style={{display:'flex',gap:8,justifyContent:'center',marginTop:12}}><input aria-label="输入英文文本" value={typed} onChange={e=>setTyped(e.target.value)} placeholder="英文/数字输入" maxLength={120}/><button className="btn-secondary" onClick={()=>{void action({type:'text',text:typed});setTyped('');}}>输入</button></div>
   <div style={{display:'flex',justifyContent:'center',gap:12,marginTop:12}}><button className="btn-secondary" onClick={()=>void action({type:'rotate',orientation:'portrait'})}>竖屏</button><button className="btn-secondary" onClick={()=>void action({type:'rotate',orientation:'landscape'})}>横屏</button>{(['BACK','HOME','APP_SWITCH'] as const).map(k=><button key={k} className="btn-secondary" onClick={()=>void action({type:'key',key:k})}>{k}</button>)}</div>
  </section>}
  </section>}
 </main>;
};
