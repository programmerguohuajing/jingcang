import yaml from 'js-yaml';
import { BrowserItem, BrowserItemSchema, CreateSessionRequest } from '@jingcang/contracts';

export interface CatalogYaml {
  browsers: BrowserItem[];
}

export function parseCatalogYaml(yamlContent: string): BrowserItem[] {
  const parsed = yaml.load(yamlContent) as CatalogYaml | null;
  if (!parsed || !Array.isArray(parsed.browsers)) {
    throw new Error('Invalid catalog format: missing "browsers" array');
  }

  const result = BrowserItemSchema.array().safeParse(parsed.browsers);
  if (!result.success) {
    throw new Error(`Invalid browser catalog: ${result.error.message}`);
  }
  return result.data;
}

export function buildW3CCapabilities(browser: BrowserItem, request: CreateSessionRequest) {
  const screen = request.screen || { width: 1920, height: 1080 };
  const screenResolution = `${screen.width}x${screen.height}`;

  const capabilities: Record<string, any> = {
    alwaysMatch: {
      browserName: browser.browserName === 'edge' ? 'MicrosoftEdge' : browser.browserName,
      platformName: 'linux',
      acceptInsecureCerts: request.acceptInsecureCerts ?? false,
      'se:name': request.name || `jingcang-${browser.browserName}-${browser.version}`,
      'se:recordVideo': request.recordVideo ?? false,
      'se:screenResolution': screenResolution,
      'se:vncEnabled': true,
      'se:noVncEnabled': true
    },
    // A dedicated standalone node already identifies the target image/version.
    // Do not pin browserVersion there because Selenium image tags (for example
    // 130.0) can differ from the full runtime version reported by WebDriver.
    firstMatch: !browser.gridUrl && browser.version && browser.version !== 'latest'
      ? [{ browserVersion: browser.version }]
      : [{}]
  };

  // Add browser specific arguments
  const browserName = browser.browserName.toLowerCase();
  const commonArgs: string[] = [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    `--window-size=${screen.width},${screen.height}`,
    '--window-position=0,0',
    '--force-device-scale-factor=1'
  ];

  if (request.locale) {
    commonArgs.push(`--lang=${request.locale}`);
  }

  if (browserName === 'chrome' || browserName === 'chromium') {
    capabilities.alwaysMatch['goog:chromeOptions'] = {
      args: commonArgs
    };
  } else if (browserName === 'edge') {
    capabilities.alwaysMatch['ms:edgeOptions'] = {
      args: commonArgs
    };
  } else if (browserName === 'firefox') {
    capabilities.alwaysMatch['moz:firefoxOptions'] = {
      args: ['-width', String(screen.width), '-height', String(screen.height)]
    };
  }

  return capabilities;
}

export function transformUrlForContainer(urlStr: string): { url: string; transformed: boolean } {
  if (!urlStr || urlStr === 'about:blank') {
    return { url: 'about:blank', transformed: false };
  }

  try {
    const parsed = new URL(urlStr);
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]') {
      parsed.hostname = 'host.docker.internal';
      return { url: parsed.toString(), transformed: true };
    }
  } catch (err) {
    // If not a valid absolute URL, return as is
  }

  return { url: urlStr, transformed: false };
}
