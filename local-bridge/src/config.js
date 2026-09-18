import { randomBytes, randomInt } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_PORT = 1896;

function configDirectory() {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), '.config');
  return path.join(base, 'BJTUCourseAssistant');
}

export function configPath() {
  return path.join(configDirectory(), 'bridge.json');
}

export function normalizePort(value, fallback = DEFAULT_PORT) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : fallback;
}

export async function loadConfig() {
  let stored = {};
  try {
    stored = JSON.parse(await readFile(configPath(), 'utf8'));
  } catch {}
  const config = {
    port: normalizePort(stored?.port),
    token: String(stored?.token || '').trim() || randomBytes(32).toString('base64url')
  };
  await saveConfig(config);
  return config;
}

export async function saveConfig(config) {
  await mkdir(configDirectory(), { recursive: true });
  await writeFile(configPath(), `${JSON.stringify({
    port: normalizePort(config?.port),
    token: String(config?.token || '')
  }, null, 2)}\n`, 'utf8');
}

export function createPairingCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}
