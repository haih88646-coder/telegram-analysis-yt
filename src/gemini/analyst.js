import { GoogleGenAI } from '@google/genai';
import { geminiConfig, hasDatabase } from '../config.js';
import { withRetries, isRetryableStatus } from '../utils/errors.js';
import { query } from '../database/db.js';

let cachedClient = null;

function getClient() {
  if (!cachedClient) {
    const config = geminiConfig();
    cachedClient = new GoogleGenAI({
      apiKey: config.apiKey,
      httpOptions: { timeout: config.requestTimeoutMs }
    });
  }
  return cachedClient;
}

function raceTimeout(promise, ms, label) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`${label} timed out after ${Math.round(ms / 1000)}s`);
      err.status = 504;
      err.retryable = true;
      reject(err);
    }, ms);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

function modelName() {
  return geminiConfig().model;
}

let modelCache = { value: null, loadedAt: 0 };

export async function activeModelName() {
  const fallback = geminiConfig().model;
  if (hasDatabase()) {
    try {
      if (Date.now() - modelCache.loadedAt > 60000) {
        const rows = await query(`SELECT value FROM sync_state WHERE key = 'gemini_model' LIMIT 1`);
        modelCache = { value: rows[0]?.value || null, loadedAt: Date.now() };
      }
    } catch {
      modelCache = { value: modelCache.value || null, loadedAt: Date.now() };
    }
  }
  return modelCache.value || fallback;
}

export function clearModelOverride() {
  modelCache = { value: null, loadedAt: 0 };
}

const RETRYABLE_AI = (err) => isRetryableStatus(err?.status) || err?.status === undefined && err?.retryable === true;

export async function generateText({ system, prompt }) {
  const ai = getClient();
  const res = await raceTimeout(
    withRetries(
    async () => {
      try {
        return await ai.models.generateContent({
          model: await activeModelName(),
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
  ), geminiConfig().overallTimeoutMs, 'Gemini text request');
  return res.text || '';
}

export async function generateJson({ system, prompt, schema, temperature = 0.7 }) {
  const ai = getClient();
  const res = await raceTimeout(
    withRetries(
    async () => {
      try {
        return await ai.models.generateContent({
          model: await activeModelName(),
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
  ), geminiConfig().overallTimeoutMs, 'Gemini JSON request');
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
