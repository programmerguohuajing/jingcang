export function startNodeHeartbeat({nodeId,credential,controlUrl,platform='windows',startedAt=new Date().toISOString(),managedCount=()=>0,fetchImpl=fetch,intervalMs=15000,logger=console}){
  if(!/^[A-Za-z0-9._-]{1,80}$/.test(nodeId||'')||!/^[a-f0-9]{64}$/.test(credential||''))throw Error('INVALID_NODE_CREDENTIALS');
  const url=new URL('/api/v1/mobile/nodes/'+encodeURIComponent(nodeId)+'/heartbeat',controlUrl);
  if(!['https:','http:'].includes(url.protocol))throw Error('INVALID_CONTROL_URL');
  if(url.protocol==='http:'&&!['127.0.0.1','localhost','host.docker.internal'].includes(url.hostname))throw Error('INSECURE_CONTROL_URL');
  let timer,stopped=false,busy=false,disabled=false,attempt=0;
  const tick=async()=>{
    if(stopped||disabled||busy)return;
    busy=true;
    try{
      const response=await fetchImpl(url,{method:'POST',headers:{Authorization:'Bearer '+credential,'Content-Type':'application/json'},body:JSON.stringify({platform,startedAt,uptimeSeconds:Math.max(0,Math.floor((Date.now()-Date.parse(startedAt))/1000)),managedEmulatorCount:managedCount()}),signal:AbortSignal.timeout(7000)});
      if(response.status===401||response.status===403){disabled=true;logger.warn('Node heartbeat authentication revoked; reporting disabled');return;}
      if(!response.ok)throw Error('HTTP_'+response.status);
      if(attempt>0)logger.info('Node heartbeat recovered');
      attempt=0;
    }catch(error){
      attempt++;
      if(attempt===1||attempt%10===0)logger.warn('Node heartbeat unavailable: '+String(error.message||error));
    }finally{busy=false;}
  };
  void tick();
  timer=setInterval(()=>void tick(),intervalMs);
  timer.unref?.();
  return {stop(){stopped=true;clearInterval(timer)},get disabled(){return disabled}};
}
