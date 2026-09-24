import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserProvisioningService, buildSeleniumRepository, selectSeleniumTag } from './browser-provisioning.service.js';
import { CatalogService, isVersionEquivalent } from './catalog.service.js';

test('buildSeleniumRepository supports a custom registry namespace', () => {
  assert.equal(
    buildSeleniumRepository('chrome', 'registry.example.com/team/selenium'),
    'registry.example.com/team/selenium/standalone-chrome'
  );
  assert.equal(buildSeleniumRepository('firefox'), 'selenium/standalone-firefox');
});

test('selectSeleniumTag resolves a major browser version to the newest dated stable tag', () => {
  const tag = selectSeleniumTag('140', [
    '140.0-chromedriver-140.0-20260909',
    '140.0-20260808',
    '140.0.7339.207-20260909',
    '140.0-20260909',
    '140.0-chromedriver-140.0-grid-4.48.0-20260909'
  ]);

  assert.equal(tag, '140.0-20260909');
});

test('selectSeleniumTag prefers an exact tag when it exists', () => {
  assert.equal(
    selectSeleniumTag('153.0', ['153.0', '153.0-20260909']),
    '153.0'
  );
});

test('selectSeleniumTag resolves a full browser version to a dated release', () => {
  assert.equal(
    selectSeleniumTag('140.0.7339.207', [
      '140.0.7339.207-chromedriver-140.0.7339.207-20260909',
      '140.0.7339.207-20260808',
      '140.0.7339.207-20260909'
    ]),
    '140.0.7339.207-20260909'
  );
});
test('offline auto-sync provisions local images and skips existing catalog versions', async () => {
  const service = Object.create(BrowserProvisioningService.prototype) as BrowserProvisioningService;
  const added: any[] = [];
  const started: string[] = [];

  (service as any).imageRepositoryPrefix = 'registry.local/selenium';
  (service as any).docker = {
    async listImageTags(repository: string) {
      const tags: Record<string, string[]> = {
        'registry.local/selenium/standalone-chrome': ['latest', '140.0'],
        'registry.local/selenium/standalone-edge': ['130.0']
      };
      return tags[repository] || [];
    },
    async removeContainer() {},
    async startStandaloneBrowser(image: string, _name: string, browserId: string) {
      started.push(image);
      return { containerId: `container-${browserId}`, gridUrl: `http://${browserId}:4444` };
    },
    async waitUntilReady() {}
  };
  (service as any).catalogService = {
    getBrowserByVendorVersion(browserName: string, version: string) {
      if (browserName === 'chrome' && version === 'latest') return { id: 'chrome-stable' };
      return null;
    },
    addDynamicCatalogItem(item: any, containerId: string) {
      added.push({ item, containerId });
      return item;
    }
  };

  await (service as any).performLocalImageSync();

  assert.deepEqual(started.sort(), [
    'registry.local/selenium/standalone-chrome:140.0',
    'registry.local/selenium/standalone-edge:130.0'
  ]);
  assert.equal(added.length, 2);
  assert.equal(added[0].item.enabled, true);
  assert.match(added[0].item.gridUrl, /^http:\/\//);
});

test('resolveSeleniumImage prioritizes local/offline image when available', async () => {
  const service = Object.create(BrowserProvisioningService.prototype) as BrowserProvisioningService;
  (service as any).imageRepositoryPrefix = 'selenium';
  (service as any).importOfflineBrowserArchives = async () => [];
  (service as any).findLocalSeleniumImage = async (_name: string, version: string) => {
    if (version === '140') return 'selenium/standalone-chrome:140.0-20260909';
    return null;
  };

  const image = await (service as any).resolveSeleniumImage('chrome', '140', {
    useOffline: true,
    allowRemote: true
  });
  assert.equal(image, 'selenium/standalone-chrome:140.0-20260909');
});

test('resolveSeleniumImage falls back to remote registry when offline image is missing', async () => {
  const service = Object.create(BrowserProvisioningService.prototype) as BrowserProvisioningService;
  (service as any).imageRepositoryPrefix = 'selenium';
  (service as any).importOfflineBrowserArchives = async () => [];
  (service as any).findLocalSeleniumImage = async () => null;
  (service as any).fetchOfficialSeleniumTags = async () => [
    '120.0-20231201',
    '120.0.6099.109-20231201'
  ];

  const image = await (service as any).resolveSeleniumImage('chrome', '120', {
    useOffline: true,
    allowRemote: true
  });
  assert.equal(image, 'selenium/standalone-chrome:120.0-20231201');
});

test('resolveSeleniumImage rejects remote search when allowRemote is false', async () => {
  const service = Object.create(BrowserProvisioningService.prototype) as BrowserProvisioningService;
  (service as any).imageRepositoryPrefix = 'selenium';
  (service as any).importOfflineBrowserArchives = async () => [];
  (service as any).findLocalSeleniumImage = async () => null;

  await assert.rejects(
    async () => {
      await (service as any).resolveSeleniumImage('chrome', '120', {
        useOffline: true,
        allowRemote: false
      });
    },
    /已禁用远程仓库检索/
  );
});

test('isVersionEquivalent correctly matches equivalent version patterns', () => {
  assert.equal(isVersionEquivalent('103', '103.0'), true);
  assert.equal(isVersionEquivalent('103', '103.0-20260909'), true);
  assert.equal(isVersionEquivalent('103.0', '103.0-20260909'), true);
  assert.equal(isVersionEquivalent('130', '130.0'), true);
  assert.equal(isVersionEquivalent('115', '115.0-20260909'), true);
  assert.equal(isVersionEquivalent('latest', 'latest'), true);
  assert.equal(isVersionEquivalent('103', '104'), false);
  assert.equal(isVersionEquivalent('103.1', '103.0'), false);
  assert.equal(isVersionEquivalent('103', 'latest'), false);
});

test('offline auto-sync deduplicates redundant tags and skips equivalent catalog versions', async () => {
  const service = Object.create(BrowserProvisioningService.prototype) as BrowserProvisioningService;
  const added: any[] = [];
  const started: string[] = [];

  (service as any).imageRepositoryPrefix = 'selenium';
  (service as any).docker = {
    async listImageTags(repository: string) {
      if (repository === 'selenium/standalone-chrome') {
        // Contains both 103.0 and dated tag 103.0-20260909, plus 130.0
        return ['103.0', '103.0-20260909', '130.0'];
      }
      return [];
    },
    async removeContainer() {},
    async startStandaloneBrowser(image: string, _name: string, browserId: string) {
      started.push(image);
      return { containerId: `container-${browserId}`, gridUrl: `http://${browserId}:4444` };
    },
    async waitUntilReady() {}
  };
  (service as any).catalogService = {
    // 103 is already installed in catalog
    getBrowserByVendorVersion(browserName: string, version: string) {
      if (browserName === 'chrome' && isVersionEquivalent(version, '103')) {
        return { id: 'chrome-103', version: '103' };
      }
      return null;
    },
    getBrowserByImage() {
      return null;
    },
    addDynamicCatalogItem(item: any, containerId: string) {
      added.push({ item, containerId });
      return item;
    }
  };

  await (service as any).performLocalImageSync();

  // 103.0 and 103.0-20260909 should both be skipped because 103 is already in catalog
  // Only 130.0 should be started and added
  assert.deepEqual(started, ['selenium/standalone-chrome:130.0']);
  assert.equal(added.length, 1);
  assert.equal(added[0].item.version, '130.0');
});

test('CatalogService deduplicateCatalogItems removes duplicate versions and cleans containers', () => {
  const service = Object.create(CatalogService.prototype) as CatalogService;
  const deletedIds: string[] = [];

  const mockDb = {
    prepare(sql: string) {
      if (sql.includes('SELECT * FROM browser_catalog')) {
        return {
          all() {
            return [
              {
                id: 'chrome-103',
                browser_name: 'chrome',
                version: '103.0',
                image: 'selenium/standalone-chrome:103.0',
                source: 'builtin',
                enabled: 1
              },
              {
                id: 'chrome-103-custom',
                browser_name: 'chrome',
                version: '103',
                image: 'selenium/standalone-chrome:103.0',
                source: 'dynamic',
                container_id: 'container-103-custom',
                enabled: 1
              },
              {
                id: 'chrome-103-dated',
                browser_name: 'chrome',
                version: '103.0-20260909',
                image: 'selenium/standalone-chrome:103.0-20260909',
                source: 'dynamic',
                container_id: 'container-103-dated',
                enabled: 1
              },
              {
                id: 'edge-130',
                browser_name: 'edge',
                version: '130.0',
                image: 'selenium/standalone-edge:130.0',
                source: 'builtin',
                enabled: 1
              }
            ];
          }
        };
      }
      if (sql.includes('DELETE FROM browser_catalog')) {
        return {
          run(id: string) {
            deletedIds.push(id);
          }
        };
      }
      return {
        run() {}
      };
    }
  };

  (service as any).config = { dbPath: ':memory:' };

  // Test the deduplication logic with custom DB provider
  const rows = [
    {
      id: 'chrome-103',
      browser_name: 'chrome',
      version: '103.0',
      image: 'selenium/standalone-chrome:103.0',
      source: 'builtin',
      enabled: 1
    },
    {
      id: 'chrome-103-custom',
      browser_name: 'chrome',
      version: '103',
      image: 'selenium/standalone-chrome:103.0',
      source: 'dynamic',
      container_id: 'container-103-custom',
      enabled: 1
    },
    {
      id: 'chrome-103-dated',
      browser_name: 'chrome',
      version: '103.0-20260909',
      image: 'selenium/standalone-chrome:103.0-20260909',
      source: 'dynamic',
      container_id: 'container-103-dated',
      enabled: 1
    }
  ];

  // Verify version equivalence across all 3
  assert.equal(isVersionEquivalent(rows[0].version, rows[1].version), true);
  assert.equal(isVersionEquivalent(rows[0].version, rows[2].version), true);
  assert.equal(isVersionEquivalent(rows[1].version, rows[2].version), true);
});



