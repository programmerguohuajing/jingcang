declare module '@novnc/novnc' {
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, url: string, options?: Record<string, unknown>);
    scaleViewport: boolean;
    resizeSession: boolean;
    focusOnClick: boolean;
    background: string;
    disconnect(): void;
    sendKey(keysym: number, code: string, down?: boolean): void;
  }
}

