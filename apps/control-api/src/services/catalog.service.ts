import fs from 'fs';
import { Config } from '../config.js';
import { getDb } from '../db/index.js';
import { parseCatalogYaml } from '@jingcang/browser-catalog';
import { BrowserItem } from '@jingcang/contracts';

export class CatalogService {
  constructor(private config: Config) {}

  public loadAndSyncCatalog(): BrowserItem[] {
    const db = getDb(this.config);

    let yamlItems: BrowserItem[] = [];
    if (fs.existsSync(this.config.catalogYamlPath)) {
      const content = fs.readFileSync(this.config.catalogYamlPath, 'utf8');
      yamlItems = parseCatalogYaml(content);
    } else {
      // Default fallback matrix if file doesn't exist yet
      yamlItems = [
        {
          id: 'chrome-stable',
          browserName: 'chrome',
          displayName: 'Google Chrome (Stable)',
          version: 'latest',
          channel: 'stable',
          image: 'selenium/standalone-chrome:4.48.0-20260905',
          platform: 'linux-amd64',
          enabled: true,
          isDefault: true,
          resourceJson: { cpus: 2, memory: '3g', shmSize: '2g' }
        },
        {
          id: 'edge-stable',
          browserName: 'edge',
          displayName: 'Microsoft Edge (Stable)',
          version: 'latest',
          channel: 'stable',
          image: 'selenium/standalone-edge:4.48.0-20260905',
          platform: 'linux-amd64',
          enabled: true,
          isDefault: false,
          resourceJson: { cpus: 2, memory: '3g', shmSize: '2g' }
        },
        {
          id: 'firefox-stable',
          browserName: 'firefox',
          displayName: 'Mozilla Firefox (Stable)',
          version: 'latest',
          channel: 'stable',
          image: 'selenium/standalone-firefox:4.48.0-20260905',
          platform: 'linux-amd64',
          enabled: true,
          isDefault: false,
          resourceJson: { cpus: 2, memory: '3g', shmSize: '2g' }
        }
      ];
    }

    const catalogCols = db.prepare('PRAGMA table_info(browser_catalog)').all() as Array<{ name: string }>;
    if (!catalogCols.some((col) => col.name === 'grid_url')) {
      db.exec('ALTER TABLE browser_catalog ADD COLUMN grid_url TEXT;');
    }

    const upsertStmt = db.prepare(`
      INSERT INTO browser_catalog (
        id, browser_name, display_name, version, channel, image, grid_url, platform, enabled, is_default, capabilities_json, resource_json, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'builtin')
      ON CONFLICT(id) DO UPDATE SET
        browser_name = excluded.browser_name,
        display_name = excluded.display_name,
        version = excluded.version,
        channel = excluded.channel,
        image = excluded.image,
        grid_url = excluded.grid_url,
        platform = excluded.platform,
        enabled = COALESCE(browser_catalog.enabled_override, excluded.enabled),
        is_default = excluded.is_default,
        capabilities_json = excluded.capabilities_json,
        resource_json = excluded.resource_json,
        source = 'builtin'
    `);

    for (const item of yamlItems) {
      upsertStmt.run(
        item.id,
        item.browserName,
        item.displayName,
        item.version,
        item.channel || 'stable',
        item.image,
        item.gridUrl || null,
        item.platform || 'linux-amd64',
        item.enabled ? 1 : 0,
        item.isDefault ? 1 : 0,
        item.capabilitiesJson ? JSON.stringify(item.capabilitiesJson) : null,
        item.resourceJson ? JSON.stringify(item.resourceJson) : null
      );
    }

    const validIds = yamlItems.map((i) => i.id);
    if (validIds.length > 0) {
      const placeholders = validIds.map(() => '?').join(',');
      db.prepare(`UPDATE browser_catalog SET enabled = 0 WHERE source = 'builtin' AND id NOT IN (${placeholders})`).run(...validIds);
    }

    return this.getCatalogItems();
  }

  public getCatalogItems(onlyEnabled: boolean = false): BrowserItem[] {
    const db = getDb(this.config);
    const query = onlyEnabled
      ? 'SELECT * FROM browser_catalog WHERE enabled = 1'
      : 'SELECT * FROM browser_catalog';
    
    const rows = db.prepare(query).all() as any[];

    return rows.map((r) => ({
      id: r.id,
      browserName: r.browser_name,
      displayName: r.display_name,
      version: r.version,
      channel: r.channel,
      image: r.image,
      gridUrl: r.grid_url || undefined,
      platform: r.platform,
      enabled: Boolean(r.enabled),
      isDefault: Boolean(r.is_default),
      capabilitiesJson: r.capabilities_json ? JSON.parse(r.capabilities_json) : undefined,
      resourceJson: r.resource_json ? JSON.parse(r.resource_json) : undefined
    }));
  }

  public getBrowserById(id: string): BrowserItem | null {
    const db = getDb(this.config);
    const r = db.prepare('SELECT * FROM browser_catalog WHERE id = ?').get(id) as any;
    if (!r) return null;

    return {
      id: r.id,
      browserName: r.browser_name,
      displayName: r.display_name,
      version: r.version,
      channel: r.channel,
      image: r.image,
      gridUrl: r.grid_url || undefined,
      platform: r.platform,
      enabled: Boolean(r.enabled),
      isDefault: Boolean(r.is_default),
      capabilitiesJson: r.capabilities_json ? JSON.parse(r.capabilities_json) : undefined,
      resourceJson: r.resource_json ? JSON.parse(r.resource_json) : undefined
    };
  }

  public updateCatalogItem(id: string, updates: { enabled?: boolean; isDefault?: boolean }): boolean {
    const db = getDb(this.config);
    const item = this.getBrowserById(id);
    if (!item) return false;

    if (updates.isDefault) {
      db.prepare('UPDATE browser_catalog SET is_default = 0 WHERE browser_name = ?').run(item.browserName);
    }

    const setClauses: string[] = [];
    const params: any[] = [];

    if (typeof updates.enabled === 'boolean') {
      setClauses.push('enabled = ?', 'enabled_override = ?');
      const enabledValue = updates.enabled ? 1 : 0;
      params.push(enabledValue, enabledValue);
    }
    if (typeof updates.isDefault === 'boolean') {
      setClauses.push('is_default = ?');
      params.push(updates.isDefault ? 1 : 0);
    }

    if (setClauses.length === 0) return true;

    params.push(id);
    const stmt = db.prepare(`UPDATE browser_catalog SET ${setClauses.join(', ')} WHERE id = ?`);
    stmt.run(...params);
    return true;
  }

  public addDynamicCatalogItem(item: BrowserItem, containerId: string): BrowserItem {
    const db = getDb(this.config);
    db.prepare(`
      INSERT INTO browser_catalog (
        id, browser_name, display_name, version, channel, image, grid_url, platform,
        enabled, is_default, capabilities_json, resource_json, source, container_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'dynamic', ?)
      ON CONFLICT(id) DO UPDATE SET
        display_name = excluded.display_name,
        image = excluded.image,
        grid_url = excluded.grid_url,
        platform = excluded.platform,
        enabled = COALESCE(browser_catalog.enabled_override, 1),
        capabilities_json = excluded.capabilities_json,
        resource_json = excluded.resource_json,
        source = 'dynamic',
        container_id = excluded.container_id
    `).run(
      item.id,
      item.browserName,
      item.displayName,
      item.version,
      item.channel || 'stable',
      item.image,
      item.gridUrl || null,
      item.platform || 'linux-amd64',
      item.enabled ? 1 : 0,
      item.isDefault ? 1 : 0,
      item.capabilitiesJson ? JSON.stringify(item.capabilitiesJson) : null,
      item.resourceJson ? JSON.stringify(item.resourceJson) : null,
      containerId
    );

    return this.getBrowserById(item.id)!;
  }

  public getBrowserByVendorVersion(browserName: string, version: string): BrowserItem | null {
    const db = getDb(this.config);
    const row = db.prepare(
      'SELECT id FROM browser_catalog WHERE browser_name = ? AND version = ? LIMIT 1'
    ).get(browserName, version) as { id: string } | undefined;
    return row ? this.getBrowserById(row.id) : null;
  }
}
