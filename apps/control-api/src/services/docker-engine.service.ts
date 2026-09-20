import fs from 'node:fs';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Config } from '../config.js';

const execFileAsync = promisify(execFile);

interface StartedContainer {
  containerId: string;
  gridUrl: string;
}

interface DockerResponse {
  statusCode: number;
  body: string;
}

export class DockerEngineService {
  private readonly socketPath: string;
  private apiVersion: string | null = null;

  constructor(private config: Config) {
    this.socketPath = process.env.JINGCANG_DOCKER_SOCKET?.trim() || '/var/run/docker.sock';
  }

  public async pullImage(image: string): Promise<void> {
    if (await this.imageExists(image)) return;

    if (this.canUseSocket()) {
      const [repository, tag] = this.splitImage(image);
      await this.requestDocker(
        'POST',
        `/images/create?fromImage=${encodeURIComponent(repository)}&tag=${encodeURIComponent(tag)}&platform=linux%2Famd64`,
        undefined,
        true
      );
      return;
    }

    await this.runDockerCli(['pull', '--platform', 'linux/amd64', image], 15 * 60 * 1000);
  }

  public async startStandaloneBrowser(
    image: string,
    containerName: string,
    browserId: string
  ): Promise<StartedContainer> {
    const environment = [
      'SE_NODE_MAX_SESSIONS=4',
      'SE_NODE_OVERRIDE_MAX_SESSIONS=true',
      'SE_NODE_SESSION_TIMEOUT=7200',
      'SE_SCREEN_WIDTH=2560',
      'SE_SCREEN_HEIGHT=1440',
      'SE_VNC_NO_PASSWORD=true',
      'SE_START_VNC=true'
    ];

    if (this.canUseSocket()) {
      const networkName = await this.resolveBackendNetwork();
      const createResponse = await this.requestDocker(
        'POST',
        `/containers/create?name=${encodeURIComponent(containerName)}`,
        {
          Image: image,
          Env: environment,
          Labels: {
            'com.jingcang.managed': 'true',
            'com.jingcang.browser-id': browserId
          },
          ExposedPorts: {
            '4444/tcp': {},
            '7900/tcp': {}
          },
          HostConfig: {
            NetworkMode: networkName,
            ShmSize: 2 * 1024 * 1024 * 1024,
            RestartPolicy: { Name: 'unless-stopped', MaximumRetryCount: 0 }
          }
        }
      );
      const created = JSON.parse(createResponse.body) as { Id?: string };
      if (!created.Id) throw new Error('Docker 未返回新节点的容器 ID');

      await this.requestDocker('POST', `/containers/${encodeURIComponent(created.Id)}/start`);
      return {
        containerId: created.Id,
        gridUrl: `http://${containerName}:4444`
      };
    }

    const args = [
      'run', '-d',
      '--name', containerName,
      '--restart', 'unless-stopped',
      '--shm-size', '2g',
      '-p', '127.0.0.1::4444',
      '--label', 'com.jingcang.managed=true',
      '--label', `com.jingcang.browser-id=${browserId}`
    ];
    for (const env of environment) args.push('-e', env);
    args.push(image);

    const { stdout } = await this.runDockerCli(args, 2 * 60 * 1000);
    const containerId = stdout.trim();
    const portResult = await this.runDockerCli(['port', containerId, '4444/tcp'], 30_000);
    const portMatch = portResult.stdout.trim().match(/:(\d+)$/m);
    if (!portMatch) {
      await this.removeContainer(containerId);
      throw new Error('无法获取浏览器节点的本地映射端口');
    }

    return {
      containerId,
      gridUrl: `http://127.0.0.1:${portMatch[1]}`
    };
  }

  public async waitUntilReady(gridUrl: string, timeoutMs = 120_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastError = '';

    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${gridUrl}/status`, {
          signal: AbortSignal.timeout(5_000)
        });
        if (response.ok) {
          const payload = await response.json() as any;
          if (payload?.value?.ready === true || payload?.ready === true) return;
          lastError = payload?.value?.message || '节点仍在初始化';
        } else {
          lastError = `健康检查返回 HTTP ${response.status}`;
        }
      } catch (error: any) {
        lastError = error?.message || '暂时无法连接节点';
      }

      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }

    throw new Error(`浏览器节点在 ${Math.round(timeoutMs / 1000)} 秒内未就绪：${lastError}`);
  }

  public async removeContainer(containerId: string): Promise<void> {
    try {
      if (this.canUseSocket()) {
        await this.requestDocker('DELETE', `/containers/${encodeURIComponent(containerId)}?force=true`);
      } else {
        await this.runDockerCli(['rm', '-f', containerId], 30_000);
      }
    } catch (error) {
      console.warn(`[DockerEngineService] Failed to remove container ${containerId}:`, error);
    }
  }

  private canUseSocket(): boolean {
    return fs.existsSync(this.socketPath);
  }

  private async imageExists(image: string): Promise<boolean> {
    try {
      if (this.canUseSocket()) {
        await this.requestDocker('GET', `/images/${encodeURIComponent(image)}/json`);
      } else {
        await this.runDockerCli(['image', 'inspect', image], 30_000);
      }
      return true;
    } catch {
      return false;
    }
  }

  private splitImage(image: string): [string, string] {
    const separator = image.lastIndexOf(':');
    if (separator <= image.lastIndexOf('/')) return [image, 'latest'];
    return [image.slice(0, separator), image.slice(separator + 1)];
  }

  private async resolveBackendNetwork(): Promise<string> {
    const selfId = process.env.HOSTNAME?.trim();
    if (!selfId) throw new Error('无法识别控制服务容器，不能连接浏览器节点网络');

    const response = await this.requestDocker('GET', `/containers/${encodeURIComponent(selfId)}/json`);
    const info = JSON.parse(response.body) as any;
    const networks = Object.keys(info?.NetworkSettings?.Networks || {});
    const backend = networks.find((name) => name.endsWith('_jingcang_backend'))
      || networks.find((name) => name.includes('backend'));
    if (!backend) throw new Error('控制服务未连接到镜舱后端 Docker 网络');
    return backend;
  }

  private async requestDocker(
    method: string,
    requestPath: string,
    body?: unknown,
    streamResponse = false
  ): Promise<DockerResponse> {
    const apiVersion = await this.getApiVersion();
    return this.requestDockerRaw(
      method,
      `/v${apiVersion}${requestPath}`,
      body,
      streamResponse
    );
  }

  private async getApiVersion(): Promise<string> {
    if (this.apiVersion) return this.apiVersion;

    const response = await this.requestDockerRaw('GET', '/version');
    try {
      const payload = JSON.parse(response.body) as { ApiVersion?: string };
      if (!payload.ApiVersion || !/^\d+\.\d+$/.test(payload.ApiVersion)) {
        throw new Error('Docker Engine 未返回有效 ApiVersion');
      }
      this.apiVersion = payload.ApiVersion;
      return this.apiVersion;
    } catch (error: any) {
      throw new Error(`Docker API 版本协商失败：${error?.message || '响应格式无效'}`);
    }
  }

  private requestDockerRaw(
    method: string,
    requestPath: string,
    body?: unknown,
    streamResponse = false
  ): Promise<DockerResponse> {
    return new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const request = http.request({
        socketPath: this.socketPath,
        path: requestPath,
        method,
        headers: payload ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        } : undefined
      }, (response) => {
        const chunks: Buffer[] = [];
        let streamError = '';
        let streamBuffer = '';
        let streamBody = '';

        response.on('data', (chunk: Buffer) => {
          if (!streamResponse) {
            chunks.push(chunk);
            return;
          }

          const text = chunk.toString('utf8');
          streamBody += text;
          streamBuffer += text;
          let newline = streamBuffer.indexOf('\n');
          while (newline >= 0) {
            const line = streamBuffer.slice(0, newline);
            streamBuffer = streamBuffer.slice(newline + 1);
            this.captureStreamError(line, (message) => { streamError = message; });
            newline = streamBuffer.indexOf('\n');
          }
        });

        response.on('end', () => {
          if (streamResponse && streamBuffer.trim()) {
            this.captureStreamError(streamBuffer, (message) => { streamError = message; });
          }

          const responseBody = streamResponse
            ? streamBody
            : Buffer.concat(chunks).toString('utf8');
          const statusCode = response.statusCode || 500;

          if (statusCode < 200 || statusCode >= 300 || streamError) {
            reject(new Error(
              streamError ||
              this.extractDockerError(responseBody) ||
              `Docker API 返回 HTTP ${statusCode}`
            ));
            return;
          }

          resolve({
            statusCode,
            body: streamResponse ? '' : responseBody
          });
        });
      });

      request.setTimeout(15 * 60 * 1000, () => {
        request.destroy(new Error('Docker 操作超时'));
      });
      request.on('error', reject);
      if (payload) request.write(payload);
      request.end();
    });
  }

  private extractDockerError(body: string): string {
    const trimmed = body.trim();
    if (!trimmed) return '';

    const lines = trimmed.split(/\r?\n/).filter(Boolean).reverse();
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        const message = event?.errorDetail?.message || event?.error || event?.message;
        if (message) return String(message);
      } catch {
        // Continue trying other NDJSON lines.
      }
    }

    return trimmed.length <= 1000 ? trimmed : trimmed.slice(0, 1000);
  }

  private captureStreamError(line: string, setError: (message: string) => void): void {
    if (!line.trim()) return;
    try {
      const event = JSON.parse(line);
      const message = event?.errorDetail?.message || event?.error;
      if (message) setError(String(message));
    } catch {
      // Ignore non-JSON progress fragments returned by older Docker daemons.
    }
  }

  private async runDockerCli(args: string[], timeout: number): Promise<{ stdout: string; stderr: string }> {
    try {
      return await execFileAsync('docker', args, {
        timeout,
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024
      });
    } catch (error: any) {
      const detail = error?.stderr?.trim() || error?.stdout?.trim() || error?.message || '未知错误';
      throw new Error(`Docker 命令执行失败：${detail}`);
    }
  }
}
