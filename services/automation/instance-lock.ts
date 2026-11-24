import { createHash } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { hostname } from 'node:os';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import type { AutomationInstance } from './types.ts';

type LockData = AutomationInstance & { rootKey?: string };

function readLock(file: string): LockData | undefined {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8')) as Partial<LockData> | null;
    if (
      !data ||
      !Number.isSafeInteger(data.pid) ||
      data.pid! <= 0 ||
      !Number.isInteger(data.port) ||
      data.port! < 0 ||
      data.port! > 65535 ||
      (data.mode !== 'development' && data.mode !== 'production') ||
      typeof data.hostname !== 'string' ||
      !data.hostname ||
      typeof data.startedAt !== 'string' ||
      !Number.isFinite(Date.parse(data.startedAt)) ||
      (data.rootKey !== undefined && (typeof data.rootKey !== 'string' || !/^[0-9a-f]{64}$/u.test(data.rootKey)))
    ) {
      throw new Error('invalid lock');
    }
    return data as LockData;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error('RUNTIME_LOCK_UNREADABLE：无法确认数据目录的实例锁，原文件已保留。', { cause: error });
  }
}

function isLive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    // Permission errors and unknown process-query failures cannot establish a dead owner.
    return true;
  }
}

function inUse(owner?: LockData) {
  return new Error(
    `RUNTIME_INSTANCE_IN_USE：该数据目录已被工作台使用${owner ? `（PID ${owner.pid}，端口 ${owner.port}，${owner.mode}）` : ''}。`,
  );
}

export async function acquireInstanceLock(root: string, port: number, mode: AutomationInstance['mode']) {
  mkdirSync(root, { recursive: true });
  const canonical = realpathSync.native(root);
  const rootKey = createHash('sha256')
    .update(process.platform === 'win32' ? canonical.toLowerCase() : canonical)
    .digest('hex');
  const dir = path.join(canonical, 'state', 'runtime');
  const file = path.join(dir, 'instance.lock');
  mkdirSync(dir, { recursive: true });

  // Two starters could otherwise both read a stale PID and unlink each other's replacement.
  // This per-root OS handle disappears on crash, so only the on-disk owner record needs repair.
  const gateName = `fmcg-instance-${rootKey}`;
  const address = process.platform === 'win32' ? `\\\\.\\pipe\\${gateName}` : `\0${gateName}`;
  const gate = createServer((socket) => socket.destroy());
  try {
    await new Promise<void>((resolve, reject) => {
      gate.once('error', reject);
      gate.listen(address, resolve);
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
    // A concurrent owner may still be writing the diagnostic record after listening on the gate.
    for (let attempt = 0; attempt < 10; attempt++) {
      let owner: LockData | undefined;
      try {
        owner = readLock(file);
      } catch {
        /* record may be getting written by the gate owner */
      }
      if (owner && isLive(owner.pid)) throw inUse(owner);
      await wait(20);
    }
    throw inUse();
  }
  gate.unref();

  const instance: AutomationInstance = {
    pid: process.pid,
    port,
    mode,
    startedAt: new Date().toISOString(),
    hostname: hostname(),
  };
  const payload = `${JSON.stringify({ ...instance, rootKey }, null, 2)}\n`;
  const isCurrent = () => {
    try {
      return readFileSync(file, 'utf8') === payload;
    } catch {
      return false;
    }
  };
  const releaseMetadata = () => {
    if (isCurrent()) rmSync(file, { force: true });
  };
  try {
    const previous = readLock(file);
    if (previous) {
      const copied = previous.rootKey !== undefined && previous.rootKey !== rootKey;
      if (!copied && (previous.hostname !== instance.hostname || isLive(previous.pid))) throw inUse(previous);
      console.warn(copied ? '已取代备份中复制到新数据目录的实例锁。' : `已接管退出进程 PID ${previous.pid} 的实例锁。`);
      rmSync(file);
    }
    const fd = openSync(file, 'wx');
    try {
      writeFileSync(fd, payload, 'utf8');
    } catch (error) {
      rmSync(file, { force: true });
      throw error;
    } finally {
      closeSync(fd);
    }
  } catch (error) {
    gate.close();
    throw error;
  }
  return {
    instance,
    isCurrent,
    releaseMetadata,
    close() {
      try {
        releaseMetadata();
      } finally {
        gate.close();
      }
    },
  };
}
