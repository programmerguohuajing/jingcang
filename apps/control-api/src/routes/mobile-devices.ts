import type { FastifyInstance } from 'fastify';
import type { AuthService } from '../services/auth.service.js';
import { getDb } from '../db/index.js';
import crypto from 'node:crypto';
import { PassThrough } from 'node:stream';

export function registerMobileDeviceRoutes(server: FastifyInstance, auth: AuthService) {
  const agentUrl=process.env.JINGCANG_MOBILE_AGENT_URL;
  const agentToken=process.env.JINGCANG_MOBILE_AGENT_TOKEN;
  const db=getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS mobile_sessions (
    id TEXT PRIMARY KEY, device_id TEXT NOT NULL, user_id TEXT NOT NULL,
    mode TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_mobile_device_active
    ON mobile_sessions(device_id) WHERE status='READY';`);
  function expireIdleSessions(){
    const threshold=new Date(Date.now()-2*60*60*1000).toISOString();
    db.prepare("UPDATE mobile_sessions SET status='EXPIRED' WHERE status='READY' AND updated_at < ?").run(threshold);
  }
  function touchSession(id:string){
    const threshold=new Date(Date.now()-30000).toISOString();
    db.prepare("UPDATE mobile_sessions SET updated_at=? WHERE id=? AND status='READY' AND updated_at < ?").run(new Date().toISOString(),id,threshold);
  }
  function userFor(req:any){const token=req.cookies.jc_token || req.headers.authorization?.replace('Bearer ',''); return auth.getUserFromToken(token||'');}
  async function agent(path:string, options:RequestInit={}){
    if(!agentUrl||!agentToken) throw new Error('AGENT_NOT_CONFIGURED');
    const result=await fetch(new URL(path,agentUrl),{...options,headers:{...options.headers,Authorization:'Bearer '+agentToken},signal:AbortSignal.timeout(path.endsWith('/automation') ? 180000 : path.endsWith('/install') ? 120000 : 15000)});
    return result;
  }
  server.get('/api/v1/mobile/agent-health',async(req,reply)=>{
    if(!userFor(req))return reply.code(401).send({success:false,error:{code:'UNAUTHORIZED'}});
    try{
      const response=await agent('/health');
      if(!response.ok)throw new Error('AGENT_UNHEALTHY');
      const data=await response.json();
      return {success:true,data:{...data,reachable:true,checkedAt:new Date().toISOString()}};
    }catch{return reply.code(503).send({success:false,error:{code:'AGENT_OFFLINE'}});}
  });
  server.get('/api/v1/mobile/devices',async(req,reply)=>{
    if(!userFor(req)) return reply.code(401).send({success:false,error:{code:'UNAUTHORIZED'}});
    try{
      const result=await agent('/devices');
      if(!result.ok) throw new Error('AGENT_HTTP_'+result.status);
      expireIdleSessions();
      const payload=await result.json() as {devices:Array<{id:string;state:string;booted?:boolean}>};
      const busy=new Set((db.prepare("SELECT device_id FROM mobile_sessions WHERE status='READY'").all() as Array<{device_id:string}>).map(s=>s.device_id));
      return {success:true,data:{status:'online',devices:payload.devices.map(d=>({...d,available:d.state==='device'&&d.booted===true&&!busy.has(d.id),leased:busy.has(d.id)}))}};
    }catch{return {success:true,data:{status:'offline',devices:[]}};}
  });
  server.get('/api/v1/mobile/capabilities',async(req,reply)=>{
    if(!userFor(req))return reply.code(401).send({success:false,error:{code:'UNAUTHORIZED'}});
    try{
      const response=await agent('/capabilities');
      if(!response.ok)throw Error('CAPABILITIES_UNAVAILABLE');
      return {success:true,data:await response.json()};
    }catch{return reply.code(503).send({success:false,error:{code:'AGENT_OFFLINE'}});}
  });
  server.get('/api/v1/mobile/system-images',async(req,reply)=>{
    if(!userFor(req))return reply.code(401).send({success:false,error:{code:'UNAUTHORIZED'}});
    try{
      const response=await agent('/system-images');
      if(!response.ok)throw Error('IMAGES_UNAVAILABLE');
      return {success:true,data:await response.json()};
    }catch{return reply.code(503).send({success:false,error:{code:'AGENT_OFFLINE'}});}
  });
  server.get('/api/v1/mobile/profiles',async(req,reply)=>{
    if(!userFor(req))return reply.code(401).send({success:false,error:{code:'UNAUTHORIZED'}});
    try{
      const response=await agent('/profiles');
      if(!response.ok)throw Error('PROFILES_UNAVAILABLE');
      return {success:true,data:await response.json()};
    }catch{return reply.code(503).send({success:false,error:{code:'AGENT_OFFLINE'}});}
  });
  server.post('/api/v1/mobile/profiles/create',async(req,reply)=>{
    const user=userFor(req);
    if(!user)return reply.code(401).send({success:false});
    if(user.role!=='admin')return reply.code(403).send({success:false,error:{code:'ADMIN_ONLY'}});
    const body=req.body as {apiLevel?:number};
    if(!body || ![24,27,34].includes(body.apiLevel??-1))return reply.code(400).send({success:false,error:{code:'UNSUPPORTED_IMAGE'}});
    try{
      const response=await agent('/profiles/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiLevel:body.apiLevel})});
      const result=await response.json();
      return reply.code(response.status).send(response.ok?{success:true,data:result}:{success:false,error:result});
    }catch{return reply.code(503).send({success:false,error:{code:'AGENT_OFFLINE'}});}
  });
  server.post('/api/v1/mobile/profiles/:id/delete',async(req,reply)=>{
    const user=userFor(req);
    if(!user)return reply.code(401).send({success:false});
    if(user.role!=='admin')return reply.code(403).send({success:false,error:{code:'ADMIN_ONLY'}});
    const {id}=req.params as {id:string};
    if(!/^JingCang_Test_API(?:24|27)_x86$|^JingCang_Test_API34_x86_64$/.test(id))return reply.code(400).send({success:false,error:{code:'INVALID_MANAGED_AVD'}});
    // The Agent validates the managed marker and exact running AVD identity.
    // An unrelated lease on the fixed emulator port must not block deleting an offline profile.
    try{
      const response=await agent('/profiles/'+id+'/delete',{method:'POST'});
      const result=await response.json();
      return reply.code(response.status).send(response.ok?{success:true,data:result}:{success:false,error:result});
    }catch{return reply.code(503).send({success:false,error:{code:'AGENT_OFFLINE'}});}
  });
  server.post('/api/v1/mobile/profiles/:id/:operation',async(req,reply)=>{
    const user=userFor(req);
    if(!user)return reply.code(401).send({success:false});
    if(user.role!=='admin')return reply.code(403).send({success:false,error:{code:'ADMIN_ONLY'}});
    const {id,operation}=req.params as {id:string;operation:string};
    if(!/^[A-Za-z0-9._-]{1,80}$/.test(id)||!['start','stop'].includes(operation))return reply.code(400).send({success:false,error:{code:'INVALID_REQUEST'}});
    if(operation==='start'||operation==='stop'){
      expireIdleSessions();
      const inUse=db.prepare("SELECT id FROM mobile_sessions WHERE device_id='emulator-5580' AND status='READY' LIMIT 1").get();
      if(inUse)return reply.code(409).send({success:false,error:{code:'DEVICE_BUSY'}});
    }
    try{
      const response=await agent('/profiles/'+encodeURIComponent(id)+'/'+operation,{method:'POST'});
      const result=await response.json();
      return reply.code(response.status).send(response.ok?{success:true,data:result}:{success:false,error:result});
    }catch{return reply.code(503).send({success:false,error:{code:'AGENT_OFFLINE'}});}
  });
  server.get('/api/v1/mobile/sessions',async(req,reply)=>{
    const user=userFor(req);if(!user)return reply.code(401).send({success:false});
    expireIdleSessions();
    const rows=db.prepare('SELECT * FROM mobile_sessions WHERE user_id=? OR ?=1 ORDER BY created_at DESC LIMIT 100').all(user.id,user.role==='admin'?1:0);
    return {success:true,data:rows};
  });
  server.post('/api/v1/mobile/sessions',async(req,reply)=>{
    const user=userFor(req);if(!user)return reply.code(401).send({success:false});
    const data=req.body as {deviceId?:string;mode?:string;startUrl?:string};
    if(!data || !/^[\w.:-]{1,80}$/.test(data.deviceId||'') || !['phone','browser'].includes(data.mode||''))return reply.code(400).send({success:false,error:{code:'INVALID_REQUEST'}});
    try{
      expireIdleSessions();
      const response=await agent('/devices');if(!response.ok)throw Error('AGENT_OFFLINE');
      const info=await response.json() as {devices:Array<{id:string;state:string;booted?:boolean}>};
      if(!info.devices.some(d=>d.id===data.deviceId && d.state==='device' && d.booted)) return reply.code(409).send({success:false,error:{code:'DEVICE_UNAVAILABLE'}});
      const id='mobile-'+crypto.randomUUID();
      db.prepare("INSERT INTO mobile_sessions VALUES (?,?,?,?,?,?,?)").run(id,data.deviceId!,user.id,data.mode!,'READY',new Date().toISOString(),new Date().toISOString());
      if(data.mode==='browser') {
        try {
          const url = new URL(data.startUrl || 'https://example.com');
          if(!['http:','https:'].includes(url.protocol) || url.username || url.password) throw Error('INVALID_URL');
          const started=await agent('/devices/'+encodeURIComponent(data.deviceId!)+'/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'navigate',url:url.href})});
          if(!started.ok) throw Error('CHROME_LAUNCH_FAILED');
        } catch(e) {
          db.prepare('DELETE FROM mobile_sessions WHERE id=?').run(id);
          throw e;
        }
      }
      return reply.code(201).send({success:true,data:{id,deviceId:data.deviceId,mode:data.mode,status:'READY'}});
    }catch(e:any){return reply.code(409).send({success:false,error:{code:'DEVICE_BUSY_OR_OFFLINE',message:String(e.message)}});}
  });
  async function owner(req:any,reply:any){
    const user=userFor(req);if(!user){reply.code(401).send({success:false});return null;}
    const {id}=req.params as {id:string};
    const row=db.prepare('SELECT * FROM mobile_sessions WHERE id=?').get(id) as any;
    if(!row){reply.code(404).send({success:false});return null;}
    if(row.user_id!==user.id && user.role!=='admin'){reply.code(403).send({success:false});return null;}
    return row;
  }
  server.post('/api/v1/mobile/sessions/:id/heartbeat',async(req,reply)=>{
    const row=await owner(req,reply);if(!row)return;
    expireIdleSessions();
    const status=db.prepare('SELECT status FROM mobile_sessions WHERE id=?').get(row.id) as {status:string};
    if(status.status!=='READY')return reply.code(409).send({success:false,error:{code:'SESSION_NOT_READY'}});
    db.prepare("UPDATE mobile_sessions SET updated_at=? WHERE id=? AND status='READY'").run(new Date().toISOString(),row.id);
    return {success:true,data:{id:row.id,status:'READY',heartbeatIntervalMs:30000}};
  });
  server.delete('/api/v1/mobile/sessions/:id',async(req,reply)=>{
    const row=await owner(req,reply);if(!row)return;
    db.prepare("UPDATE mobile_sessions SET status='TERMINATED',updated_at=? WHERE id=?").run(new Date().toISOString(),row.id);
    return {success:true};
  });
  server.get('/api/v1/mobile/sessions/:id/stream',async(req,reply)=>{
    const row=await owner(req,reply);if(!row)return;
    if(row.status!=='READY')return reply.code(409).send({success:false,error:{code:'SESSION_NOT_READY'}});
    const boundary='jingcang-frame';
    const output=new PassThrough({highWaterMark:1024*1024});
    let closed=false;
    const stop=()=>{closed=true;output.end();};
    reply.raw.on('close',stop);
    reply.header('Content-Type','multipart/x-mixed-replace; boundary='+boundary);
    reply.header('Cache-Control','no-store, no-cache, must-revalidate');
    reply.header('X-Accel-Buffering','no');
    reply.header('Connection','keep-alive');
    reply.send(output);
    void (async()=>{
      const deadline=Date.now()+100000;
      while(!closed&&Date.now()<deadline){
        try{
          const shot=await agent('/devices/'+encodeURIComponent(row.device_id)+'/screenshot');
          if(!shot.ok)break;
          const buffer=Buffer.from(await shot.arrayBuffer());
          if(buffer.length<8||buffer.length>12*1024*1024)break;
          if(closed)break;
          const chunk=Buffer.concat([Buffer.from('--'+boundary+'\r\nContent-Type: image/png\r\nContent-Length: '+buffer.length+'\r\n\r\n'),buffer,Buffer.from('\r\n')]);
          if(!output.write(chunk))await new Promise<void>(resolve=>{output.once('drain',resolve);output.once('close',resolve);});
          touchSession(row.id);
        }catch{break;}
        if(!closed)await new Promise(resolve=>setTimeout(resolve,550));
      }
      if(!closed)output.end();
    })();
    return reply;
  });
  server.get('/api/v1/mobile/sessions/:id/screenshot',async(req,reply)=>{
    const row=await owner(req,reply);if(!row)return;
    if(row.status!=='READY')return reply.code(409).send({success:false});
    try {
      const response=await agent('/devices/'+encodeURIComponent(row.device_id)+'/screenshot');
      if(!response.ok)throw Error('SCREENSHOT_FAILED');
      touchSession(row.id);
      reply.header('Cache-Control','no-store').type('image/png');
      return reply.send(Buffer.from(await response.arrayBuffer()));
    }catch{return reply.code(503).send({success:false,error:{code:'AGENT_OFFLINE'}});}
  });
  server.get('/api/v1/mobile/sessions/:id/apps',async(req,reply)=>{
    const row=await owner(req,reply);if(!row)return;
    if(row.status!=='READY')return reply.code(409).send({success:false});
    try{
      const response=await agent('/devices/'+encodeURIComponent(row.device_id)+'/apps');
      if(!response.ok)throw Error('APP_LIST_FAILED');
      touchSession(row.id);
      return {success:true,data:await response.json()};
    }catch{return reply.code(503).send({success:false,error:{code:'AGENT_OFFLINE'}});}
  });
  server.post('/api/v1/mobile/sessions/:id/install', {bodyLimit: 12*1024*1024}, async(req,reply)=>{
    const row=await owner(req,reply);if(!row)return;
    if(row.status!=='READY')return reply.code(409).send({success:false});
    const payload=req.body as {base64?:unknown};
    if(typeof payload?.base64!=='string' || payload.base64.length>11*1024*1024 || payload.base64.length<100) return reply.code(400).send({success:false,error:{code:'INVALID_APK'}});
    try{
      const response=await agent('/devices/'+encodeURIComponent(row.device_id)+'/install',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({base64:payload.base64})});
      if(!response.ok)return reply.code(response.status).send({success:false,error:{code:'INSTALL_FAILED'}});
      touchSession(row.id);
      return {success:true,data:await response.json()};
    }catch{return reply.code(503).send({success:false,error:{code:'AGENT_OFFLINE'}});}
  });
  server.post('/api/v1/mobile/sessions/:id/automation',async(req,reply)=>{
    const row=await owner(req,reply);if(!row)return;
    if(row.status!=='READY')return reply.code(409).send({success:false,error:{code:'SESSION_NOT_READY'}});
    if(row.mode!=='browser')return reply.code(400).send({success:false,error:{code:'BROWSER_MODE_REQUIRED'}});
    try{
      const response=await agent('/devices/'+encodeURIComponent(row.device_id)+'/automation',{method:'POST'});
      const result=await response.json();
      if(!response.ok)return reply.code(response.status).send({success:false,error:{code:'AUTOMATION_FAILED',message:String(result.message||'').slice(0,350)}});
      touchSession(row.id);
      return {success:true,data:result};
    }catch{return reply.code(503).send({success:false,error:{code:'AGENT_OFFLINE'}});}
  });
  server.post('/api/v1/mobile/sessions/:id/actions',async(req,reply)=>{
    const row=await owner(req,reply);if(!row)return;
    if(row.status!=='READY')return reply.code(409).send({success:false});
    try{
      const result=await agent('/devices/'+encodeURIComponent(row.device_id)+'/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(req.body)});
      if(!result.ok)return reply.code(result.status).send({success:false,error:{code:'ACTION_REJECTED'}});
      touchSession(row.id);
      return {success:true};
    }catch{return reply.code(503).send({success:false,error:{code:'AGENT_OFFLINE'}});}
  });
}
