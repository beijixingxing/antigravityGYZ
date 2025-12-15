import { spawn, ChildProcess } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';

interface RequestOptions {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeout_ms?: number;
    proxy?: string;
}

interface StreamResponse {
    id: string;
    status: number | null;
    headers: Map<string, string> | null;
    chunks: string[];
    onStart: (callback: (data: { status: number; headers: Map<string, string> }) => void) => StreamResponse;
    onData: (callback: (chunk: string) => void) => StreamResponse;
    onEnd: (callback: () => void) => StreamResponse;
    onError: (callback: (error: Error) => void) => StreamResponse;
}

interface AntigravityResponse {
    ok: boolean;
    status: number;
    statusText: string;
    headers: Map<string, string>;
    text: () => Promise<string>;
    json: () => Promise<any>;
}

/**
 * TLS 指纹请求器
 * 通过子进程调用本地二进制实现反爬指纹
 */
class AntigravityRequester {
    private proc: ChildProcess | null = null;
    private executablePath: string;
    private requestId: number = 0;
    private pendingRequests: Map<string, any> = new Map();
    private buffer: string = '';
    private writeQueue: Promise<void> = Promise.resolve();
    private useAxiosFallback: boolean = false;

    constructor() {
        try {
            this.executablePath = this.getExecutablePath();
        } catch (error: any) {
            console.warn('[AntigravityRequester] 初始化失败，降级使用 axios fallback:', error.message);
            this.useAxiosFallback = true;
            this.executablePath = '';
        }
    }

    private getExecutablePath(): string {
        const platform = os.platform();

        let filename: string;
        if (platform === 'win32') {
            filename = 'antigravity_requester_windows_amd64.exe';
        } else if (platform === 'linux') {
            filename = 'antigravity_requester_linux_amd64';
        } else if (platform === 'android') {
            filename = 'antigravity_requester_android_arm64';
        } else {
            throw new Error(`Unsupported platform: ${platform}`);
        }

        const binPath = path.join(process.cwd(), 'src', 'bin');
        const execPath = path.join(binPath, filename);

        if (!fs.existsSync(execPath)) {
            throw new Error(`Binary not found: ${execPath}`);
        }

        // 设置执行权限（非 Windows）
        if (platform !== 'win32') {
            try {
                fs.chmodSync(execPath, 0o755);
            } catch (e) {
                console.warn('[AntigravityRequester] 无法设置执行权限');
            }
        }

        return execPath;
    }

    private ensureProcess(): void {
        if (this.proc || this.useAxiosFallback) return;

        this.proc = spawn(this.executablePath, [], {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        this.proc.stdout?.setEncoding('utf8');

        this.proc.stdout?.on('data', (data: string) => {
            this.buffer += data;

            setImmediate(() => {
                const lines = this.buffer.split('\n');
                this.buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const response = JSON.parse(line);
                        const pending = this.pendingRequests.get(response.id);
                        if (!pending) continue;

                        if (pending.streamResponse) {
                            pending.streamResponse._handleChunk(response);
                            if (response.type === 'end' || response.type === 'error') {
                                this.pendingRequests.delete(response.id);
                            }
                        } else {
                            this.pendingRequests.delete(response.id);
                            if (response.ok) {
                                pending.resolve(this.createResponse(response));
                            } else {
                                pending.reject(new Error(response.error || 'Request failed'));
                            }
                        }
                    } catch (e) {
                        console.error('[AntigravityRequester] Failed to parse response:', e);
                    }
                }
            });
        });

        this.proc.stderr?.on('data', (data: Buffer) => {
            console.error('[AntigravityRequester] stderr:', data.toString());
        });

        this.proc.on('close', () => {
            this.proc = null;
            for (const [id, pending] of this.pendingRequests) {
                if (pending.reject) {
                    pending.reject(new Error('Process closed'));
                } else if (pending.streamResponse?._onError) {
                    pending.streamResponse._onError(new Error('Process closed'));
                }
            }
            this.pendingRequests.clear();
        });
    }

    private createResponse(response: any): AntigravityResponse {
        const body = response.body_encoding === 'base64'
            ? Buffer.from(response.body, 'base64').toString('utf8')
            : response.body;

        return {
            ok: response.ok,
            status: response.status,
            statusText: response.status_text,
            headers: new Map(Object.entries(response.headers || {})),
            text: async () => body,
            json: async () => JSON.parse(body)
        };
    }

    async fetch(url: string, options: RequestOptions = {}): Promise<AntigravityResponse> {
        if (this.useAxiosFallback) {
            return this.axiosFallback(url, options);
        }

        this.ensureProcess();

        const id = `req-${++this.requestId}`;
        const request = {
            id,
            url,
            method: options.method || 'POST',
            headers: options.headers,
            body: options.body,
            timeout_ms: options.timeout_ms || 30000,
            proxy: options.proxy,
            response_format: 'text'
        };

        return new Promise((resolve, reject) => {
            this.pendingRequests.set(id, { resolve, reject });
            this.writeRequest(request);
        });
    }

    fetchStream(url: string, options: RequestOptions = {}): StreamResponse {
        if (this.useAxiosFallback) {
            const id = `req-${++this.requestId}`;
            const streamResponse = this.createStreamResponse(id);
            (async () => {
                try {
                    const axios = (await import('axios')).default;
                    const axiosConfig: any = {
                        method: (options.method || 'POST') as any,
                        url,
                        headers: options.headers,
                        data: options.body,
                        timeout: options.timeout_ms || 180000,
                        responseType: 'stream',
                        proxy: options.proxy ? (() => {
                            const proxyUrl = new URL(options.proxy!);
                            return {
                                protocol: proxyUrl.protocol.replace(':', ''),
                                host: proxyUrl.hostname,
                                port: parseInt(proxyUrl.port)
                            };
                        })() : false
                    };
                    const response = await axios(axiosConfig);
                    streamResponse._handleChunk({ type: 'start', status: response.status, headers: Object.fromEntries(Object.entries(response.headers || {})) });
                    response.data.on('data', (chunk: any) => {
                        const dataStr = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
                        streamResponse._handleChunk({ type: 'data', data: dataStr, encoding: 'utf8' });
                    });
                    response.data.on('end', () => {
                        streamResponse._handleChunk({ type: 'end' });
                    });
                    response.data.on('error', (err: any) => {
                        streamResponse._handleChunk({ type: 'error', error: err?.message || String(err) });
                    });
                } catch (error: any) {
                    streamResponse._handleChunk({ type: 'error', error: error?.message || String(error) });
                }
            })();
            return streamResponse;
        }
        this.ensureProcess();

        const id = `req-${++this.requestId}`;
        const request = {
            id,
            url,
            method: options.method || 'POST',
            headers: options.headers,
            body: options.body,
            timeout_ms: options.timeout_ms || 180000,
            proxy: options.proxy,
            stream: true
        };

        const streamResponse = this.createStreamResponse(id);
        this.pendingRequests.set(id, { streamResponse });
        this.writeRequest(request);

        return streamResponse;
    }

    private createStreamResponse(id: string): StreamResponse & { _handleChunk: (chunk: any) => void } {
        let _onStart: ((data: any) => void) | null = null;
        let _onData: ((chunk: string) => void) | null = null;
        let _onEnd: (() => void) | null = null;
        let _onError: ((error: Error) => void) | null = null;

        const response: any = {
            id,
            status: null,
            headers: null,
            chunks: [],
            onStart(callback: any) { _onStart = callback; return this; },
            onData(callback: any) { _onData = callback; return this; },
            onEnd(callback: any) { _onEnd = callback; return this; },
            onError(callback: any) { _onError = callback; return this; },
            _handleChunk(chunk: any) {
                if (chunk.type === 'start') {
                    this.status = chunk.status;
                    this.headers = new Map(Object.entries(chunk.headers || {}));
                    if (_onStart) _onStart({ status: chunk.status, headers: this.headers });
                } else if (chunk.type === 'data') {
                    const data = chunk.encoding === 'base64'
                        ? Buffer.from(chunk.data, 'base64').toString('utf8')
                        : chunk.data;
                    this.chunks.push(data);
                    if (_onData) _onData(data);
                } else if (chunk.type === 'end') {
                    if (_onEnd) _onEnd();
                } else if (chunk.type === 'error') {
                    if (_onError) _onError(new Error(chunk.error));
                }
            },
            _onError
        };

        return response;
    }

    private writeRequest(request: any): void {
        this.writeQueue = this.writeQueue.then(() => {
            return new Promise<void>((resolve, reject) => {
                if (!this.proc?.stdin) {
                    reject(new Error('Process not available'));
                    return;
                }
                const data = JSON.stringify(request) + '\n';
                const canWrite = this.proc.stdin.write(data);
                if (canWrite) {
                    resolve();
                } else {
                    this.proc.stdin.once('drain', () => resolve());
                    this.proc.stdin.once('error', reject);
                }
            });
        }).catch(err => {
            console.error('[AntigravityRequester] Write request failed:', err);
        });
    }

    private async axiosFallback(url: string, options: RequestOptions): Promise<AntigravityResponse> {
        const axios = (await import('axios')).default;

        try {
            const response = await axios({
                method: (options.method || 'POST') as any,
                url,
                headers: options.headers,
                data: options.body,
                timeout: options.timeout_ms || 30000,
                proxy: options.proxy ? (() => {
                    const proxyUrl = new URL(options.proxy!);
                    return {
                        protocol: proxyUrl.protocol.replace(':', ''),
                        host: proxyUrl.hostname,
                        port: parseInt(proxyUrl.port)
                    };
                })() : false
            });

            return {
                ok: response.status >= 200 && response.status < 300,
                status: response.status,
                statusText: response.statusText,
                headers: new Map(Object.entries(response.headers)),
                text: async () => typeof response.data === 'string' ? response.data : JSON.stringify(response.data),
                json: async () => response.data
            };
        } catch (error: any) {
            return {
                ok: false,
                status: error.response?.status || 0,
                statusText: error.message,
                headers: new Map(),
                text: async () => error.response?.data || error.message,
                json: async () => { throw error; }
            };
        }
    }

    close(): void {
        if (this.proc) {
            this.proc.stdin?.end();
            this.proc = null;
        }
    }

    isUsingFallback(): boolean {
        return this.useAxiosFallback;
    }
}

export const antigravityRequester = new AntigravityRequester();
