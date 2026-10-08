import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startNodeHeartbeat} from './mobile-node-heartbeat.mjs';
const credential='a'.repeat(64);
const silent={warn(){},info(){}};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('node heartbeat sends authenticated payload and stops cleanly',async()=>{
 const calls=[];
 const active=startNodeHeartbeat({nodeId:'test-node',credential,controlUrl:'http://127.0.0.1:28088',intervalMs:20,logger:silent,fetchImpl:async(url,options)=>{calls.push({url:String(url),options});return {ok:true,status:200}}});
 await delay(85);active.stop();const n=calls.length;await delay(40);
 assert.ok(n>=2);assert.equal(calls.length,n);
 assert.equal(calls[0].options.headers.Authorization,'Bearer '+credential);
 const payload=JSON.parse(calls[0].options.body);
 assert.equal(payload.platform,'windows');assert.equal(payload.managedEmulatorCount,0);
});
test('revoked credential disables retries',async()=>{
 let calls=0;
 const active=startNodeHeartbeat({nodeId:'test-node',credential,controlUrl:'http://127.0.0.1:28088',intervalMs:15,logger:silent,fetchImpl:async()=>{calls++;return {ok:false,status:401}}});
 await delay(85);active.stop();assert.equal(calls,1);assert.equal(active.disabled,true);
});
test('transient failed heartbeat retries and recovers',async()=>{
 let calls=0;
 const active=startNodeHeartbeat({nodeId:'test-node',credential,controlUrl:'http://127.0.0.1:28088',intervalMs:20,logger:silent,fetchImpl:async()=>{calls++;if(calls===1)throw Error('network');return {ok:true,status:200}}});
 await delay(90);active.stop();assert.ok(calls>=2);
});
test('remote plaintext HTTP and invalid credentials rejected',()=>{
 assert.throws(()=>startNodeHeartbeat({nodeId:'test',credential,controlUrl:'http://192.168.1.5:8088'}),/INSECURE_CONTROL_URL/);
 assert.throws(()=>startNodeHeartbeat({nodeId:'test',credential:'bad',controlUrl:'https://example.com'}),/INVALID_NODE_CREDENTIALS/);
});
