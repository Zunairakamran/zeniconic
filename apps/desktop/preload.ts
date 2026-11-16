/**
 * Preload: the only bridge between the sandboxed renderer and the machine.
 *
 * `ipcRenderer` is never exposed. Requests are limited to the contract's
 * channels, and progress is delivered through one narrow subscription with an
 * unsubscribe function.
 */

import { contextBridge, ipcRenderer } from 'electron';
import { isChannel, JOB_PROGRESS_CHANNEL } from '../../packages/ipc/src/contract';
import type { Channel, JobProgressEvent } from '../../packages/ipc/src/contract';

const bridge = {
  invoke(channel: Channel, ...args: unknown[]): Promise<unknown> {
    if (!isChannel(channel)) {
      return Promise.reject(new Error(`Unknown IPC channel "${String(channel)}".`));
    }
    return ipcRenderer.invoke(channel, ...args);
  },

  onJobProgress(listener: (event: JobProgressEvent) => void): () => void {
    if (typeof listener !== 'function') return () => undefined;

    const handler = (_event: unknown, payload: JobProgressEvent): void => {
      listener(payload);
    };

    ipcRenderer.on(JOB_PROGRESS_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(JOB_PROGRESS_CHANNEL, handler);
    };
  },
};

contextBridge.exposeInMainWorld('zeniconic', bridge);
