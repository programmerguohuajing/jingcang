import {useEffect,useRef} from 'react';

type Props={sessionId:string;onFailure:()=>void;onEnded:()=>void;onGesture:(x1:number,y1:number,x2:number,y2:number,duration:number)=>void};

export function H264Canvas({sessionId,onFailure,onEnded,onGesture}:Props){
 const canvas=useRef<HTMLCanvasElement>(null);
 const failureRef=useRef(onFailure);
 failureRef.current=onFailure;
 const endedRef=useRef(onEnded);
 endedRef.current=onEnded;
 const pointer=useRef<{x:number;y:number;t:number}|null>(null);
 useEffect(()=>{
  const abort=new AbortController();
  let decoder:VideoDecoder|null=null;
  let idleTimer:ReturnType<typeof setTimeout>|undefined;
  let watchdog:ReturnType<typeof setTimeout>|undefined;
  let failed=false;
  const fail=()=>{if(!abort.signal.aborted&&!failed){failed=true;failureRef.current();}};
  void (async()=>{
   if(typeof VideoDecoder==='undefined')return fail();
   watchdog=setTimeout(fail,12000);
   decoder=new VideoDecoder({
    output:frame=>{
     const el=canvas.current;
     if(el){
      if(el.width!==frame.displayWidth)el.width=frame.displayWidth;
      if(el.height!==frame.displayHeight)el.height=frame.displayHeight;
      el.getContext('2d')?.drawImage(frame,0,0,el.width,el.height);
     }
     frame.close();
     if(watchdog)clearTimeout(watchdog);
    },
    error:fail
   });
   const response=await fetch('/api/v1/mobile/sessions/'+encodeURIComponent(sessionId)+'/h264',{signal:abort.signal});
   if(!response.ok||!response.body)return fail();
   const reader=response.body.getReader();
   let bytes=new Uint8Array(0);
   let sps:Uint8Array|null=null,pps:Uint8Array|null=null,pts=0,submitted=0;
   const startCode=(data:Uint8Array,i:number)=>{
    if(data[i]!==0||data[i+1]!==0)return 0;
    return data[i+2]===1?3:data[i+2]===0&&data[i+3]===1?4:0;
   };
   const prefix=(nal:Uint8Array)=>{
    const result=new Uint8Array(nal.length+4);
    result.set([0,0,0,1]);result.set(nal,4);return result;
   };
   const emit=(nal:Uint8Array)=>{
    if(!nal.length)return;
    const type=nal[0]&31;
    if(type===7){
     sps=prefix(nal);
     if(nal.length>=4&&decoder?.state==='unconfigured'){
      const codec='avc1.'+Array.from(nal.subarray(1,4),v=>v.toString(16).padStart(2,'0')).join('').toUpperCase();
      try{decoder.configure({codec,optimizeForLatency:true} as VideoDecoderConfig);}catch{fail();}
     }
    }else if(type===8)pps=prefix(nal);
    else if((type===1||type===5)&&decoder?.state==='configured'){
     const key=type===5;
     const units=key&&sps&&pps?[sps,pps,prefix(nal)]:[prefix(nal)];
     const result=new Uint8Array(units.reduce((n,x)=>n+x.length,0));
     let at=0;for(const unit of units){result.set(unit,at);at+=unit.length;}
     try{
      if(decoder.decodeQueueSize<8){decoder.decode(new EncodedVideoChunk({type:key?'key':'delta',timestamp:pts,data:result}));submitted++;}
      pts+=33333;
     }catch{fail();}
    }
   };
   const flushLastNal=()=>{
    if(abort.signal.aborted||!bytes.length)return;
    const size=startCode(bytes,0);
    if(size&&bytes.length>size+1){emit(bytes.slice(size));bytes=new Uint8Array(0);}
    if(submitted>0&&decoder?.state==='configured')void decoder.flush().catch(fail);
   };
   while(!abort.signal.aborted&&!failed){
    const next=await reader.read();
    if(next.done)break;
    if(idleTimer)clearTimeout(idleTimer);
    if(bytes.length+next.value.length>2*1024*1024)return fail();
    const merged=new Uint8Array(bytes.length+next.value.length);
    merged.set(bytes);merged.set(next.value,bytes.length);bytes=merged;
    let start=-1,offset=0;
    for(let i=0;i<bytes.length-4;i++){
     const size=startCode(bytes,i);if(!size)continue;
     if(start<0){start=i+size;continue;}
     emit(bytes.subarray(start,i));
     start=i+size;offset=i;
    }
    if(offset)bytes=bytes.slice(offset);
    // A static Android screen can produce one keyframe with no subsequent NAL.
    // Submit the final access unit after an idle period instead of waiting forever.
    idleTimer=setTimeout(flushLastNal,700);
   }
   if(!abort.signal.aborted){
    flushLastNal();
    if(submitted>0)endedRef.current();else fail();
   }
  })().catch(fail);
  return ()=>{
   abort.abort();
   if(idleTimer)clearTimeout(idleTimer);
   if(watchdog)clearTimeout(watchdog);
   try{decoder?.close()}catch{/* already closed */}
  };
 },[sessionId]);
 return <canvas ref={canvas} style={{display:'block',maxWidth:'100%',maxHeight:650,margin:'auto',cursor:'crosshair',touchAction:'none'}}
 onPointerDown={e=>{
  const b=e.currentTarget.getBoundingClientRect();
  pointer.current={x:Math.round((e.clientX-b.left)/b.width*e.currentTarget.width),y:Math.round((e.clientY-b.top)/b.height*e.currentTarget.height),t:Date.now()};
  e.currentTarget.setPointerCapture(e.pointerId);
 }}
 onPointerUp={e=>{
  const s=pointer.current;pointer.current=null;if(!s)return;
  const b=e.currentTarget.getBoundingClientRect();
  onGesture(s.x,s.y,Math.round((e.clientX-b.left)/b.width*e.currentTarget.width),Math.round((e.clientY-b.top)/b.height*e.currentTarget.height),Date.now()-s.t);
 }}
 onPointerCancel={()=>{pointer.current=null}} aria-label="Android H.264 视频画面"/>;
}
