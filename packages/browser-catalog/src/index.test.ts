import assert from 'node:assert';
import { test } from 'node:test';
import { buildW3CCapabilities, transformUrlForContainer } from './index.js';
import type { BrowserItem, CreateSessionRequest } from '@jingcang/contracts';

const edge: BrowserItem = {
  id: 'edge-stable',
  browserName: 'edge',
  displayName: 'Edge',
  version: 'latest',
  channel: 'stable',
  image: 'selenium/standalone-edge:test',
  platform: 'linux-amd64',
  enabled: true,
  isDefault: false
};

const request: CreateSessionRequest = {
  browserId: edge.id,
  startUrl: 'about:blank',
  screen: { width: 1280, height: 720, depth: 24, dpi: 96 },
  locale: 'zh-CN',
  timezone: 'Asia/Shanghai',
  durationMinutes: 60,
  recordVideo: false,
  acceptInsecureCerts: false
};

test('Edge capabilities use Selenium W3C browserName and omit latest version pin', () => {
  const caps = buildW3CCapabilities(edge, request);
  assert.strictEqual(caps.alwaysMatch.browserName, 'MicrosoftEdge');
  assert.strictEqual('browserVersion' in caps.alwaysMatch, false);
  assert.strictEqual(caps.alwaysMatch['se:screenResolution'], '1280x720');
});

test('localhost URLs are rewritten for Docker host access', () => {
  const result = transformUrlForContainer('http://localhost:3000/path?q=1');
  assert.strictEqual(result.transformed, true);
  assert.match(result.url, /^http:\/\/host\.docker\.internal:3000\/path\?q=1$/);
});

test('Chrome capabilities with 2560x1440 resolution contain window size and position arguments', () => {
  const chrome: BrowserItem = {
    id: 'chrome-stable',
    browserName: 'chrome',
    displayName: 'Chrome',
    version: 'latest',
    channel: 'stable',
    image: 'selenium/standalone-chrome:test',
    platform: 'linux-amd64',
    enabled: true,
    isDefault: true
  };
  const req2k: CreateSessionRequest = {
    browserId: chrome.id,
    startUrl: 'https://example.com',
    screen: { width: 2560, height: 1440, depth: 24, dpi: 96 },
    locale: 'zh-CN',
    timezone: 'Asia/Shanghai',
    durationMinutes: 60,
    recordVideo: false,
    acceptInsecureCerts: false
  };
  const caps = buildW3CCapabilities(chrome, req2k);
  assert.strictEqual(caps.alwaysMatch['se:screenResolution'], '2560x1440');
  const chromeArgs: string[] = caps.alwaysMatch['goog:chromeOptions']?.args || [];
  assert.ok(chromeArgs.includes('--window-size=2560,1440'));
  assert.ok(chromeArgs.includes('--window-position=0,0'));
  assert.ok(chromeArgs.includes('--force-device-scale-factor=1'));
  assert.ok(!chromeArgs.includes('--start-maximized'));
});

test('Dedicated standalone nodes do not pin browserVersion to an image tag', () => {
  const dedicated: BrowserItem = {
    ...edge,
    id: 'edge-130',
    version: '130.0',
    gridUrl: 'http://jc-edge-130:4444'
  };
  const caps = buildW3CCapabilities(dedicated, { ...request, browserId: dedicated.id });
  assert.deepStrictEqual(caps.firstMatch, [{}]);
});
