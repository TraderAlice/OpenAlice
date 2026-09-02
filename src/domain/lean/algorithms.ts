import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { getTemplate, listTemplates, type StrategyTemplate, type StrategyTemplateParameter } from "./templates/index.js";

export interface StrategyMetadata {
  id: string;
  name: string;
  description: string;
  templateId?: string;
  parameters: Record<string, string | number | boolean>;
  parameterDefs: StrategyTemplateParameter[];
  filePath: string;
  createdAt: string;
  updatedAt: string;
}

export interface LeanStrategy extends StrategyMetadata {
  code: string;
}

export interface CreateStrategyOptions {
  id?: string;
  name: string;
  description?: string;
  templateId?: string;
  code?: string;
  parameters?: Record<string, string | number | boolean>;
}

export interface UpdateStrategyOptions {
  name?: string;
  description?: string;
  code?: string;
  parameters?: Record<string, string | number | boolean>;
}

/**
 * Extracts parameter definitions and default values from Python strategy code.
 */
export function parseStrategyParameters(code: string): {
  parameters: Record<string, string | number | boolean>;
  parameterDefs: StrategyTemplateParameter[];
} {
  const parameters: Record<string, string | number | boolean> = {};
  const parameterDefs: StrategyTemplateParameter[] = [];
  const seen = new Set<string>();

  // 1. Match self.GetParameter("param_name", default_value)
  const getParamRegex = /(?:self\.)?GetParameter\(\s*["']([^"']+)["']\s*,\s*([^)]+)\)/g;
  let match: RegExpExecArray | null;

  while ((match = getParamRegex.exec(code)) !== null) {
    const name = match[1].trim();
    const rawVal = match[2].trim();

    if (!seen.has(name)) {
      seen.add(name);
      const parsed = parseRawValue(rawVal);
      parameters[name] = parsed.value;
      parameterDefs.push({
        name,
        type: parsed.type,
        defaultValue: parsed.value
      });
    }
  }

  // 2. Parse docstring parameter descriptions: "- param_name: Description (default: X, range: [min, max])"
  const docParamRegex = /-\s*([a-zA-Z0-9_]+)\s*:\s*([^(\n]+)(?:\(([^)]+)\))?/g;
  while ((match = docParamRegex.exec(code)) !== null) {
    const name = match[1].trim();
    const desc = match[2].trim();
    const metaStr = match[3]?.trim();

    let def = parameterDefs.find((p) => p.name === name);
    if (!def) {
      def = {
        name,
        type: "string",
        defaultValue: ""
      };
      parameterDefs.push(def);
      seen.add(name);
    }
    def.description = desc;

    if (metaStr) {
      const defMatch = /default:\s*([^,]+)/i.exec(metaStr);
      if (defMatch) {
        const parsed = parseRawValue(defMatch[1].trim());
        def.defaultValue = parsed.value;
        def.type = parsed.type;
        parameters[name] = parsed.value;
      }
      const rangeMatch = /range:\s*\[\s*([0-9.-]+)\s*,\s*([0-9.-]+)\s*\]/i.exec(metaStr);
      if (rangeMatch) {
        def.min = parseFloat(rangeMatch[1]);
        def.max = parseFloat(rangeMatch[2]);
      }
    }
  }

  return { parameters, parameterDefs };
}

function parseRawValue(raw: string): { value: string | number | boolean; type: "string" | "number" | "boolean" } {
  if (raw === "True" || raw === "true") return { value: true, type: "boolean" };
  if (raw === "False" || raw === "false") return { value: false, type: "boolean" };
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return { value: raw.slice(1, -1), type: "string" };
  }
  const num = Number(raw);
  if (!isNaN(num)) {
    return { value: num, type: "number" };
  }
  return { value: raw, type: "string" };
}

/**
 * Extracts class name and description docstring from Python QCAlgorithm.
 */
export function extractStrategyMetadata(code: string): {
  className?: string;
  description?: string;
} {
  const classMatch = /class\s+([A-Za-z0-9_]+)\s*\(\s*QCAlgorithm\s*\)/.exec(code);
  const className = classMatch ? classMatch[1] : undefined;

  const docMatch = /"""([\s\S]*?)"""/.exec(code);
  let description = "";
  if (docMatch) {
    description = docMatch[1]
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("Parameters:") && !l.startsWith("-"))
      .join(" ");
  }

  return { className, description };
}

export class AlgorithmManager {
  private readonly algorithmsDir: string;
  private readonly templatesDir?: string;

  constructor(algorithmsDir: string, templatesDir?: string) {
    this.algorithmsDir = resolve(algorithmsDir);
    this.templatesDir = templatesDir;
  }

  async ensureDir(): Promise<void> {
    await mkdir(this.algorithmsDir, { recursive: true });
  }

  async listTemplates(): Promise<StrategyTemplate[]> {
    return listTemplates(this.templatesDir);
  }

  async getTemplate(templateId: string): Promise<StrategyTemplate | null> {
    return getTemplate(templateId, this.templatesDir);
  }

  async listStrategies(): Promise<StrategyMetadata[]> {
    await this.ensureDir();
    const files = await readdir(this.algorithmsDir);
    const pyFiles = files.filter((f) => f.endsWith(".py"));
    const strategies: StrategyMetadata[] = [];

    for (const file of pyFiles) {
      const id = file.replace(/\.py$/, "");
      const strategy = await this.getStrategy(id);
      if (strategy) {
        const { code, ...meta } = strategy;
        strategies.push(meta);
      }
    }

    return strategies.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getStrategy(id: string): Promise<LeanStrategy | null> {
    await this.ensureDir();
    const pyPath = join(this.algorithmsDir, `${id}.py`);
    if (!existsSync(pyPath)) return null;

    const code = await readFile(pyPath, "utf8");
    const metaPath = join(this.algorithmsDir, `${id}.meta.json`);

    let metaJson: Partial<StrategyMetadata> = {};
    if (existsSync(metaPath)) {
      try {
        metaJson = JSON.parse(await readFile(metaPath, "utf8"));
      } catch {
        // Fall back to code parsing
      }
    }

    const { parameters, parameterDefs } = parseStrategyParameters(code);
    const codeMeta = extractStrategyMetadata(code);

    const now = new Date().toISOString();
    return {
      id,
      name: metaJson.name || codeMeta.className || id,
      description: metaJson.description || codeMeta.description || "",
      templateId: metaJson.templateId,
      parameters: { ...parameters, ...metaJson.parameters },
      parameterDefs: metaJson.parameterDefs || parameterDefs,
      filePath: pyPath,
      createdAt: metaJson.createdAt || now,
      updatedAt: metaJson.updatedAt || now,
      code
    };
  }

  async createStrategy(options: CreateStrategyOptions): Promise<LeanStrategy> {
    await this.ensureDir();

    let code = options.code ?? "";
    let templateMeta: StrategyTemplate | null = null;

    if (options.templateId) {
      templateMeta = await this.getTemplate(options.templateId);
      if (!code && templateMeta) {
        code = templateMeta.code;
      }
    }

    if (!code) {
      throw new Error(`Strategy code or valid templateId must be provided`);
    }

    const id = options.id || options.name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
    const pyPath = join(this.algorithmsDir, `${id}.py`);
    const metaPath = join(this.algorithmsDir, `${id}.meta.json`);

    const { parameters: extractedParams, parameterDefs: extractedDefs } = parseStrategyParameters(code);
    const codeMeta = extractStrategyMetadata(code);

    const mergedParams = {
      ...(templateMeta?.defaultParameters ?? {}),
      ...extractedParams,
      ...(options.parameters ?? {})
    };

    const mergedDefs = templateMeta?.parameterDefs ?? extractedDefs;

    const now = new Date().toISOString();
    const strategy: LeanStrategy = {
      id,
      name: options.name || codeMeta.className || id,
      description: options.description || templateMeta?.description || codeMeta.description || "",
      templateId: options.templateId,
      parameters: mergedParams,
      parameterDefs: mergedDefs,
      filePath: pyPath,
      createdAt: now,
      updatedAt: now,
      code
    };

    await writeFile(pyPath, code, "utf8");
    const { code: _, ...metaOnly } = strategy;
    await writeFile(metaPath, JSON.stringify(metaOnly, null, 2), "utf8");

    return strategy;
  }

  async updateStrategy(id: string, updates: UpdateStrategyOptions): Promise<LeanStrategy> {
    const existing = await this.getStrategy(id);
    if (!existing) {
      throw new Error(`Strategy '${id}' not found`);
    }

    const pyPath = join(this.algorithmsDir, `${id}.py`);
    const metaPath = join(this.algorithmsDir, `${id}.meta.json`);

    const newCode = updates.code ?? existing.code;
    const { parameters: extractedParams, parameterDefs: extractedDefs } = parseStrategyParameters(newCode);

    const mergedParams = {
      ...existing.parameters,
      ...extractedParams,
      ...(updates.parameters ?? {})
    };

    const now = new Date().toISOString();
    const updated: LeanStrategy = {
      ...existing,
      name: updates.name ?? existing.name,
      description: updates.description ?? existing.description,
      parameters: mergedParams,
      parameterDefs: extractedDefs.length > 0 ? extractedDefs : existing.parameterDefs,
      updatedAt: now,
      code: newCode
    };

    if (updates.code) {
      await writeFile(pyPath, newCode, "utf8");
    }

    const { code: _, ...metaOnly } = updated;
    await writeFile(metaPath, JSON.stringify(metaOnly, null, 2), "utf8");

    return updated;
  }

  async deleteStrategy(id: string): Promise<boolean> {
    await this.ensureDir();
    const pyPath = join(this.algorithmsDir, `${id}.py`);
    const metaPath = join(this.algorithmsDir, `${id}.meta.json`);

    let deleted = false;
    if (existsSync(pyPath)) {
      await unlink(pyPath);
      deleted = true;
    }
    if (existsSync(metaPath)) {
      await unlink(metaPath);
      deleted = true;
    }
    return deleted;
  }
}
