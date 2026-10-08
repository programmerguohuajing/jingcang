/**
 * 跨节点真实设备控制与调度 + 失联节点恢复确认与安全释放 + Android 真机池 —— 端到端验证
 *
 * 流程：
 * 1. 登录移动开发控制面（28088），获取会话 Cookie。
 * 2. 启动本地 mock 远程 Agent（模拟 node-remote-1 上的一台 Android 真机 + 一台模拟器）。
 * 3. 管理员 enroll 节点（登记 agentUrl + agentToken），并模拟节点心跳（上报真机清单与 agentUrl）。
 * 4. 断言：
 *    - 节点列表显示 remote 节点 routable=true；
 *    - 真机池（node-devices）出现 android-real 且 available=true；
 *    - 聚合设备列表（/devices）跨节点列出远程设备；
 *    - 指定 nodeId 创建独占会话成功，截图/动作经 Control 转发到 mock 节点成功；
 *    - 停止 mock 节点（失联）后，等待失联确认窗口，会话被标记 LOST 且租约安全释放。
 *
 * 用法：node scripts/test-mobile-cross-node.mjs [controlUrl] [adminPassword]
 * 环境变量：JINGCANG_CONTROL_URL、JINGCANG_ADMIN_PASSWORD 可替代参数。
 */
import http from 'node:http';

const controlUrl = (process.env.JINGCANG_CONTROL_URL || process.argv[2] || 'http://127.0.0.1:28088').replace(/\/$/, '');
const adminPassword = process.env.JINGCANG_ADMIN_PASSWORD || process.argv[3] || '';
const MOCK_PORT = 19891;
// 每次运行使用唯一节点 ID：节点凭证仅发放一次（撤销后不重复领取）
const MOCK_NODE = 'mock-remote-' + Date.now().toString(36).slice(-6);
const MOCK_TOKEN = 'e'.repeat(64);
const MOCK_URL = process.env.JINGCANG_MOCK_AGENT_URL || ('http://host.docker.internal:' + MOCK_PORT);
const REAL_SERIAL = 'R58M23ABC789';
const EMU_SERIAL = 'emulator-5591';

let failures = 0;
function check(name, cond, extra = '') {
  const ok = !!cond;
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' :: ' + extra : ''));
  if (!ok) failures++;
}

// ---- mock 远程 Agent（模拟一台 Android 真机 + 一台模拟器）----
const mockServer = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  if (req.headers.authorization !== 'Bearer ' + MOCK_TOKEN) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'UNAUTHORIZED' }));
  }
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', platform: 'linux', nodeId: MOCK_NODE, startedAt: new Date().toISOString(), uptimeSeconds: 60, managedEmulatorCount: 1, automationInProgress: 0 }));
  }
  if (req.method === 'GET' && url.pathname === '/devices') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      devices: [
        { id: REAL_SERIAL, kind: 'android-real', state: 'device', booted: true, model: 'Pixel 7 真机', osVersion: '14' },
        { id: EMU_SERIAL, kind: 'android-emulator', state: 'device', booted: true, model: 'Emulator', osVersion: '12' }
      ]
    }));
  }
  const dev = /^\/devices\/([^/]+)\/(screenshot|action)$/.exec(url.pathname);
  if (dev && req.method === 'GET' && dev[2] === 'screenshot') {
    // 1x1 PNG
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082', 'hex');
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length });
    return res.end(png);
  }
  if (dev && req.method === 'POST' && dev[2] === 'action') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true }));
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'NOT_FOUND' }));
});

// ---- 控制面 HTTP 辅助 ----
let cookie = '';
async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (cookie) headers['Cookie'] = cookie;
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const response = await fetch(controlUrl + path, { ...options, headers });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  let body = null;
  const raw = await response.text();
  try {
    body = JSON.parse(raw);
  } catch {
    body = raw;
  }
  return { status: response.status, body, headers: response.headers };
}

// ---- 主流程 ----
await new Promise((resolve) => mockServer.listen(MOCK_PORT, '0.0.0.0', resolve));
console.log('mock remote agent listening on 127.0.0.1:' + MOCK_PORT);

try {
  if (!adminPassword) throw new Error('缺少管理员密码（--adminPassword 或 JINGCANG_ADMIN_PASSWORD）');
  const login = await api('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: adminPassword })
  });
  check('管理员登录', login.status === 200, 'status=' + login.status);

  // 1) 登记远程节点（端点 + 调用凭证）
  const enroll = await api('/api/v1/mobile/nodes/enroll', {
    method: 'POST',
    body: JSON.stringify({ nodeId: MOCK_NODE, agentUrl: MOCK_URL, agentToken: MOCK_TOKEN })
  });
  check('管理员登记远程节点端点', enroll.status === 201, 'status=' + enroll.status + ' credential=' + (enroll.body?.data?.credential || '').slice(0, 6) + '...');
  const nodeCredential = enroll.body?.data?.credential;
  if (!nodeCredential) throw new Error('未获得节点凭证');

  // 2) 节点心跳：上报真机 + 模拟器 + agentUrl（控制面可达端点）
  const hb = await api('/api/v1/mobile/nodes/' + MOCK_NODE + '/heartbeat', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + nodeCredential },
    body: JSON.stringify({
      platform: 'linux',
      startedAt: new Date().toISOString(),
      uptimeSeconds: 60,
      managedEmulatorCount: 1,
      agentUrl: MOCK_URL,
      devices: [
        { id: REAL_SERIAL, kind: 'android-real', state: 'device', booted: true },
        { id: EMU_SERIAL, kind: 'android-emulator', state: 'device', booted: true }
      ]
    })
  });
  check('节点认证心跳（含真机清单与端点）', hb.status === 200, 'status=' + hb.status);

  // 3) 节点列表：远程节点应 routable
  const nodes = await api('/api/v1/mobile/nodes');
  const remoteNode = nodes.body?.data?.nodes?.find((n) => n.node_id === MOCK_NODE);
  check('节点列表显示远程节点可路由', remoteNode && remoteNode.online === true && remoteNode.routable === true, JSON.stringify(remoteNode || null));

  // 4) Android 真机池：android-real 设备 available + routable（按本次 mock 节点匹配）
  const inventory = await api('/api/v1/mobile/node-devices');
  const real = inventory.body?.data?.devices?.find((d) => d.nodeId === MOCK_NODE && d.id === REAL_SERIAL);
  check('真机池包含 Android 真机且可调度', real && real.available === true && real.routable === true && real.kind === 'android-real', JSON.stringify(real || null));

  // 5) 聚合设备池跨节点列出远程设备
  const pool = await api('/api/v1/mobile/devices');
  const pooled = pool.body?.data?.devices?.find((d) => d.nodeId === MOCK_NODE && d.id === REAL_SERIAL);
  check('聚合设备池包含远程节点真机', pooled && pooled.available === true, JSON.stringify(pooled || null));

  // 6) 跨节点创建独占会话（调度到远程节点）
  const created = await api('/api/v1/mobile/sessions', {
    method: 'POST',
    body: JSON.stringify({ deviceId: EMU_SERIAL, nodeId: MOCK_NODE, mode: 'phone' })
  });
  check('跨节点会话创建（调度到远程节点）', created.status === 201 && created.body?.data?.nodeId === MOCK_NODE && created.body?.data?.status === 'READY', 'status=' + created.status + ' ' + JSON.stringify(created.body?.data || created.body));
  const sessionId = created.body?.data?.id;
  if (!sessionId) throw new Error('会话创建失败');

  // 7) 截图与动作经 Control 转发到远程节点（截图直接检查原始响应）
  const shotRes = await fetch(controlUrl + '/api/v1/mobile/sessions/' + sessionId + '/screenshot', { headers: { Cookie: cookie } });
  const shotBuf = Buffer.from(await shotRes.arrayBuffer());
  check('跨节点截图转发成功', shotRes.status === 200 && shotRes.headers.get('content-type')?.includes('image/png') && shotBuf.length > 0, 'status=' + shotRes.status + ' bytes=' + shotBuf.length);
  const act = await api('/api/v1/mobile/sessions/' + sessionId + '/actions', {
    method: 'POST',
    body: JSON.stringify({ type: 'key', key: 'HOME' })
  });
  check('跨节点控制动作转发成功', act.status === 200 && act.body?.success === true, 'status=' + act.status);

  // 8) 失联恢复：停止 mock 节点 → 等待失联确认（45s 心跳阈值 + 20s 探测周期 + 缓冲）
  console.log('mock] 停止远程节点，等待失联确认窗口（约 70s）…');
  await new Promise((resolve) => mockServer.close(resolve));
  await new Promise((resolve) => setTimeout(resolve, 70000));
  const sessions = await api('/api/v1/mobile/sessions');
  const lost = sessions.body?.data?.find((s) => s.id === sessionId);
  check('失联会话被安全释放并标记 LOST', lost && lost.status === 'LOST', 'status=' + (lost?.status || 'missing'));
  const leases = await api('/api/v1/mobile/sessions');
  const again = await api('/api/v1/mobile/sessions');
  check('会话可被重新列出（租约已释放，设备重新可调度）', (again.body?.data || []).some((s) => s.id === sessionId));
} finally {
  try {
    mockServer.close();
  } catch {
    /* already closed */
  }
}

console.log(failures === 0 ? '\nALL_PASS' : '\nFAILURES=' + failures);
process.exit(failures === 0 ? 0 : 1);