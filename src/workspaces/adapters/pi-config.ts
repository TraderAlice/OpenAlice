import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readlink,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

import type { WorkspaceAiCred } from '../cli-adapter.js';

export const PI_PROJECT_SETTINGS_PATH = '.pi/settings.json';
export const PI_BINDING_STATE_PATH = '.pi/openalice-provider.json';
export const LEGACY_PI_AGENT_DIR = '.pi-agent';

const PI_PROVIDER_PREFIX = 'openalice-workspace-';
const PI_PROVIDER_NAME_PREFIX = 'OpenAlice workspace provider';
const PI_GLOBAL_MODELS_FILENAME = 'models.json';
const PI_GLOBAL_SETTINGS_FILENAME = 'settings.json';
const PI_GLOBAL_AUTH_FILENAME = 'auth.json';
const PI_GLOBAL_TRUST_FILENAME = 'trust.json';

type EnvLike = Readonly<Record<string, string | undefined>>;

interface SavedSetting {
  readonly present: boolean;
  readonly value?: unknown;
}

interface PiBindingState {
  readonly version: 1;
  readonly providerId: string;
  readonly previous: {
    readonly defaultProvider: SavedSetting;
    readonly defaultModel: SavedSetting;
    readonly shellPath: SavedSetting;
  };
  readonly injected: {
    readonly defaultProvider: SavedSetting;
    readonly defaultModel: SavedSetting;
    readonly shellPath: SavedSetting;
  };
}

let piGlobalWriteQueue: Promise<void> = Promise.resolve();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isENOENT(error: unknown): boolean {
  return isRecord(error) && error['code'] === 'ENOENT';
}

function snapshotSetting(settings: Readonly<Record<string, unknown>>, key: string): SavedSetting {
  return Object.prototype.hasOwnProperty.call(settings, key)
    ? { present: true, value: settings[key] }
    : { present: false };
}

function applySavedSetting(settings: Record<string, unknown>, key: string, saved: SavedSetting): void {
  if (saved.present) settings[key] = saved.value;
  else delete settings[key];
}

function positiveNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export function resolvePiAgentDir(env: EnvLike = process.env): string {
  const configured = env['PI_CODING_AGENT_DIR']?.trim();
  if (configured) return resolve(configured.replace(/^~(?=$|[/\\])/, env['HOME']?.trim() || homedir()));
  return join(resolve(env['HOME']?.trim() || homedir()), '.pi', 'agent');
}

export function piWorkspaceProviderId(cwd: string): string {
  const digest = createHash('sha256').update(resolve(cwd)).digest('hex').slice(0, 16);
  return `${PI_PROVIDER_PREFIX}${digest}`;
}

function providerApi(cred: WorkspaceAiCred): string {
  if (cred.wireShape === 'anthropic') return 'anthropic-messages';
  if (cred.wireShape === 'google-generative-ai') return 'google-generative-ai';
  if (cred.wireShape === 'openai-responses') return 'openai-responses';
  return 'openai-completions';
}

function wireShapeFromApi(api: unknown): NonNullable<WorkspaceAiCred['wireShape']> {
  if (api === 'anthropic-messages') return 'anthropic';
  if (api === 'google-generative-ai') return 'google-generative-ai';
  if (api === 'openai-responses') return 'openai-responses';
  return 'openai-chat';
}

function buildProvider(cwd: string, cred: WorkspaceAiCred): Record<string, unknown> {
  const provider: Record<string, unknown> = {
    name: `${PI_PROVIDER_NAME_PREFIX} (${basename(cwd)})`,
    api: providerApi(cred),
  };
  if (cred.baseUrl) provider['baseUrl'] = cred.baseUrl;
  if (cred.apiKey) {
    if (cred.wireShape === 'anthropic' && cred.authMode === 'bearer') {
      provider['headers'] = { Authorization: `Bearer ${cred.apiKey}` };
    } else {
      provider['apiKey'] = cred.apiKey;
    }
  }
  if (cred.model) {
    const model: Record<string, unknown> = { id: cred.model };
    const contextWindow = positiveNumber(cred.contextWindow);
    if (contextWindow !== null) model['contextWindow'] = contextWindow;
    if (typeof cred.reasoning === 'boolean') model['reasoning'] = cred.reasoning;
    provider['models'] = [model];
  }
  return provider;
}

async function readJsonRecord(path: string, label: string): Promise<Record<string, unknown> | null> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (isENOENT(error)) return null;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`${label} is not valid JSON: ${path}`);
  }
  if (!isRecord(parsed)) throw new Error(`${label} must contain a JSON object: ${path}`);
  return parsed;
}

async function writableTarget(path: string): Promise<string> {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) return await realpath(path);
  } catch (error) {
    if (!isENOENT(error)) throw error;
  }
  return path;
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const target = await writableTarget(path);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const temp = `${target}.openalice-${process.pid}-${randomUUID()}`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(temp, 0o600).catch(() => undefined);
  await rename(temp, target);
}

async function withPiGlobalWrite<T>(operation: () => Promise<T>): Promise<T> {
  let result!: T;
  const run = async (): Promise<void> => {
    result = await operation();
  };
  const queued = piGlobalWriteQueue.then(run, run);
  piGlobalWriteQueue = queued.catch(() => undefined);
  await queued;
  return result;
}

function providersObject(models: Record<string, unknown>, path: string): Record<string, unknown> {
  const existing = models['providers'];
  if (existing === undefined) return {};
  if (!isRecord(existing)) throw new Error(`Pi models.json providers must be an object: ${path}`);
  return { ...existing };
}

async function upsertGlobalProvider(
  agentDir: string,
  providerId: string,
  provider: Record<string, unknown>,
): Promise<void> {
  await withPiGlobalWrite(async () => {
    const path = join(agentDir, PI_GLOBAL_MODELS_FILENAME);
    const models = await readJsonRecord(path, 'Pi models.json') ?? {};
    const providers = providersObject(models, path);
    const existing = providers[providerId];
    if (existing !== undefined) {
      if (!isRecord(existing) || typeof existing['name'] !== 'string' || !existing['name'].startsWith(PI_PROVIDER_NAME_PREFIX)) {
        throw new Error(`Refusing to overwrite non-OpenAlice Pi provider: ${providerId}`);
      }
    }
    providers[providerId] = provider;
    await writeJsonAtomic(path, { ...models, providers });
  });
}

async function removeGlobalProvider(agentDir: string, providerId: string): Promise<void> {
  await withPiGlobalWrite(async () => {
    const path = join(agentDir, PI_GLOBAL_MODELS_FILENAME);
    const models = await readJsonRecord(path, 'Pi models.json');
    if (!models) return;
    const providers = providersObject(models, path);
    const existing = providers[providerId];
    if (!isRecord(existing) || typeof existing['name'] !== 'string' || !existing['name'].startsWith(PI_PROVIDER_NAME_PREFIX)) {
      return;
    }
    delete providers[providerId];
    await writeJsonAtomic(path, { ...models, providers });
  });
}

async function readProjectSettings(cwd: string): Promise<Record<string, unknown>> {
  return await readJsonRecord(join(cwd, PI_PROJECT_SETTINGS_PATH), 'Pi project settings') ?? {};
}

async function readBindingState(cwd: string): Promise<PiBindingState | null> {
  const path = join(cwd, PI_BINDING_STATE_PATH);
  const parsed = await readJsonRecord(path, 'OpenAlice Pi binding state');
  if (!parsed) return null;
  if (
    parsed['version'] !== 1 ||
    typeof parsed['providerId'] !== 'string' ||
    !isRecord(parsed['previous']) ||
    !isRecord(parsed['injected'])
  ) {
    throw new Error(`Unsupported OpenAlice Pi binding state: ${path}`);
  }
  return parsed as unknown as PiBindingState;
}

function injectedSettings(
  providerId: string,
  cred: WorkspaceAiCred,
  shellPath: string | null,
): PiBindingState['injected'] {
  return {
    defaultProvider: { present: true, value: providerId },
    defaultModel: cred.model ? { present: true, value: cred.model } : { present: false },
    shellPath: shellPath ? { present: true, value: shellPath } : { present: false },
  };
}

async function writeProjectBinding(
  cwd: string,
  providerId: string,
  cred: WorkspaceAiCred,
  shellPath: string | null,
): Promise<void> {
  const settings = await readProjectSettings(cwd);
  const existingState = await readBindingState(cwd);
  const previous = existingState?.previous ?? {
    defaultProvider: snapshotSetting(settings, 'defaultProvider'),
    defaultModel: snapshotSetting(settings, 'defaultModel'),
    shellPath: snapshotSetting(settings, 'shellPath'),
  };
  const injected = injectedSettings(providerId, cred, shellPath);
  applySavedSetting(settings, 'defaultProvider', injected.defaultProvider);
  applySavedSetting(settings, 'defaultModel', injected.defaultModel);
  if (shellPath) {
    applySavedSetting(settings, 'shellPath', injected.shellPath);
  } else if (existingState?.injected.shellPath.present) {
    applySavedSetting(settings, 'shellPath', previous.shellPath);
  }
  await writeJsonAtomic(join(cwd, PI_PROJECT_SETTINGS_PATH), settings);
  await writeJsonAtomic(join(cwd, PI_BINDING_STATE_PATH), {
    version: 1,
    providerId,
    previous,
    injected,
  } satisfies PiBindingState);
}

/** Keep the launcher-managed Windows shell in the same reversible project
 * binding as provider/model selection. No binding means no OpenAlice-owned Pi
 * settings to reconcile. */
export async function syncPiWorkspaceShellPath(cwd: string, shellPath: string): Promise<void> {
  const state = await readBindingState(cwd);
  if (!state) return;
  const settings = await readProjectSettings(cwd);
  if (settings['shellPath'] === shellPath && state.injected.shellPath.value === shellPath) return;
  settings['shellPath'] = shellPath;
  await writeJsonAtomic(join(cwd, PI_PROJECT_SETTINGS_PATH), settings);
  await writeJsonAtomic(join(cwd, PI_BINDING_STATE_PATH), {
    ...state,
    injected: {
      ...state.injected,
      shellPath: { present: true, value: shellPath },
    },
  } satisfies PiBindingState);
}

async function resetProjectBinding(cwd: string, agentDir: string): Promise<void> {
  const state = await readBindingState(cwd);
  const providerId = state?.providerId ?? piWorkspaceProviderId(cwd);
  const settings = await readProjectSettings(cwd);
  if (state) {
    applySavedSetting(settings, 'defaultProvider', state.previous.defaultProvider);
    applySavedSetting(settings, 'defaultModel', state.previous.defaultModel);
    if (state.injected.shellPath.present) applySavedSetting(settings, 'shellPath', state.previous.shellPath);
  } else if (settings['defaultProvider'] === providerId) {
    delete settings['defaultProvider'];
    delete settings['defaultModel'];
  }
  const settingsPath = join(cwd, PI_PROJECT_SETTINGS_PATH);
  if (Object.keys(settings).length === 0) await rm(settingsPath, { force: true });
  else await writeJsonAtomic(settingsPath, settings);
  await rm(join(cwd, PI_BINDING_STATE_PATH), { force: true });
  await removeGlobalProvider(agentDir, providerId);
}

export interface PiConfigOptions {
  readonly env?: EnvLike;
  readonly shellPath?: string | null;
}

export async function writePiWorkspaceConfig(
  cwd: string,
  cred: WorkspaceAiCred,
  options: PiConfigOptions = {},
): Promise<void> {
  const env = options.env ?? process.env;
  await migrateLegacyPiAgentDir(cwd, env);
  const agentDir = resolvePiAgentDir(env);
  const hasProvider = Boolean(cred.baseUrl || cred.apiKey || cred.model);
  if (!hasProvider) {
    await resetProjectBinding(cwd, agentDir);
    return;
  }
  const providerId = piWorkspaceProviderId(cwd);
  // Refuse malformed project-owned files before touching the shared global
  // registry. I/O can still fail later, but a known-bad local settings/state
  // file must never leave a newly orphaned provider behind.
  await readProjectSettings(cwd);
  await readBindingState(cwd);
  await upsertGlobalProvider(agentDir, providerId, buildProvider(cwd, cred));
  await writeProjectBinding(cwd, providerId, cred, options.shellPath ?? null);
}

export async function readPiWorkspaceConfig(
  cwd: string,
  options: Pick<PiConfigOptions, 'env'> = {},
): Promise<WorkspaceAiCred | null> {
  const env = options.env ?? process.env;
  await migrateLegacyPiAgentDir(cwd, env);
  const settings = await readProjectSettings(cwd);
  const state = await readBindingState(cwd);
  const providerId = state?.providerId ?? (
    typeof settings['defaultProvider'] === 'string' && settings['defaultProvider'].startsWith(PI_PROVIDER_PREFIX)
      ? settings['defaultProvider']
      : null
  );
  if (!providerId || settings['defaultProvider'] !== providerId) return null;
  const models = await readJsonRecord(join(resolvePiAgentDir(env), PI_GLOBAL_MODELS_FILENAME), 'Pi models.json');
  if (!models) return null;
  const providers = providersObject(models, join(resolvePiAgentDir(env), PI_GLOBAL_MODELS_FILENAME));
  const provider = providers[providerId];
  if (!isRecord(provider)) return null;
  const modelId = typeof settings['defaultModel'] === 'string' ? settings['defaultModel'] : null;
  const modelEntries = Array.isArray(provider['models'])
    ? provider['models'].filter(isRecord)
    : [];
  const modelEntry = modelEntries.find((entry) => entry['id'] === modelId) ?? modelEntries[0];
  const model = typeof modelEntry?.['id'] === 'string' ? modelEntry['id'] : modelId;
  const baseUrl = typeof provider['baseUrl'] === 'string' ? provider['baseUrl'] : null;
  const headers = isRecord(provider['headers']) ? provider['headers'] : {};
  const authorization = typeof headers['Authorization'] === 'string'
    ? headers['Authorization']
    : typeof headers['authorization'] === 'string'
      ? headers['authorization']
      : null;
  const bearerKey = authorization?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
  const apiKey = typeof provider['apiKey'] === 'string' ? provider['apiKey'] : bearerKey;
  const contextWindow = positiveNumber(modelEntry?.['contextWindow'] as number | undefined);
  const reasoning = typeof modelEntry?.['reasoning'] === 'boolean' ? modelEntry['reasoning'] : undefined;
  const wireShape = wireShapeFromApi(provider['api']);
  if (baseUrl === null && apiKey === null && model === null) return null;
  return {
    baseUrl,
    apiKey,
    model,
    wireShape,
    ...(wireShape === 'anthropic' ? { authMode: bearerKey ? 'bearer' as const : 'x-api-key' as const } : {}),
    ...(contextWindow !== null ? { contextWindow } : {}),
    ...(reasoning !== undefined ? { reasoning } : {}),
  };
}

async function mergeJsonMissing(
  sourcePath: string,
  destinationPath: string,
  label: string,
  omit: ReadonlySet<string> = new Set(),
): Promise<void> {
  const source = await readJsonRecord(sourcePath, label);
  if (!source) return;
  const destination = await readJsonRecord(destinationPath, label) ?? {};
  const additions = Object.fromEntries(Object.entries(source).filter(([key]) => !omit.has(key)));
  await writeJsonAtomic(destinationPath, { ...additions, ...destination });
}

async function mergeLegacyModels(
  legacyPath: string,
  agentDir: string,
): Promise<Record<string, unknown> | null> {
  const legacy = await readJsonRecord(legacyPath, 'Legacy Pi models.json');
  if (!legacy) return null;
  const legacyProviders = providersObject(legacy, legacyPath);
  const rawWorkspaceProvider = legacyProviders['workspace'];
  if (rawWorkspaceProvider !== undefined && !isRecord(rawWorkspaceProvider)) {
    throw new Error(`Legacy OpenAlice Pi workspace provider must be an object: ${legacyPath}`);
  }
  const workspaceProvider = rawWorkspaceProvider ?? null;
  delete legacyProviders['workspace'];
  const { providers: _legacyProviderMap, ...legacyTopLevel } = legacy;
  if (Object.keys(legacyProviders).length > 0 || Object.keys(legacyTopLevel).length > 0) {
    await withPiGlobalWrite(async () => {
      const destinationPath = join(agentDir, PI_GLOBAL_MODELS_FILENAME);
      const destination = await readJsonRecord(destinationPath, 'Pi models.json') ?? {};
      const destinationProviders = providersObject(destination, destinationPath);
      await writeJsonAtomic(destinationPath, {
        ...legacyTopLevel,
        ...destination,
        providers: { ...legacyProviders, ...destinationProviders },
      });
    });
  }
  return workspaceProvider;
}

function legacyProviderCred(provider: Record<string, unknown>): WorkspaceAiCred {
  const models = Array.isArray(provider['models']) ? provider['models'].filter(isRecord) : [];
  const modelEntry = models[0];
  const headers = isRecord(provider['headers']) ? provider['headers'] : {};
  const authorization = typeof headers['Authorization'] === 'string'
    ? headers['Authorization']
    : typeof headers['authorization'] === 'string'
      ? headers['authorization']
      : null;
  const bearerKey = authorization?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
  const wireShape = wireShapeFromApi(provider['api']);
  return {
    baseUrl: typeof provider['baseUrl'] === 'string' ? provider['baseUrl'] : null,
    apiKey: typeof provider['apiKey'] === 'string' ? provider['apiKey'] : bearerKey,
    model: typeof modelEntry?.['id'] === 'string' ? modelEntry['id'] : null,
    wireShape,
    ...(wireShape === 'anthropic' ? { authMode: bearerKey ? 'bearer' as const : 'x-api-key' as const } : {}),
    ...(positiveNumber(modelEntry?.['contextWindow'] as number | undefined) !== null
      ? { contextWindow: positiveNumber(modelEntry?.['contextWindow'] as number) }
      : {}),
    ...(typeof modelEntry?.['reasoning'] === 'boolean' ? { reasoning: modelEntry['reasoning'] } : {}),
  };
}

async function mergeDirectoryMissing(source: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true, mode: 0o700 });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) {
      await mergeDirectoryMissing(from, to);
      continue;
    }
    if (existsSync(to)) continue;
    if (entry.isFile()) await copyFile(from, to);
    else if (entry.isSymbolicLink()) await symlink(await readlink(from), to);
  }
}

/**
 * Convert the old redirected agent home into Pi's native global + project
 * layout. Global/user data wins on collisions; the legacy tree is removed only
 * after every known file and directory has been copied or reconciled.
 */
export async function migrateLegacyPiAgentDir(cwd: string, env: EnvLike = process.env): Promise<boolean> {
  const legacyDir = join(cwd, LEGACY_PI_AGENT_DIR);
  if (!existsSync(legacyDir)) return false;
  const agentDir = resolvePiAgentDir(env);
  await mkdir(agentDir, { recursive: true, mode: 0o700 });

  const workspaceProvider = await mergeLegacyModels(join(legacyDir, PI_GLOBAL_MODELS_FILENAME), agentDir);
  await mergeJsonMissing(
    join(legacyDir, PI_GLOBAL_SETTINGS_FILENAME),
    join(agentDir, PI_GLOBAL_SETTINGS_FILENAME),
    'Pi settings.json',
    new Set(['defaultProvider', 'defaultModel', 'shellPath']),
  );
  await mergeJsonMissing(
    join(legacyDir, PI_GLOBAL_AUTH_FILENAME),
    join(agentDir, PI_GLOBAL_AUTH_FILENAME),
    'Pi auth.json',
  );
  await mergeJsonMissing(
    join(legacyDir, PI_GLOBAL_TRUST_FILENAME),
    join(agentDir, PI_GLOBAL_TRUST_FILENAME),
    'Pi trust.json',
  );

  const known = new Set([
    PI_GLOBAL_MODELS_FILENAME,
    PI_GLOBAL_SETTINGS_FILENAME,
    PI_GLOBAL_AUTH_FILENAME,
    PI_GLOBAL_TRUST_FILENAME,
  ]);
  for (const entry of await readdir(legacyDir, { withFileTypes: true })) {
    if (known.has(entry.name)) continue;
    const from = join(legacyDir, entry.name);
    const to = join(agentDir, entry.name);
    if (entry.isDirectory()) await mergeDirectoryMissing(from, to);
    else if (!existsSync(to) && entry.isFile()) await copyFile(from, to);
    else if (!existsSync(to) && entry.isSymbolicLink()) await symlink(await readlink(from), to);
  }

  if (workspaceProvider) {
    const cred = legacyProviderCred(workspaceProvider);
    const providerId = piWorkspaceProviderId(cwd);
    await upsertGlobalProvider(agentDir, providerId, buildProvider(cwd, cred));
    const shellPath = (await readJsonRecord(join(legacyDir, PI_GLOBAL_SETTINGS_FILENAME), 'Legacy Pi settings.json'))?.['shellPath'];
    await writeProjectBinding(cwd, providerId, cred, typeof shellPath === 'string' ? shellPath : null);
  }

  await rm(legacyDir, { recursive: true, force: true });
  return true;
}
