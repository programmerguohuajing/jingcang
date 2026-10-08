import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const host = '127.0.0.1';
const port = Number(process.env.JINGCANG_ANDROID_AGENT_PORT || 19876);
const adb = process.env.JINGCANG_ADB_PATH || 'D:\\Program Files\\platform-tools\\adb.exe';
async function adbText(args) {
  const { stdout } = await exec(adb, args, { timeout: 12000, windowsHide: true, maxBuffer: 1024 * 1024 });
  return stdout.trim();
}
async function getDevices() {
  const output = await adbText(['devices', '-l']);
  const lines = output.split(/\r?\n/).slice(1).filter(Boolean);
  const devices = [];
  for (const line of lines) {
    const match = line.match(/^(\S+)\s+(device|offline|unauthorized)\b/);
    if (!match) continue;
    const [_, serial, state] = match;
    const device = { id: serial, kind: serial.startsWith('emulator-') ? 'android-emulator' : 'android-real', state };
    if (state === 'device') {
      const props = await Promise.all([
        adbText(['-s', serial, 'shell', 'getprop', 'ro.product.model']).catch(()=>'unknown'),
        adbText(['-s', serial, 'shell', 'getprop', 'ro.build.version.release']).catch(()=>'unknown'),
        adbText(['-s', serial, 'shell', 'getprop', 'sys.boot_completed']).catch(()=>'')
      ]);
      device.model = props[0]; device.osVersion = props[1]; device.booted = props[2] === '1';
    }
    devices.push(device);
  }
  return devices;
}
const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type','application/json; charset=utf-8');
  if (req.method !== 'GET' || !['/health','/devices'].includes(req.url)) {
    res.writeHead(404); return res.end(JSON.stringify({ error:'NOT_FOUND' }));
  }
  try {
    if (req.url === '/health') return res.end(JSON.stringify({ status:'ok', platform:process.platform, deviceAgent:'android-poc' }));
    return res.end(JSON.stringify({ devices: await getDevices() }));
  } catch (error) {
    res.writeHead(503); return res.end(JSON.stringify({ error:'ADB_UNAVAILABLE', message:String(error.message || error) }));
  }
});
server.listen(port, host, () => console.log('Android PoC Agent listening at http://' + host + ':' + port));
