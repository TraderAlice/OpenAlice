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
import { isModelReasoningEffort } from '../../ai-providers/model-semantics.js';

export const PI_PROJECT_SETTINGS_PATH = '.pi/settings.json';
export const PI_BINDING_STATE_PATH = '.pi/openalice-provider.json';
export const PI_PROVIDER_EXTENSION_PATH = '.pi/extensions/openalice-provider.ts';
export const LEGACY_PI_AGENT_DIR = '.pi-agent';
export const PI_AUTOMATIC_THEME_PAIR = 'light/dark';

export const PI_PROVIDER_PREFIX = 'openalice-workspace-';
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
  readonly version: 1 | 2;
  readonly providerId: string;
  /** Version 2 keeps the custom provider entirely inside this Workspace. */
  readonly provider?: Readonly<Record<string, unknown>>;
  /** Digest of the OpenAlice-owned extension file for conflict-aware upgrades/reset. */
  readonly extensionSha256?: string;
  readonly previous: {
    readonly defaultProvider: SavedSetting;
    readonly defaultModel: SavedSetting;
    readonly shellPath: SavedSetting;
    /** Optional for backward compatibility with version-1 state written before effort ownership. */
    readonly defaultThinkingLevel?: SavedSetting;
  };
  readonly injected: {
    readonly defaultProvider: SavedSetting;
    readonly defaultModel: SavedSetting;
    readonly shellPath: SavedSetting;
    readonly defaultThinkingLevel?: SavedSetting;
  };
}

let piGlobalWriteQueue: Promise<void> = Promise.resolve();

const PI_PROVIDER_EXTENSION_SOURCE = `// OpenAlice-managed Pi provider extension. Changes may be replaced by Workspace AI settings.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export default function openAliceWorkspaceProvider(pi: {
  registerProvider(providerId: string, provider: Record<string, unknown>): void
}): void {
  const statePath = join(process.cwd(), '.pi', 'openalice-provider.json')
  const state = JSON.parse(readFileSync(statePath, 'utf8')) as Record<string, unknown>
  if (state['version'] !== 2) return
  const providerId = state['providerId']
  const provider = state['provider']
  if (typeof providerId !== 'string' || !provider || typeof provider !== 'object' || Array.isArray(provider)) {
    throw new Error(\`Invalid OpenAlice Pi provider state: \${statePath}\`)
  }
  // Pi's models.json loader supplies compatibility defaults, while the
  // extension API deliberately requires complete model objects. Keep the
  // durable sidecar limited to facts OpenAlice actually knows, then project
  // the same Pi defaults only at registration time.
  const models = Array.isArray((provider as Record<string, unknown>)['models'])
    ? (provider as Record<string, unknown>)['models'] as Array<Record<string, unknown>>
    : undefined
  const registeredProvider = models
    ? {
        ...(provider as Record<string, unknown>),
        models: models.map((model) => ({
          name: model['id'],
          reasoning: false,
          input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
          maxTokens: 16384,
          ...model,
        })),
      }
    : provider as Record<string, unknown>
  pi.registerProvider(providerId, registeredProvider)
}
`;

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

function sameSavedSetting(left: SavedSetting, right: SavedSetting): boolean {
  if (left.present !== right.present) return false;
  if (!left.present) return true;
  return JSON.stringify(left.value) === JSON.stringify(right.value);
}

function positiveNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function piThinkingLevel(effort: NonNullable<WorkspaceAiCred['reasoningEffort']>): string {
  return effort === 'none' ? 'off' : effort;
}

function reasoningEffortFromPi(value: unknown): WorkspaceAiCred['reasoningEffort'] {
  if (value === 'off') return 'none';
  return isModelReasoningEffort(value) ? value : undefined;
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

export function buildPiProvider(cwd: string, cred: WorkspaceAiCred): Record<string, unknown> {
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

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isENOENT(error)) return null;
    throw error;
  }
}

async function assertProviderExtensionWritable(
  cwd: string,
  state: PiBindingState | null,
): Promise<void> {
  const path = join(cwd, PI_PROVIDER_EXTENSION_PATH);
  const existing = await readText(path);
  if (existing === null || existing === PI_PROVIDER_EXTENSION_SOURCE) return;
  if (
    state?.version === 2 &&
    typeof state.extensionSha256 === 'string' &&
    sha256(existing) === state.extensionSha256
  ) return;
  throw new Error(`Refusing to overwrite user-edited Pi extension: ${path}`);
}

async function writeProviderExtension(cwd: string): Promise<void> {
  const path = join(cwd, PI_PROVIDER_EXTENSION_PATH);
  const target = await writableTarget(path);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const temp = `${target}.openalice-${process.pid}-${randomUUID()}`;
  await writeFile(temp, PI_PROVIDER_EXTENSION_SOURCE, { encoding: 'utf8', mode: 0o600 });
  await chmod(temp, 0o600).catch(() => undefined);
  await rename(temp, target);
}

async function ensureProviderExtension(cwd: string, state: PiBindingState | null): Promise<void> {
  await assertProviderExtensionWritable(cwd, state);
  if (await readText(join(cwd, PI_PROVIDER_EXTENSION_PATH)) === PI_PROVIDER_EXTENSION_SOURCE) return;
  await writeProviderExtension(cwd);
}

/** Return true when it is safe to remove the managed sidecar as well. A
 * user-edited extension becomes user-owned and may still depend on that state. */
async function removeProviderExtension(cwd: string, state: PiBindingState | null): Promise<boolean> {
  const path = join(cwd, PI_PROVIDER_EXTENSION_PATH);
  const existing = await readText(path);
  if (existing === null) return true;
  const injectedDigest = state?.version === 2 ? state.extensionSha256 : undefined;
  if (
    existing === PI_PROVIDER_EXTENSION_SOURCE ||
    (typeof injectedDigest === 'string' && sha256(existing) === injectedDigest)
  ) {
    await rm(path, { force: true });
    return true;
  }
  return false;
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

async function removeGlobalProvider(agentDir: string, providerId: string): Promise<boolean> {
  try {
    return await withPiGlobalWrite(async () => {
      const path = join(agentDir, PI_GLOBAL_MODELS_FILENAME);
      const models = await readJsonRecord(path, 'Pi models.json');
      if (!models) return false;
      const providers = providersObject(models, path);
      const existing = providers[providerId];
      if (!isRecord(existing) || typeof existing['name'] !== 'string' || !existing['name'].startsWith(PI_PROVIDER_NAME_PREFIX)) {
        return false;
      }
      delete providers[providerId];
      await writeJsonAtomic(path, { ...models, providers });
      return true;
    });
  } catch {
    // Global models.json is Pi/user-owned. A malformed or concurrently edited
    // file must never block a complete Workspace-local binding; leave it for
    // the user to repair instead of overwriting it.
    return false;
  }
}

/** Remove stale OpenAlice-owned global provider nodes after every known
 * Workspace has either localized successfully or been added to keepProviderIds. */
export async function cleanupGlobalPiWorkspaceProviders(
  keepProviderIds: ReadonlySet<string>,
  env: EnvLike = process.env,
): Promise<number> {
  return withPiGlobalWrite(async () => {
    const path = join(resolvePiAgentDir(env), PI_GLOBAL_MODELS_FILENAME);
    const models = await readJsonRecord(path, 'Pi models.json');
    if (!models) return 0;
    const providers = providersObject(models, path);
    let removed = 0;
    for (const [providerId, provider] of Object.entries(providers)) {
      if (
        keepProviderIds.has(providerId) ||
        !providerId.startsWith(PI_PROVIDER_PREFIX) ||
        !isRecord(provider) ||
        typeof provider['name'] !== 'string' ||
        !provider['name'].startsWith(PI_PROVIDER_NAME_PREFIX)
      ) continue;
      delete providers[providerId];
      removed += 1;
    }
    if (removed > 0) await writeJsonAtomic(path, { ...models, providers });
    return removed;
  });
}

async function readProjectSettings(cwd: string): Promise<Record<string, unknown>> {
  return await readJsonRecord(join(cwd, PI_PROJECT_SETTINGS_PATH), 'Pi project settings') ?? {};
}

/**
 * Give OpenAlice-managed Pi Workspaces the same boundary Orca expects: Pi
 * remains the owner of its TUI colors, while the terminal reports light/dark
 * through OSC/DSR and mode 2031. A project choice wins over this default,
 * including a choice the user later makes from Pi's own settings UI.
 */
export async function syncPiWorkspaceTheme(cwd: string): Promise<boolean> {
  const settings = await readProjectSettings(cwd);
  if (Object.prototype.hasOwnProperty.call(settings, 'theme')) return false;
  settings['theme'] = PI_AUTOMATIC_THEME_PAIR;
  await writeJsonAtomic(join(cwd, PI_PROJECT_SETTINGS_PATH), settings);
  return true;
}

async function readBindingState(cwd: string): Promise<PiBindingState | null> {
  const path = join(cwd, PI_BINDING_STATE_PATH);
  const parsed = await readJsonRecord(path, 'OpenAlice Pi binding state');
  if (!parsed) return null;
  if (
    (parsed['version'] !== 1 && parsed['version'] !== 2) ||
    typeof parsed['providerId'] !== 'string' ||
    !isRecord(parsed['previous']) ||
    !isRecord(parsed['injected']) ||
    (parsed['version'] === 2 && (!isRecord(parsed['provider']) || typeof parsed['extensionSha256'] !== 'string'))
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
    defaultThinkingLevel: cred.reasoningEffort
      ? { present: true, value: piThinkingLevel(cred.reasoningEffort) }
      : { present: false },
  };
}

async function writeProjectBinding(
  cwd: string,
  providerId: string,
  provider: Readonly<Record<string, unknown>>,
  cred: WorkspaceAiCred,
  shellPath: string | null,
): Promise<void> {
  const settings = await readProjectSettings(cwd);
  const existingState = await readBindingState(cwd);
  const previous = {
    defaultProvider: existingState?.previous.defaultProvider ?? snapshotSetting(settings, 'defaultProvider'),
    defaultModel: existingState?.previous.defaultModel ?? snapshotSetting(settings, 'defaultModel'),
    shellPath: existingState?.previous.shellPath ?? snapshotSetting(settings, 'shellPath'),
    defaultThinkingLevel: existingState?.previous.defaultThinkingLevel
      ?? snapshotSetting(settings, 'defaultThinkingLevel'),
  };
  const injected = injectedSettings(providerId, cred, shellPath);
  applySavedSetting(settings, 'defaultProvider', injected.defaultProvider);
  applySavedSetting(settings, 'defaultModel', injected.defaultModel);
  if (shellPath) {
    applySavedSetting(settings, 'shellPath', injected.shellPath);
  } else if (existingState?.injected.shellPath.present) {
    applySavedSetting(settings, 'shellPath', previous.shellPath);
  }
  if (cred.reasoningEffort) {
    applySavedSetting(settings, 'defaultThinkingLevel', injected.defaultThinkingLevel!);
  } else if (existingState?.injected.defaultThinkingLevel?.present) {
    applySavedSetting(settings, 'defaultThinkingLevel', previous.defaultThinkingLevel);
  }
  // The generic extension safely no-ops until the version-2 state exists. Put
  // it in place first, then publish provider state, and activate the project
  // selection last. A concurrent Pi launch therefore sees either the old
  // complete binding or the new complete binding, never a selected orphan.
  await ensureProviderExtension(cwd, existingState);
  await writeJsonAtomic(join(cwd, PI_BINDING_STATE_PATH), {
    version: 2,
    providerId,
    provider,
    extensionSha256: sha256(PI_PROVIDER_EXTENSION_SOURCE),
    previous,
    injected,
  } satisfies PiBindingState);
  await writeJsonAtomic(join(cwd, PI_PROJECT_SETTINGS_PATH), settings);
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
    if (sameSavedSetting(snapshotSetting(settings, 'defaultProvider'), state.injected.defaultProvider)) {
      applySavedSetting(settings, 'defaultProvider', state.previous.defaultProvider);
    }
    if (sameSavedSetting(snapshotSetting(settings, 'defaultModel'), state.injected.defaultModel)) {
      applySavedSetting(settings, 'defaultModel', state.previous.defaultModel);
    }
    if (
      state.injected.shellPath.present &&
      sameSavedSetting(snapshotSetting(settings, 'shellPath'), state.injected.shellPath)
    ) {
      applySavedSetting(settings, 'shellPath', state.previous.shellPath);
    }
    if (
      state.injected.defaultThinkingLevel?.present &&
      sameSavedSetting(
        snapshotSetting(settings, 'defaultThinkingLevel'),
        state.injected.defaultThinkingLevel,
      )
    ) {
      applySavedSetting(
        settings,
        'defaultThinkingLevel',
        state.previous.defaultThinkingLevel ?? { present: false },
      );
    }
  } else if (settings['defaultProvider'] === providerId) {
    delete settings['defaultProvider'];
    delete settings['defaultModel'];
  }
  const settingsPath = join(cwd, PI_PROJECT_SETTINGS_PATH);
  if (Object.keys(settings).length === 0) await rm(settingsPath, { force: true });
  else await writeJsonAtomic(settingsPath, settings);
  const canRemoveBindingState = await removeProviderExtension(cwd, state);
  if (canRemoveBindingState) await rm(join(cwd, PI_BINDING_STATE_PATH), { force: true });
  await removeGlobalProvider(agentDir, providerId);
}

function providerForProjectSelection(
  provider: Readonly<Record<string, unknown>>,
  selectedModel: unknown,
): Readonly<Record<string, unknown>> {
  if (typeof selectedModel !== 'string' || selectedModel.length === 0) return provider;
  const models = Array.isArray(provider['models']) ? provider['models'].filter(isRecord) : [];
  const selected = models.find((model) => model['id'] === selectedModel);
  if (selected) return provider;
  // Older cross-process global writes could tear provider registration away
  // from the project selection. The project file is the durable Workspace
  // intent, so recover that model id without borrowing stale model semantics.
  return { ...provider, models: [{ id: selectedModel }] };
}

/**
 * Upgrade one namespaced global Pi provider into the Workspace-local extension
 * contract. Version-2 bindings are also reconciled here so a deleted managed
 * extension is restored before launch. The global node is removed only after
 * the local extension and state are complete.
 */
export async function localizePiWorkspaceProvider(
  cwd: string,
  env: EnvLike = process.env,
): Promise<boolean> {
  const settings = await readProjectSettings(cwd);
  const state = await readBindingState(cwd);
  const providerId = state?.providerId ?? (
    typeof settings['defaultProvider'] === 'string' && settings['defaultProvider'].startsWith(PI_PROVIDER_PREFIX)
      ? settings['defaultProvider']
      : null
  );
  if (!providerId || settings['defaultProvider'] !== providerId) return false;

  if (state?.version === 2 && state.provider) {
    await ensureProviderExtension(cwd, state);
    await removeGlobalProvider(resolvePiAgentDir(env), providerId);
    return false;
  }

  const modelsPath = join(resolvePiAgentDir(env), PI_GLOBAL_MODELS_FILENAME);
  const models = await readJsonRecord(modelsPath, 'Pi models.json');
  if (!models) return false;
  const provider = providersObject(models, modelsPath)[providerId];
  if (!isRecord(provider)) return false;
  const localProvider = providerForProjectSelection(provider, settings['defaultModel']);
  await ensureProviderExtension(cwd, state);
  const previous = state?.previous ?? {
    defaultProvider: { present: false },
    defaultModel: { present: false },
    shellPath: { present: false },
    defaultThinkingLevel: { present: false },
  };
  const injected = state?.injected ?? {
    defaultProvider: snapshotSetting(settings, 'defaultProvider'),
    defaultModel: snapshotSetting(settings, 'defaultModel'),
    shellPath: { present: false },
    defaultThinkingLevel: { present: false },
  };
  await writeJsonAtomic(join(cwd, PI_BINDING_STATE_PATH), {
    version: 2,
    providerId,
    provider: localProvider,
    extensionSha256: sha256(PI_PROVIDER_EXTENSION_SOURCE),
    previous,
    injected,
  } satisfies PiBindingState);
  await removeGlobalProvider(resolvePiAgentDir(env), providerId);
  return true;
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
  await writeProjectBinding(
    cwd,
    providerId,
    buildPiProvider(cwd, cred),
    cred,
    options.shellPath ?? null,
  );
  // Clean up an earlier global binding only after the local projection is
  // active. Failure is deliberately non-fatal because that file is Pi-owned.
  await removeGlobalProvider(agentDir, providerId);
}

export async function readPiWorkspaceConfig(
  cwd: string,
  options: Pick<PiConfigOptions, 'env'> = {},
): Promise<WorkspaceAiCred | null> {
  const env = options.env ?? process.env;
  await migrateLegacyPiAgentDir(cwd, env);
  await localizePiWorkspaceProvider(cwd, env);
  const settings = await readProjectSettings(cwd);
  const state = await readBindingState(cwd);
  const providerId = state?.providerId ?? (
    typeof settings['defaultProvider'] === 'string' && settings['defaultProvider'].startsWith(PI_PROVIDER_PREFIX)
      ? settings['defaultProvider']
      : null
  );
  if (!providerId || settings['defaultProvider'] !== providerId) return null;
  let provider: unknown = state?.version === 2 ? state.provider : undefined;
  if (!isRecord(provider)) {
    const modelsPath = join(resolvePiAgentDir(env), PI_GLOBAL_MODELS_FILENAME);
    const models = await readJsonRecord(modelsPath, 'Pi models.json');
    if (!models) return null;
    provider = providersObject(models, modelsPath)[providerId];
  }
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
  const reasoningEffort = reasoningEffortFromPi(settings['defaultThinkingLevel']);
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
    ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
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
    new Set(['defaultProvider', 'defaultModel', 'shellPath', 'defaultThinkingLevel']),
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
    const shellPath = (await readJsonRecord(join(legacyDir, PI_GLOBAL_SETTINGS_FILENAME), 'Legacy Pi settings.json'))?.['shellPath'];
    const provider = buildPiProvider(cwd, cred);
    await writeProjectBinding(
      cwd,
      providerId,
      provider,
      cred,
      typeof shellPath === 'string' ? shellPath : null,
    );
  }

  await rm(legacyDir, { recursive: true, force: true });
  return true;
}
