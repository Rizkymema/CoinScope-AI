/**
 * Claude models the dashboard can pick for the trade gate, the scorecard and the copilot chat.
 * Shared by the browser (picker) and the API routes (validation), so it must stay free of
 * server-only imports. Prices are USD per million tokens (input / output).
 */
export interface AiModelOption {
  id: string;
  label: string;
  blurb: string;
  inputPerM: number;
  outputPerM: number;
}

export const AI_MODELS: AiModelOption[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', blurb: 'Recommended. Strong judgement at a mid price.', inputPerM: 4, outputPerM: 20 },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', blurb: 'Faster and half the price of Opus.', inputPerM: 2, outputPerM: 10 },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', blurb: 'Cheapest by far; fine for the gate at high volume.', inputPerM: 0.1, outputPerM: 0.5 },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1', blurb: 'Most capable, 2.5x the Opus price, slower.', inputPerM: 10, outputPerM: 50 },
];

export const DEFAULT_AI_MODEL = 'claude-opus-5-5';

const KNOWN = new Set(AI_MODELS.map((m) => m.id));

/** The requested model when it is one we offer, otherwise the server default. */
export function resolveAiModel(requested: unknown, fallback = DEFAULT_AI_MODEL): string {
  const id = typeof requested === 'string' ? requested.trim() : '';
  return KNOWN.has(id) ? id : fallback;
}

export function aiModelLabel(id: string): string {
  return AI_MODELS.find((m) => m.id === id)?.label || id;
}
