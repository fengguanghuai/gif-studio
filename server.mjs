import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = path.join(__dirname, 'config');
const PUBLIC_DIR = path.join(__dirname, 'public');
const GENERATED_DIR = path.join(__dirname, 'generated');
const HISTORY_FILE = path.join(GENERATED_DIR, 'history.json');

const ALLOWED_BACKGROUNDS = new Set(['auto', 'opaque', 'transparent']);
const ALLOWED_QUALITIES = new Set(['auto', 'low', 'medium', 'high', 'xhigh', 'max']);
const ALLOWED_COMPLEXITIES = new Set(['low', 'medium', 'high']);
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_REF_IMAGE_BYTES = 20 * 1024 * 1024;

// Minimal .env loader (process.env always takes precedence)
async function loadDotEnv() {
  for (const name of ['.env.local', '.env']) {
    const filePath = path.join(__dirname, name);
    try {
      const text = await fs.readFile(filePath, 'utf8');
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq <= 0) continue;
        const key = line.slice(0, eq).trim();
        let val = line.slice(eq + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!(key in process.env)) {
          process.env[key] = val;
        }
      }
    } catch {
      // Optional file
    }
  }
}

await loadDotEnv();
await fs.mkdir(GENERATED_DIR, { recursive: true });

const models = JSON.parse(await fs.readFile(path.join(CONFIG_DIR, 'models.json'), 'utf8'));
const presets = JSON.parse(await fs.readFile(path.join(CONFIG_DIR, 'presets.json'), 'utf8'));
const modelById = new Map(models.map((m) => [m.id, m]));
const presetById = new Map(presets.map((p) => [p.id, p]));
const defaultModel = models.find((m) => m.default) || models[0];
const defaultPreset = presets[0];

let historyQueue = Promise.resolve();

async function readHistory() {
  try {
    const raw = await fs.readFile(HISTORY_FILE, 'utf8');
    const items = JSON.parse(raw);
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function mutateHistory(fn) {
  historyQueue = historyQueue.then(async () => {
    const current = await readHistory();
    const next = await fn(current);
    await fs.writeFile(HISTORY_FILE, JSON.stringify(next, null, 2), 'utf8');
    return next;
  });
  return historyQueue;
}

function clampInt(raw, min, max, fallback) {
  const n = Number.parseInt(String(raw ?? ''), 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function roundTo10(n) {
  return Math.max(20, Math.min(2000, Math.round(n / 10) * 10));
}

function buildFinalPrompt({ userPrompt, preset, usePreset, customTemplate, hasReference }) {
  const cleanUser = userPrompt.trim();
  if (!usePreset) return cleanUser;
  const baseTemplate =
    (typeof customTemplate === 'string' && customTemplate.trim()) ||
    (hasReference ? preset.templateWithRef : preset.templateTextOnly);
  if (baseTemplate.includes('{{prompt}}')) {
    return baseTemplate.replaceAll('{{prompt}}', cleanUser);
  }
  return `${baseTemplate}\n\n主题与动作：${cleanUser}`;
}

function parseGifDimensions(buffer) {
  if (buffer.length >= 10 && buffer.subarray(0, 3).toString('ascii') === 'GIF') {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }
  return { width: null, height: null };
}

function parseOpenAiError(status, text) {
  try {
    const parsed = JSON.parse(text);
    const err = parsed?.error;
    if (err?.message) {
      return `OpenAI 接口返回 ${status}：${err.message}`;
    }
  } catch {
    // Plain text fallback
  }
  return `OpenAI 接口返回 ${status}：${text.slice(0, 300)}`;
}

const app = new Hono();

app.get('/api/config', (c) => {
  return c.json({
    models,
    presets,
    defaultModelId: defaultModel.id,
    defaultPresetId: defaultPreset.id,
    apiReady: Boolean(process.env.OPENAI_API_KEY)
  });
});

app.get('/api/history', async (c) => {
  const items = await readHistory();
  const valid = [];
  for (const item of items) {
    if (!item?.filename) continue;
    try {
      await fs.access(path.join(GENERATED_DIR, item.filename));
      valid.push(item);
    } catch {
      // Skip missing files
    }
  }
  return c.json({ items: valid });
});

app.delete('/api/history/:id', async (c) => {
  const id = c.req.param('id');
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    return c.json({ error: '无效的作品 ID' }, 400);
  }
  let removed = null;
  await mutateHistory(async (items) => {
    const idx = items.findIndex((x) => x.id === id);
    if (idx === -1) return items;
    removed = items[idx];
    const next = items.slice();
    next.splice(idx, 1);
    return next;
  });
  if (removed?.filename) {
    await fs.unlink(path.join(GENERATED_DIR, removed.filename)).catch(() => {});
  }
  return c.json({ ok: true, id });
});

app.get('/api/files/:filename', async (c) => {
  const filename = c.req.param('filename');
  if (!/^[a-zA-Z0-9_-]+\.gif$/.test(filename)) {
    return c.json({ error: '无效的文件名' }, 400);
  }
  const filePath = path.join(GENERATED_DIR, filename);
  try {
    const data = await fs.readFile(filePath);
    const isDownload = c.req.query('download') === '1';
    const headers = {
      'Content-Type': 'image/gif',
      'Cache-Control': 'public, max-age=31536000, immutable'
    };
    if (isDownload) {
      headers['Content-Disposition'] = `attachment; filename="${filename}"`;
    }
    return new Response(data, { status: 200, headers });
  } catch {
    return c.json({ error: '文件不存在' }, 404);
  }
});

app.post('/api/generate', async (c) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return c.json({ error: '服务端未配置 OPENAI_API_KEY，请先在启动环境中注入密钥。' }, 500);
  }

  let formData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json({ error: '请求格式错误，需要 multipart/form-data' }, 400);
  }

  const userPrompt = String(formData.get('prompt') || '').trim();
  if (!userPrompt) {
    return c.json({ error: '请先输入想生成的动作或表情包主题。' }, 400);
  }

  const requestedModel = String(formData.get('model') || defaultModel.id);
  const modelObj = modelById.get(requestedModel);
  if (!modelObj) {
    return c.json({ error: `未开放的模型：${requestedModel}` }, 400);
  }

  const requestedPresetId = String(formData.get('presetId') || defaultPreset.id);
  const preset = presetById.get(requestedPresetId) || defaultPreset;
  const uiMode = String(formData.get('mode') || 'auto') === 'custom' ? 'custom' : 'auto';
  const usePreset = uiMode === 'auto' ? true : String(formData.get('usePreset') ?? 'true') !== 'false';
  const customTemplate = uiMode === 'custom' ? String(formData.get('customTemplate') || '') : '';

  const refEntry = formData.get('image');
  let refFile = null;
  if (refEntry && typeof refEntry === 'object' && 'arrayBuffer' in refEntry && refEntry.size > 0) {
    if (refEntry.size > MAX_REF_IMAGE_BYTES) {
      return c.json({ error: '参考图大小不能超过 20 MB。' }, 400);
    }
    const mime = refEntry.type || 'image/png';
    if (!ALLOWED_IMAGE_TYPES.has(mime)) {
      return c.json({ error: `参考图仅支持 PNG / JPEG / WebP（当前类型：${mime}）` }, 400);
    }
    refFile = refEntry;
  }

  const defaults = preset.defaults;
  const frameCount =
    uiMode === 'custom' ? clampInt(formData.get('frameCount'), 2, 16, defaults.frameCount) : defaults.frameCount;
  const frameDurationMs =
    uiMode === 'custom'
      ? roundTo10(clampInt(formData.get('frameDurationMs'), 20, 2000, defaults.frameDurationMs))
      : defaults.frameDurationMs;

  const rawBg = uiMode === 'custom' ? String(formData.get('background') || defaults.background) : defaults.background;
  const background = ALLOWED_BACKGROUNDS.has(rawBg) ? rawBg : defaults.background;

  const rawQuality = uiMode === 'custom' ? String(formData.get('quality') || defaults.quality) : defaults.quality;
  const quality = ALLOWED_QUALITIES.has(rawQuality) ? rawQuality : defaults.quality;

  const rawComplexity =
    uiMode === 'custom' ? String(formData.get('complexity') || defaults.complexity) : defaults.complexity;
  const complexity = ALLOWED_COMPLEXITIES.has(rawComplexity) ? rawComplexity : defaults.complexity;

  const finalPrompt = buildFinalPrompt({
    userPrompt,
    preset,
    usePreset,
    customTemplate,
    hasReference: Boolean(refFile)
  });

  const baseURL = (process.env.OPENAI_API_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const startedAt = Date.now();

  let upstreamResp;
  try {
    if (refFile) {
      const upstreamForm = new FormData();
      const buf = await refFile.arrayBuffer();
      const ext = refFile.type === 'image/jpeg' ? 'jpg' : refFile.type === 'image/webp' ? 'webp' : 'png';
      upstreamForm.append('image', new Blob([buf], { type: refFile.type }), refFile.name || `reference.${ext}`);
      upstreamForm.append('model', modelObj.id);
      upstreamForm.append('prompt', finalPrompt);
      upstreamForm.append('n', '1');
      upstreamForm.append('size', 'auto');
      upstreamForm.append('quality', quality);
      upstreamForm.append('background', background);
      upstreamForm.append('output_format', 'gif');
      upstreamForm.append('frame_count', String(frameCount));
      upstreamForm.append('frame_duration_ms', String(frameDurationMs));
      upstreamForm.append('complexity', complexity);

      upstreamResp = await fetch(`${baseURL}/images/edits`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: upstreamForm
      });
    } else {
      upstreamResp = await fetch(`${baseURL}/images/generations`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: modelObj.id,
          prompt: finalPrompt,
          n: 1,
          size: 'auto',
          quality,
          background,
          output_format: 'gif',
          frame_count: frameCount,
          frame_duration_ms: frameDurationMs,
          complexity
        })
      });
    }
  } catch (err) {
    return c.json({ error: `请求 OpenAI 网络失败：${err instanceof Error ? err.message : String(err)}` }, 502);
  }

  const rawText = await upstreamResp.text();
  if (!upstreamResp.ok) {
    return c.json({ error: parseOpenAiError(upstreamResp.status, rawText) }, upstreamResp.status);
  }

  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    return c.json({ error: '上游返回了无法解析的响应内容。' }, 502);
  }

  const first = data?.data?.[0];
  let gifBuffer;
  if (first?.b64_json) {
    gifBuffer = Buffer.from(first.b64_json, 'base64');
  } else if (first?.url) {
    const dl = await fetch(first.url);
    if (!dl.ok) return c.json({ error: '下载上游生成的 GIF 失败。' }, 502);
    gifBuffer = Buffer.from(await dl.arrayBuffer());
  } else {
    return c.json({ error: '上游未返回 GIF 图像数据。' }, 502);
  }

  const elapsedSeconds = Number(((Date.now() - startedAt) / 1000).toFixed(1));
  const id = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const filename = `gif-${id}.gif`;
  await fs.writeFile(path.join(GENERATED_DIR, filename), gifBuffer);

  const dims = parseGifDimensions(gifBuffer);
  const item = {
    id,
    filename,
    url: `/api/files/${filename}`,
    createdAt: new Date().toISOString(),
    model: modelObj.id,
    modelLabel: modelObj.label,
    presetId: usePreset ? preset.id : 'raw',
    presetName: usePreset ? preset.shortName : '纯自定义',
    uiMode,
    hasReference: Boolean(refFile),
    userPrompt,
    finalPrompt,
    frameCount,
    frameDurationMs,
    background,
    quality,
    complexity,
    width: dims.width,
    height: dims.height,
    bytes: gifBuffer.length,
    elapsedSeconds,
    usage: data?.usage || null
  };

  await mutateHistory((items) => [item, ...items].slice(0, 60));
  return c.json({ item });
});

// Static assets from public/
const MIME_BY_EXT = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

app.get('*', async (c) => {
  const reqPath = c.req.path === '/' ? '/index.html' : c.req.path;
  const safePath = path.normalize(reqPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const fullPath = path.join(PUBLIC_DIR, safePath);
  if (!fullPath.startsWith(PUBLIC_DIR)) {
    return c.text('Forbidden', 403);
  }
  try {
    const content = await fs.readFile(fullPath);
    const ext = path.extname(fullPath);
    return new Response(content, {
      status: 200,
      headers: { 'Content-Type': MIME_BY_EXT[ext] || 'application/octet-stream' }
    });
  } catch {
    return c.text('Not Found', 404);
  }
});

const host = process.env.HOST || '127.0.0.1';
const port = Number.parseInt(process.env.PORT || '4318', 10);

serve({ fetch: app.fetch, hostname: host, port }, () => {
  console.log(`GIF Studio listening on http://${host}:${port} (API key configured: ${Boolean(process.env.OPENAI_API_KEY)})`);
});
