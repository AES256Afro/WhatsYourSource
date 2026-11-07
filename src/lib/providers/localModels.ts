/**
 * What a local server can tell us about its models beyond the OpenAI-style `/models` list: whether a
 * model can see images, call tools, how much context it has, and whether it is loaded. Best effort
 * per server; anything unknown stays `undefined` and the UI treats it as "not sure".
 */
export interface LocalModelInfo {
  id: string;
  vision?: boolean;
  tools?: boolean;
  loaded?: boolean;
  contextLength?: number;
}

export type LocalServerKind = 'lmstudio' | 'ollama' | 'other';

export function serverKind(baseUrl: string): LocalServerKind {
  if (/:1234(\/|$)/.test(baseUrl)) return 'lmstudio';
  if (/:11434(\/|$)/.test(baseUrl)) return 'ollama';
  return 'other';
}

/** The server root: `http://localhost:11434/v1` → `http://localhost:11434`. */
export function serverRoot(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
}

const VISION_NAME = /vision|-vl\b|vl-|llava|minicpm-v|pixtral|moondream|gemma-?3|qwen.*vl|clip/i;

/** Name-based guess when the server gives no capability data. */
export function guessVisionFromName(id: string): boolean | undefined {
  return VISION_NAME.test(id) ? true : undefined;
}

interface LmStudioModel {
  id?: string;
  type?: string; // 'llm' | 'vlm' | 'embeddings'
  state?: string; // 'loaded' | 'not-loaded'
  max_context_length?: number;
  capabilities?: string[];
}

export function parseLmStudio(json: unknown): LocalModelInfo[] {
  const data = (json as { data?: LmStudioModel[] } | null)?.data ?? [];
  return data
    .filter((m) => m.id && m.type !== 'embeddings')
    .map((m) => ({
      id: m.id!,
      vision: m.type === 'vlm' ? true : m.type === 'llm' ? false : undefined,
      tools: Array.isArray(m.capabilities) ? m.capabilities.includes('tool_use') : undefined,
      loaded: m.state ? m.state === 'loaded' : undefined,
      contextLength: typeof m.max_context_length === 'number' ? m.max_context_length : undefined,
    }));
}

interface OllamaTag {
  name?: string;
  details?: { families?: string[] };
}

export function parseOllamaTags(json: unknown): LocalModelInfo[] {
  const models = (json as { models?: OllamaTag[] } | null)?.models ?? [];
  return models
    .filter((m) => m.name)
    .map((m) => ({
      id: m.name!,
      // A second "family" such as clip/mllama/qwen2vl means a vision projector ships with the model.
      vision: Array.isArray(m.details?.families) && m.details.families.length > 1 ? true : guessVisionFromName(m.name!),
    }));
}

export function parseOllamaShow(json: unknown): Pick<LocalModelInfo, 'vision' | 'tools' | 'contextLength'> {
  const o = json as { capabilities?: string[]; model_info?: Record<string, unknown> } | null;
  const caps = Array.isArray(o?.capabilities) ? o.capabilities : undefined;
  const ctxKey = o?.model_info ? Object.keys(o.model_info).find((k) => k.endsWith('.context_length')) : undefined;
  const ctx = ctxKey ? o!.model_info![ctxKey] : undefined;
  return {
    vision: caps ? caps.includes('vision') : undefined,
    tools: caps ? caps.includes('tools') : undefined,
    contextLength: typeof ctx === 'number' ? ctx : undefined,
  };
}

/** Ask the server about its models. Falls back to the OpenAI-style list the caller already has. */
export async function describeLocalModels(baseUrl: string, fallbackIds: string[], signal?: AbortSignal): Promise<LocalModelInfo[]> {
  const root = serverRoot(baseUrl);
  const kind = serverKind(baseUrl);
  try {
    if (kind === 'lmstudio') {
      const res = await fetch(`${root}/api/v0/models`, { signal });
      if (res.ok) return parseLmStudio(await res.json());
    }
    if (kind === 'ollama') {
      const res = await fetch(`${root}/api/tags`, { signal });
      if (res.ok) {
        const list = parseOllamaTags(await res.json());
        // `show` gives definite capabilities; ask for the first few only (one request per model).
        await Promise.all(
          list.slice(0, 12).map(async (m) => {
            try {
              const r = await fetch(`${root}/api/show`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: m.id }),
                signal,
              });
              if (r.ok) Object.assign(m, parseOllamaShow(await r.json()));
            } catch {
              /* keep the guess */
            }
          }),
        );
        return list;
      }
    }
  } catch {
    /* fall through to the plain list */
  }
  return fallbackIds.map((id) => ({ id, vision: guessVisionFromName(id) }));
}
