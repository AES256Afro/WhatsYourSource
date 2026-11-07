import { describe, expect, it } from 'vitest';
import { guessVisionFromName, parseLmStudio, parseOllamaShow, parseOllamaTags, serverKind, serverRoot } from '@/lib/providers/localModels';
import { parseClaims, buildClaimsRequest } from '@/lib/pipeline/claims';
import { readPublicSettings, publicTriggerTarget } from '@/lib/storage/publicSettings';
import { googleAiModeUrl } from '@/lib/googleAiMode';
import { presetFor } from '@/lib/providers/registry';

describe('local model capability detection', () => {
  it('recognises LM Studio and Ollama servers by port', () => {
    expect(serverKind('http://localhost:1234/v1')).toBe('lmstudio');
    expect(serverKind('http://127.0.0.1:11434/v1')).toBe('ollama');
    expect(serverKind('http://localhost:8080/v1')).toBe('other');
    expect(serverRoot('http://localhost:11434/v1/')).toBe('http://localhost:11434');
  });
  it('reads LM Studio model types and states', () => {
    const list = parseLmStudio({
      data: [
        { id: 'qwen-vl', type: 'vlm', state: 'loaded', max_context_length: 32768, capabilities: ['tool_use'] },
        { id: 'embed', type: 'embeddings' },
        { id: 'text', type: 'llm', state: 'not-loaded' },
      ],
    });
    expect(list).toEqual([
      { id: 'qwen-vl', vision: true, tools: true, loaded: true, contextLength: 32768 },
      { id: 'text', vision: false, tools: undefined, loaded: false, contextLength: undefined },
    ]);
  });
  it('reads Ollama tags and show output', () => {
    const list = parseOllamaTags({
      models: [{ name: 'llava:7b', details: { families: ['llama', 'clip'] } }, { name: 'qwen3:8b', details: { families: ['qwen3'] } }, { name: 'gemma-3-4b' }],
    });
    expect(list.map((m) => m.vision)).toEqual([true, undefined, true]);
    expect(parseOllamaShow({ capabilities: ['completion', 'tools'], model_info: { 'qwen3.context_length': 40960 } })).toEqual({
      vision: false,
      tools: true,
      contextLength: 40960,
    });
    expect(guessVisionFromName('llama3.2-vision')).toBe(true);
    expect(guessVisionFromName('mistral')).toBeUndefined();
  });
  it('knows which presets honour JSON mode', () => {
    expect(presetFor('https://api.openai.com/v1')?.jsonMode).toBe(true);
    expect(presetFor('http://localhost:11434/v1')?.jsonMode).toBe(false);
    expect(presetFor('https://openrouter.ai/api/v1/x')?.id).toBe('openrouter');
  });
});

describe('claim extraction', () => {
  it('parses the fenced list and drops junk', () => {
    expect(parseClaims('Here you go:\n```json\n{"claims":["Einstein said it", 7, "", "The line dates to 1981"]}\n```')).toEqual([
      'Einstein said it',
      'The line dates to 1981',
    ]);
    expect(parseClaims('no json here')).toEqual([]);
  });
  it('asks a plain, tool-less question with the content as data', () => {
    const req = buildClaimsRequest({ kind: 'text', text: 'claim text', pageUrl: 'https://p', pageTitle: 't' });
    expect(req.plain).toBe(true);
    expect(req.wantSearch).toBe(false);
    expect(req.parts.map((p) => ('text' in p ? p.text : '')).join()).toContain('<untrusted_content kind="selection"');
  });
});

describe('public settings for the content script', () => {
  it('reads only what it needs and falls back per field', () => {
    const p = readPublicSettings({ privacy: { chip: false, disabledSites: ['a.com', 3] }, shortcutAction: 'nope', defaultProvider: 'webmode' });
    expect(p).toEqual({ chip: false, disabledSites: ['a.com'], shortcutAction: 'panel', defaultProvider: 'webmode' });
    expect(publicTriggerTarget(p)).toBe('webmode');
    expect(readPublicSettings('garbage').chip).toBe(true);
  });
});

describe('Google web variants', () => {
  it('builds AI Mode or a plain search with its AI Overview', () => {
    const input = { kind: 'text' as const, text: 'hello', pageUrl: '', pageTitle: '' };
    expect(googleAiModeUrl(input, 'ai-mode')).toContain('udm=50&');
    expect(googleAiModeUrl(input, 'overview')).not.toContain('udm=50');
    expect(googleAiModeUrl(input)).toContain('udm=50');
  });
});
