import { GoogleGenAI } from '@google/genai';
import { geminiConfig } from '../config.js';
import { withRetries, isRetryableStatus } from '../utils/errors.js';

let cachedClient = null;

function getClient() {
  if (!cachedClient) {
    const config = geminiConfig();
    cachedClient = new GoogleGenAI({ apiKey: config.apiKey });
  }
  return cachedClient;
}

function modelName() {
  return geminiConfig().model;
}

const RETRYABLE_AI = (err) => isRetryableStatus(err?.status) || err?.status === undefined && err?.retryable === true;

export async function generateText({ system, prompt }) {
  const ai = getClient();
  const res = await withRetries(
    async () => {
      try {
        return await ai.models.generateContent({
          model: modelName(),
          contents: prompt,
          config: {
            systemInstruction: system || undefined,
            temperature: 0.7
          }
        });
      } catch (err) {
        const status = Number(err?.status || 0);
        if (status === 429) {
          err.message = 'Gemini rate limit reached. ' + err.message;
        }
        throw err;
      }
    },
    { retries: 2, baseDelayMs: 1200 },
    RETRYABLE_AI
  );
  return res.text || '';
}

export async function generateJson({ system, prompt, schema, temperature = 0.7 }) {
  const ai = getClient();
  const res = await withRetries(
    async () => {
      try {
        return await ai.models.generateContent({
          model: modelName(),
          contents: prompt,
          config: {
            systemInstruction: system || undefined,
            responseMimeType: 'application/json',
            responseSchema: schema,
            temperature
          }
        });
      } catch (err) {
        throw err;
      }
    },
    { retries: 2, baseDelayMs: 1200 },
    RETRYABLE_AI
  );
  const raw = res.text || '';
  return parseJsonSafe(raw);
}

export function parseJsonSafe(raw) {
  if (!raw || typeof raw !== 'string') throw new Error('Empty Gemini response');
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  return JSON.parse(cleaned);
}

export function ensureStringList(obj, field, maxItems = 8) {
  if (Array.isArray(obj?.[field])) {
    const list = obj[field]
      .filter((x) => typeof x === 'string' && x.trim().length > 0)
      .map((x) => x.trim());
    return list.slice(0, maxItems);
  }
  throw new Error(`Gemini JSON validation failed for field "${field}"`);
}

export function ensureString(obj, field) {
  if (typeof obj?.[field] === 'string' && obj[field].trim().length > 0) return obj[field].trim();
  throw new Error(`Gemini JSON validation failed for field "${field}"`);
}

const LIST_TYPE = { type: 'STRING' };

function listSchema(maxItems) {
  return { type: 'ARRAY', items: LIST_TYPE, maxItems, minItems: 0 };
}

export const reportInsightsSchema = {
  type: 'OBJECT',
  properties: {
    executive_summary: { type: 'STRING' },
    key_changes: listSchema(6),
    best_videos: listSchema(5),
    underperforming_videos: listSchema(5),
    video_ideas: { type: 'ARRAY', items: LIST_TYPE, minItems: 5, maxItems: 5 },
    shorts_topics: listSchema(5),
    longform_topics: listSchema(5),
    hooks_and_titles: listSchema(6),
    experiments_next_7_days: listSchema(5),
    metrics_to_monitor: listSchema(5),
    confidence_and_limits: { type: 'STRING' }
  },
  required: ['executive_summary', 'video_ideas', 'confidence_and_limits']
};

export const ideaListSchema = {
  type: 'OBJECT',
  properties: {
    video_ideas: { type: 'ARRAY', items: { type: 'OBJECT', properties: { title: { type: 'STRING' }, angle: { type: 'STRING' }, why: { type: 'STRING' } }, required: ['title'] } }
  },
  required: ['video_ideas']
};

export const titleSuggestionsSchema = {
  type: 'OBJECT',
  properties: {
    problem_detected: { type: 'STRING' },
    title_alternatives: { type: 'ARRAY', items: { type: 'OBJECT', properties: { text: { type: 'STRING' }, rationale: { type: 'STRING' } }, required: ['text'] } }
  },
  required: ['title_alternatives']
};

export const thumbnailConceptsSchema = {
  type: 'OBJECT',
  properties: {
    concepts: { type: 'ARRAY', items: { type: 'OBJECT', properties: { visual: { type: 'STRING' }, text_overlay: { type: 'STRING' }, why: { type: 'STRING' } }, required: ['visual'] } }
  },
  required: ['concepts']
};
