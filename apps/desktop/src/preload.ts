// Runs in the window before the web app, with access to Electron's IPC only.
// It exposes exactly the calls in bridge.ts, nothing else of Node or Electron.
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { CALLS, errorMessage, type Bridge, type Reply, type UpdateStatus } from './bridge';

const api: Record<string, unknown> = {};
for (const name of CALLS) {
  api[name] = async (...args: unknown[]) => {
    const r = (await ipcRenderer.invoke(`tw:${name}`, ...args)) as Reply<unknown>;
    // contextBridge passes only an error's message to the page, so the code travels inside it (see errorMessage).
    if (!r.ok) throw new Error(errorMessage(r.code, r.message));
    return r.value;
  };
}

const bridge: Bridge = {
  ...(api as unknown as Omit<Bridge, 'pathForFile' | 'onChange' | 'onCommand' | 'onUpdate'>),
  pathForFile: (file) => webUtils.getPathForFile(file),
  onUpdate(fn) {
    const listener = (_e: unknown, status: UpdateStatus) => fn(status);
    ipcRenderer.on('tw:update', listener);
    return () => ipcRenderer.removeListener('tw:update', listener);
  },
  onChange(fn) {
    const listener = (_e: unknown, paths: string[]) => fn(paths);
    ipcRenderer.on('tw:changed', listener);
    return () => ipcRenderer.removeListener('tw:changed', listener);
  },
  onCommand(fn) {
    const listener = (_e: unknown, command: string) => fn(command);
    ipcRenderer.on('tw:command', listener);
    return () => ipcRenderer.removeListener('tw:command', listener);
  },
};

contextBridge.exposeInMainWorld('thoughtwell', bridge);
