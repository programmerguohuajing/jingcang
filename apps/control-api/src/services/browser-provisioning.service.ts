import crypto from 'node:crypto';
import { Config } from '../config.js';
import { getDb } from '../db/index.js';
import { CatalogService, isVersionEquivalent } from './catalog.service.js';
import { DockerEngineService } from './docker-engine.service.js';
import {
  BrowserInstallJob,
  BrowserInstallRequest,
  BrowserInstallStatus,
  BrowserItem,
  BrowserVendor
} from '@jingcang/contracts';

const IMAGE_REPOSITORIES: Record<BrowserVendor, string> = {
  chrome: 'selenium/standalone-chrome',
  edge: 'selenium/standalone-edge',
  firefox: 'selenium/standalone-firefox',
  chromium: 'selenium/standalone-chromium'
};

export function buildSeleniumRepository(
  browserName: BrowserVendor,
  repositoryPrefix = 'selenium'
): string {
  const officialRepository = IMAGE_REPOSITORIES[browserName];
  const imageName = officialRepository.slice(officialRepository.lastIndexOf('/') + 1);
  const prefix = repositoryPrefix.trim().replace(/\/+$/, '') || 'selenium';
  return `${prefix}/${imageName}`;
}

const DISPLAY_NAMES: Record<BrowserVendor, string> = {
  chrome: 'Google Chrome',
  edge: 'Microsoft Edge',
  firefox: 'Mozilla Firefox',
  chromium: 'Chromium'
};

export function selectSeleniumTag(requestedVersion: string, tags: string[]): string | null {
  const requested = requestedVersion.trim();
  const normalized = /^\d+$/.test(requested) ? `${requested}.0` : requested;
  const lowerRequested = requested.toLowerCase();
  const lowerNormalized = normalized.toLowerCase();

  const exact = tags.find((tag) => tag.toLowerCase() === lowerRequested)
    || tags.find((tag) => tag.toLowerCase() === lowerNormalized);
  if (exact) return exact;

  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const simpleDated = new RegExp(`^${escaped}-\\d{8}$`, 'i');
  const fullVersionDated = new RegExp(`^${escaped}(?:\\.\\d+){1,3}-\\d{8}$`, 'i');

  const byReleaseDateDesc = (a: string, b: string) => {
    const dateA = a.match(/-(\d{8})$/)?.[1] || '';
    const dateB = b.match(/-(\d{8})$/)?.[1] || '';
    return dateB.localeCompare(dateA);
  };

  const stableTags = tags.filter((tag) => !/chromedriver|grid-/i.test(tag));
  const dated = stableTags.filter((tag) => simpleDated.test(tag)).sort(byReleaseDateDesc);
  if (dated.length > 0) return dated[0];

  const fullDated = stableTags.filter((tag) => fullVersionDated.test(tag)).sort(byReleaseDateDesc);
  return fullDated[0] || null;
}

export class BrowserProvisioningService {
  private docker: DockerEngineService;
  private readonly imageRepositoryPrefix: string;
  private readonly imageArchiveDir: string;
  private readonly offlineMode: boolean;
  private readonly autoSyncLocalImages: boolean;
  private archiveImportPromise: Promise<string[]> | null = null;
  private localImageSyncPromise: Promise<void> | null = null;

  constructor(
    private config: Config,
    private catalogService: CatalogService
  ) {
    this.docker = new DockerEngineService(config);
    this.imageRepositoryPrefix =
      process.env.JINGCANG_BROWSER_IMAGE_REPOSITORY_PREFIX?.trim() || 'selenium';
    this.imageArchiveDir = process.env.JINGCANG_BROWSER_IMAGE_ARCHIVE_DIR?.trim() || '';
    this.offlineMode = /^(?:1|true|yes|on)$/i.test(
      process.env.JINGCANG_BROWSER_OFFLINE_MODE?.trim() || 'false'
    );
    const autoSyncValue = process.env.JINGCANG_BROWSER_AUTO_SYNC_LOCAL_IMAGES?.trim();
    this.autoSyncLocalImages = autoSyncValue
      ? /^(?:1|true|yes|on)$/i.test(autoSyncValue)
      : this.offlineMode;

    setImmediate(async () => {
      try {
        await this.importOfflineBrowserArchives();
      } catch (error) {
        console.error('[BrowserProvisioning] Failed to import offline browser images:', error);
      }
      try {
        await this.cleanupDuplicateCatalogItems();
      } catch (error) {
        console.error('[BrowserProvisioning] Failed to cleanup duplicate catalog items:', error);
      }
      try {
        await this.recoverInterruptedJobs();
      } catch (error) {
        console.error('[BrowserProvisioning] Failed to recover interrupted jobs:', error);
      }
      try {
        await this.syncLocalImagesToCatalog();
      } catch (error) {
        console.error('[BrowserProvisioning] Failed to sync local browser images:', error);
      }
    });

    const scanSeconds = Number(process.env.JINGCANG_BROWSER_IMAGE_SCAN_INTERVAL_SECONDS || '30');
    if (this.imageArchiveDir && Number.isFinite(scanSeconds) && scanSeconds > 0) {
      const timer = setInterval(() => {
        this.importOfflineBrowserArchives()
          .then(() => this.cleanupDuplicateCatalogItems())
          .then(() => this.syncLocalImagesToCatalog())
          .catch((error) => {
            console.error('[BrowserProvisioning] Offline browser image scan failed:', error);
          });
      }, Math.max(5, scanSeconds) * 1000);
      timer.unref();
    }
  }

  public createInstallJob(userId: string, input: BrowserInstallRequest): BrowserInstallJob {
    const db = getDb(this.config);
    const existingBrowser = this.catalogService.getBrowserByVendorVersion(input.browserName, input.version);
    const now = new Date().toISOString();
    const image = `${this.getImageRepository(input.browserName)}:${input.version}`;
    const options = {
      useOffline: input.useOffline !== false,
      allowRemote: input.allowRemote !== false
    };
    const optionsJson = JSON.stringify(options);

    if (existingBrowser?.enabled) {
      const jobId = `install-${crypto.randomUUID()}`;
      db.prepare(`
        INSERT INTO browser_install_jobs (
          id, user_id, browser_name, version, image, status, status_message,
          browser_id, options_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'READY', ?, ?, ?, ?, ?)
      `).run(
        jobId,
        userId,
        input.browserName,
        existingBrowser.version,
        existingBrowser.image,
        `浏览器版本 ${existingBrowser.displayName} 已在舱位矩阵中，无需重复安装`,
        existingBrowser.id,
        optionsJson,
        now,
        now
      );
      return this.getInstallJob(jobId)!;
    }

    const duplicate = db.prepare(`
      SELECT id FROM browser_install_jobs
      WHERE browser_name = ? AND version = ?
        AND status IN ('PENDING', 'PULLING', 'STARTING')
      ORDER BY created_at DESC LIMIT 1
    `).get(input.browserName, input.version) as { id: string } | undefined;
    if (duplicate) return this.getInstallJob(duplicate.id)!;

    const activeJob = db.prepare(`
      SELECT id FROM browser_install_jobs
      WHERE status IN ('PENDING', 'PULLING', 'STARTING')
      LIMIT 1
    `).get() as { id: string } | undefined;
    if (activeJob) {
      throw new Error('已有浏览器版本正在接入，请等待当前任务完成后再试');
    }

    const jobId = `install-${crypto.randomUUID()}`;
    db.prepare(`
      INSERT INTO browser_install_jobs (
        id, user_id, browser_name, version, image, status, status_message,
        options_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?)
    `).run(
      jobId,
      userId,
      input.browserName,
      input.version,
      image,
      '安装任务已创建，正在等待浏览器镜像准备',
      optionsJson,
      now,
      now
    );

    setImmediate(() => {
      this.runInstall(jobId).catch((error) => {
        console.error(`[BrowserProvisioning] Unexpected install failure for ${jobId}:`, error);
      });
    });

    return this.getInstallJob(jobId)!;
  }

  public getInstallJob(id: string): BrowserInstallJob | null {
    const db = getDb(this.config);
    const row = db.prepare('SELECT * FROM browser_install_jobs WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.formatJob(row);
  }

  public getInstallJobOwner(id: string): string | null {
    const db = getDb(this.config);
    const row = db.prepare('SELECT user_id FROM browser_install_jobs WHERE id = ?').get(id) as
      | { user_id: string }
      | undefined;
    return row?.user_id || null;
  }

  private async runInstall(jobId: string): Promise<void> {
    const db = getDb(this.config);
    const row = db.prepare('SELECT * FROM browser_install_jobs WHERE id = ?').get(jobId) as any;
    if (!row) return;

    let options: { useOffline?: boolean; allowRemote?: boolean } = {
      useOffline: true,
      allowRemote: true
    };
    if (row.options_json) {
      try {
        options = JSON.parse(row.options_json);
      } catch {}
    }

    const job = this.formatJob(row);
    let containerId: string | null = null;
    try {
      this.updateJob(jobId, 'PULLING', `正在解析 ${DISPLAY_NAMES[job.browserName] || job.browserName} ${job.version} 对应的浏览器镜像`);
      const resolvedImage = await this.resolveSeleniumImage(job.browserName, job.version, options, jobId);
      this.setJobImage(jobId, resolvedImage);

      const existingByImage = this.catalogService.getBrowserByImage?.(job.browserName, resolvedImage);
      if (existingByImage?.enabled) {
        this.updateJob(jobId, 'READY', `匹配到已存在的节点 ${existingByImage.displayName}，已直接复用`);
        this.finishJob(jobId, existingByImage.id);
        return;
      }

      const existingBrowser = this.catalogService.getBrowserByVendorVersion(job.browserName, job.version);
      if (existingBrowser?.enabled) {
        this.updateJob(jobId, 'READY', `匹配到已存在的节点 ${existingBrowser.displayName}，已直接复用`);
        this.finishJob(jobId, existingBrowser.id);
        return;
      }

      this.updateJob(jobId, 'PULLING', `正在确保镜像 ${resolvedImage} 可用`);
      await this.docker.pullImage(resolvedImage);

      const browserId = existingBrowser?.id || this.buildBrowserId(job.browserName, job.version);
      const jobSuffix = job.id.replace('install-', '').slice(0, 8);
      const containerName = `jc-${job.browserName}-${job.version.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 28)}-${jobSuffix}`
        .replace(/-+/g, '-')
        .replace(/-$/g, '')
        .slice(0, 63);
      this.updateJob(jobId, 'STARTING', '镜像准备完成，正在启动并检查浏览器节点');
      const started = await this.docker.startStandaloneBrowser(resolvedImage, containerName, browserId);
      containerId = started.containerId;
      this.setContainerId(jobId, containerId);

      await this.docker.waitUntilReady(started.gridUrl);

      const item: BrowserItem = {
        id: browserId,
        browserName: job.browserName,
        displayName: `${DISPLAY_NAMES[job.browserName]} (${job.version})`,
        version: job.version,
        channel: this.inferChannel(job.version),
        image: resolvedImage,
        gridUrl: started.gridUrl,
        platform: 'linux-amd64',
        enabled: true,
        isDefault: false,
        resourceJson: { cpus: 2, memory: '3g', shmSize: '2g' }
      };
      this.catalogService.addDynamicCatalogItem(item, containerId);
      this.finishJob(jobId, browserId);
    } catch (error: any) {
      if (containerId) await this.docker.removeContainer(containerId);
      const message = this.toUserError(error);
      this.failJob(jobId, message);
    }
  }

  private getImageRepository(browserName: BrowserVendor): string {
    return buildSeleniumRepository(browserName, this.imageRepositoryPrefix);
  }

  private async importOfflineBrowserArchives(): Promise<string[]> {
    if (!this.imageArchiveDir) return [];
    if (this.archiveImportPromise) return this.archiveImportPromise;

    this.archiveImportPromise = this.docker.loadImageArchives(this.imageArchiveDir)
      .then((archives) => {
        if (archives.length > 0) {
          console.info(
            `[BrowserProvisioning] Imported offline browser image archives: ${archives.join(', ')}`
          );
        }
        return archives;
      })
      .finally(() => {
        this.archiveImportPromise = null;
      });

    return this.archiveImportPromise;
  }

  private async syncLocalImagesToCatalog(): Promise<void> {
    if (!this.autoSyncLocalImages) return;
    if (this.localImageSyncPromise) return this.localImageSyncPromise;

    const syncPromise = this.performLocalImageSync()
      .finally(() => {
        this.localImageSyncPromise = null;
      });
    this.localImageSyncPromise = syncPromise;
    return syncPromise;
  }

  public async cleanupDuplicateCatalogItems(): Promise<void> {
    const { removedIds, removedContainerIds } = this.catalogService.deduplicateCatalogItems();
    if (removedIds.length > 0) {
      console.info(
        `[BrowserProvisioning] Cleaned up ${removedIds.length} duplicate browser catalog item(s): ${removedIds.join(', ')}`
      );
    }
    for (const containerId of removedContainerIds) {
      try {
        await this.docker.removeContainer(containerId);
      } catch (err) {
        console.warn(`[BrowserProvisioning] Failed to remove duplicate container ${containerId}:`, err);
      }
    }
  }

  private async performLocalImageSync(): Promise<void> {
    const candidates: Array<{
      browserName: BrowserVendor;
      version: string;
      image: string;
    }> = [];
    const seen = new Set<string>();

    for (const browserName of Object.keys(IMAGE_REPOSITORIES) as BrowserVendor[]) {
      const repositories = Array.from(new Set([
        this.getImageRepository(browserName),
        IMAGE_REPOSITORIES[browserName]
      ]));

      for (const repository of repositories) {
        const rawTags = await this.docker.listImageTags(repository);
        const tagGroups = new Map<string, string[]>();
        for (const tag of rawTags) {
          if (tag === 'latest' || /chromedriver|grid-/i.test(tag)) continue;
          let matchedKey: string | null = null;
          for (const key of tagGroups.keys()) {
            if (isVersionEquivalent(key, tag)) {
              matchedKey = key;
              break;
            }
          }
          if (matchedKey) {
            tagGroups.get(matchedKey)!.push(tag);
          } else {
            tagGroups.set(tag, [tag]);
          }
        }

        for (const group of tagGroups.values()) {
          group.sort((a, b) => {
            const hasDateA = /-\d{8}$/.test(a) ? 1 : 0;
            const hasDateB = /-\d{8}$/.test(b) ? 1 : 0;
            if (hasDateA !== hasDateB) return hasDateA - hasDateB;
            const isStdA = /^\d+\.0$/.test(a) ? 0 : 1;
            const isStdB = /^\d+\.0$/.test(b) ? 0 : 1;
            if (isStdA !== isStdB) return isStdA - isStdB;
            return a.length - b.length;
          });
          const version = group[0];
          const key = `${browserName}:${version}`;
          if (seen.has(key)) continue;
          seen.add(key);
          candidates.push({
            browserName,
            version,
            image: `${repository}:${version}`
          });
        }
      }
    }

    candidates.sort((a, b) =>
      a.browserName.localeCompare(b.browserName) || a.version.localeCompare(b.version)
    );

    let synced = 0;
    for (const candidate of candidates) {
      const existingByImage = this.catalogService.getBrowserByImage?.(
        candidate.browserName,
        candidate.image
      );
      if (existingByImage) continue;

      const existing = this.catalogService.getBrowserByVendorVersion(
        candidate.browserName,
        candidate.version
      );
      if (existing) continue;

      const browserId = this.buildBrowserId(candidate.browserName, candidate.version);
      const containerName = `jc-auto-${browserId}`
        .replace(/-+/g, '-')
        .replace(/-$/g, '')
        .slice(0, 63);

      let containerId: string | null = null;
      try {
        await this.docker.removeContainer(containerName);
        const started = await this.docker.startStandaloneBrowser(
          candidate.image,
          containerName,
          browserId
        );
        containerId = started.containerId;
        await this.docker.waitUntilReady(started.gridUrl);

        const item: BrowserItem = {
          id: browserId,
          browserName: candidate.browserName,
          displayName: `${DISPLAY_NAMES[candidate.browserName]} (${candidate.version})`,
          version: candidate.version,
          channel: this.inferChannel(candidate.version),
          image: candidate.image,
          gridUrl: started.gridUrl,
          platform: 'linux-amd64',
          enabled: true,
          isDefault: false,
          resourceJson: { cpus: 2, memory: '3g', shmSize: '2g' }
        };

        this.catalogService.addDynamicCatalogItem(item, started.containerId);
        synced += 1;
        console.info(
          `[BrowserProvisioning] Auto-synced local browser image ${candidate.image} as ${browserId}`
        );
      } catch (error: any) {
        if (containerId) await this.docker.removeContainer(containerId);
        console.error(
          `[BrowserProvisioning] Failed to auto-sync local browser image ${candidate.image}:`,
          error?.message || error
        );
      }
    }

    if (synced > 0) {
      console.info(`[BrowserProvisioning] Auto-synced ${synced} local browser image(s) to catalog`);
    }
  }

  private async findLocalSeleniumImage(
    browserName: BrowserVendor,
    requestedVersion: string
  ): Promise<string | null> {
    const repositories = Array.from(new Set([
      this.getImageRepository(browserName),
      IMAGE_REPOSITORIES[browserName]
    ]));

    for (const repository of repositories) {
      const tags = await this.docker.listImageTags(repository);
      const selectedTag = selectSeleniumTag(requestedVersion, tags);
      if (selectedTag) return `${repository}:${selectedTag}`;
    }

    return null;
  }

  private async resolveSeleniumImage(
    browserName: BrowserVendor,
    requestedVersion: string,
    options?: { useOffline?: boolean; allowRemote?: boolean },
    jobId?: string
  ): Promise<string> {
    const useOffline = options?.useOffline !== false;
    const allowRemote = options?.allowRemote !== false;
    const requested = requestedVersion.trim();

    if (useOffline) {
      if (jobId) {
        this.updateJob(jobId, 'PULLING', `正在检索本地及固定离线镜像目录...`);
      }
      await this.importOfflineBrowserArchives();
      const localImage = await this.findLocalSeleniumImage(browserName, requested);
      if (localImage) {
        if (jobId) {
          this.updateJob(jobId, 'PULLING', `已在本地/离线镜像中命中：${localImage}，准备启动节点`);
        }
        return localImage;
      }
    } else {
      const localImage = await this.findLocalSeleniumImage(browserName, requested);
      if (localImage) {
        if (jobId) {
          this.updateJob(jobId, 'PULLING', `已在本地镜像中命中：${localImage}，准备启动节点`);
        }
        return localImage;
      }
    }

    if (!allowRemote) {
      throw new Error(
        `离线模式下未找到 ${DISPLAY_NAMES[browserName]} ${requested} 的本地镜像。` +
        `已禁用远程仓库检索，请把 docker save 生成的镜像包上传到 ${this.imageArchiveDir || 'JINGCANG_BROWSER_IMAGE_ARCHIVE_DIR'} 后重试`
      );
    }

    if (jobId) {
      this.updateJob(
        jobId,
        'PULLING',
        `离线镜像中未包含版本 ${requested}，正在根据版本号检索远程镜像仓库...`
      );
    }

    const repository = this.getImageRepository(browserName);
    const officialRepository = IMAGE_REPOSITORIES[browserName];
    const channel = requested.toLowerCase();
    const lookupVersion = /^\d+$/.test(requested) ? `${requested}.0` : requested;

    if (['latest', 'beta', 'dev', 'nightly'].includes(channel)) {
      return `${repository}:${channel}`;
    }

    if (repository !== officialRepository) {
      return `${repository}:${lookupVersion}`;
    }

    let tags: string[] = [];
    let remoteError: Error | null = null;
    try {
      tags = await this.fetchOfficialSeleniumTags(officialRepository, requested, lookupVersion);
    } catch (error: any) {
      remoteError = error;
    }

    const selectedTag = tags.length > 0 ? selectSeleniumTag(requested, tags) : null;
    if (!selectedTag) {
      if (remoteError) {
        throw new Error(
          `离线镜像目录中未找到 ${DISPLAY_NAMES[browserName]} ${requested}，且尝试连接远程仓库检索失败：${remoteError.message}。` +
          `若当前为纯离线或无公网环境，请使用 docker save 导出镜像包并上传到 ${this.imageArchiveDir || '固定文件夹'} 后重试`
        );
      }
      throw new Error(
        `未找到 ${DISPLAY_NAMES[browserName]} ${requested} 对应的镜像：离线镜像目录未包含该版本，远程官方仓库中亦未检索到匹配标签。请检查版本号后重试`
      );
    }

    if (jobId) {
      this.updateJob(
        jobId,
        'PULLING',
        `已在远程仓库匹配到镜像标签 ${selectedTag}，正在下载并准备节点...`
      );
    }
    return `${repository}:${selectedTag}`;
  }

  private async fetchOfficialSeleniumTags(
    officialRepository: string,
    requested: string,
    lookupVersion: string
  ): Promise<string[]> {
    const candidates = Array.from(new Set([
      lookupVersion,
      requested,
      requested.split('.')[0]
    ])).filter(Boolean);

    const allTags = new Set<string>();

    for (const queryName of candidates) {
      const endpoint = new URL(`https://hub.docker.com/v2/repositories/${officialRepository}/tags`);
      endpoint.searchParams.set('page_size', '100');
      endpoint.searchParams.set('ordering', 'last_updated');
      endpoint.searchParams.set('name', queryName);

      try {
        const response = await fetch(endpoint, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(15_000)
        });

        if (response.ok) {
          const payload = (await response.json()) as {
            results?: Array<{
              name?: string;
              tag_status?: string;
              images?: Array<{ os?: string; architecture?: string }>;
            }>;
          };

          for (const item of payload.results || []) {
            if (item.tag_status === 'inactive') continue;
            if (
              item.images?.length &&
              !item.images.some((image) => image.os === 'linux' && image.architecture === 'amd64')
            ) {
              continue;
            }
            if (item.name) {
              allTags.add(item.name);
            }
          }
        }
      } catch (err: any) {
        if (allTags.size === 0 && queryName === candidates[0]) {
          throw err;
        }
      }

      if (allTags.size > 0 && selectSeleniumTag(requested, Array.from(allTags))) {
        break;
      }
    }

    return Array.from(allTags);
  }

  private updateJob(id: string, status: BrowserInstallStatus, statusMessage: string): void {
    const db = getDb(this.config);
    db.prepare(`
      UPDATE browser_install_jobs
      SET status = ?, status_message = ?, error_message = NULL, updated_at = ?
      WHERE id = ?
    `).run(status, statusMessage, new Date().toISOString(), id);
  }

  private setJobImage(id: string, image: string): void {
    const db = getDb(this.config);
    db.prepare(`
      UPDATE browser_install_jobs SET image = ?, updated_at = ? WHERE id = ?
    `).run(image, new Date().toISOString(), id);
  }

  private setContainerId(id: string, containerId: string): void {
    const db = getDb(this.config);
    db.prepare(`
      UPDATE browser_install_jobs SET container_id = ?, updated_at = ? WHERE id = ?
    `).run(containerId, new Date().toISOString(), id);
  }

  private finishJob(id: string, browserId: string): void {
    const db = getDb(this.config);
    db.prepare(`
      UPDATE browser_install_jobs
      SET status = 'READY', status_message = '浏览器节点已就绪并接入舱位矩阵',
          browser_id = ?, error_message = NULL, updated_at = ?
      WHERE id = ?
    `).run(browserId, new Date().toISOString(), id);
  }

  private failJob(id: string, errorMessage: string): void {
    const db = getDb(this.config);
    db.prepare(`
      UPDATE browser_install_jobs
      SET status = 'FAILED', status_message = '浏览器版本接入失败',
          error_message = ?, updated_at = ?
      WHERE id = ?
    `).run(errorMessage, new Date().toISOString(), id);
  }

  private async recoverInterruptedJobs(): Promise<void> {
    const db = getDb(this.config);
    const interrupted = db.prepare(`
      SELECT id, container_id FROM browser_install_jobs
      WHERE status IN ('PENDING', 'PULLING', 'STARTING')
    `).all() as Array<{ id: string; container_id?: string | null }>;

    for (const job of interrupted) {
      if (job.container_id) await this.docker.removeContainer(job.container_id);
    }

    db.prepare(`
      UPDATE browser_install_jobs
      SET status = 'FAILED', status_message = '安装任务被服务重启中断',
          error_message = '控制服务重启后安装任务未能继续，请重新提交', updated_at = ?
      WHERE status IN ('PENDING', 'PULLING', 'STARTING')
    `).run(new Date().toISOString());
  }

  private buildBrowserId(browserName: BrowserVendor, version: string): string {
    const safeVersion = version.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const suffix = crypto.createHash('sha256').update(version).digest('hex').slice(0, 8);
    return `${browserName}-${safeVersion || 'custom'}-${suffix}`;
  }

  private inferChannel(version: string): 'stable' | 'beta' | 'dev' | 'esr' {
    const normalized = version.toLowerCase();
    if (normalized.includes('beta')) return 'beta';
    if (normalized.includes('dev')) return 'dev';
    if (normalized.includes('esr')) return 'esr';
    return 'stable';
  }

  private toUserError(error: any): string {
    const raw = String(error?.message || error || '未知错误');
    if (/manifest unknown|not found|pull access denied/i.test(raw)) {
      return '未找到该厂商与版本对应的浏览器镜像，请检查版本号或镜像仓库配置后重试';
    }
    if (/ENOENT|not recognized|Docker 命令执行失败/i.test(raw)) {
      return '无法连接 Docker Engine，请确认 Docker 已启动且控制服务拥有 Docker Socket 权限';
    }
    return raw.slice(0, 1000);
  }

  private formatJob(row: any): BrowserInstallJob {
    return {
      id: row.id,
      browserName: row.browser_name,
      version: row.version,
      image: row.image,
      status: row.status,
      statusMessage: row.status_message,
      browserId: row.browser_id || undefined,
      errorMessage: row.error_message || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}
