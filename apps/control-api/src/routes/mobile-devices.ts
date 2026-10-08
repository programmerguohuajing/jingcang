import type { FastifyInstance } from 'fastify';
import type { AuthService } from '../services/auth.service.js';
import { getDb } from '../db/index.js';
import crypto from 'node:crypto';

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
    const result=await fetch(new URL(path,agentUrl),{...options,headers:{...options.headers,Authorization:'Bearer '+agentToken},signal:AbortSignal.timeout(15000)});
    return result;
  }
  server.get('/api/v1/mobile/devices',async(req,reply)=>{
    if(!userFor(req)) return reply.code(401).send({success:false,error:{code:'UNAUTHORIZED'}});
    try{
      const result=await agent('/devices');
      if(!result.ok) throw new Error('AGENT_HTTP_'+result.status);
      return {success:true,data:{status:'online',...(await result.json() as object)}};
    }catch{return {success:true,data:{status:'offline',devices:[]}};}
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
  server.delete('/api/v1/mobile/sessions/:id',async(req,reply)=>{
    const row=await owner(req,reply);if(!row)return;
    db.prepare("UPDATE mobile_sessions SET status='TERMINATED',updated_at=? WHERE id=?").run(new Date().toISOString(),row.id);
    return {success:true};
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
