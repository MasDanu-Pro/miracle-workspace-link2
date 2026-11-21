// FILE: functions/api/quota.js
/**
 * Cloudflare Pages Function — GET /api/quota
 * -----------------------------------------------------------------------------
 * Mengambil pemakaian Neurons Workers AI hari ini (UTC) secara live dari
 * Cloudflare GraphQL Analytics API (dataset: aiInferenceAdaptiveGroups).
 *
 * Cara aktifkan mode Live Resmi (opsional, 30 detik di Cloudflare Pages):
 * 1. Di Cloudflare Dashboard -> Manage Account -> Account API Tokens -> Create Token
 *    -> Custom Token -> Permission: Account | Account Analytics | Read.
 * 2. Di Cloudflare Pages -> miracle-workspace -> Settings -> Variables and Secrets:
 *    - CF_ACCOUNT_ID = (Account ID Anda, terlihat di URL dash.cloudflare.com/<ACCOUNT_ID>/...)
 *    - CF_API_TOKEN  = (Token read-only yang barusan dibuat)
 * 3. Redeploy / tunggu 1 menit. Jika belum dipasang, endpoint otomatis memberitahu
 *    frontend agar berjalan mulus dalam Mode Estimasi Lokal Real-Time.
 */

const DAILY_FREE_LIMIT = 10000;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-store'
    }
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

function getUtcWindow() {
  const now = new Date();
  const todayUtc = now.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const startIso = `${todayUtc}T00:00:00Z`;
  const endIso = now.toISOString();

  const nextReset = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0
  ));

  return {
    todayUtc,
    startIso,
    endIso,
    resetAtUtc: nextReset.toISOString()
  };
}

/**
 * Mengelompokkan modelId & metrik Cloudflare menjadi label fitur yang mudah dibaca.
 */
function classifyModelUsage(modelId, costMetric = '') {
  const id = String(modelId || '').toLowerCase();
  const metric = String(costMetric || '').toLowerCase();

  if (
    /flux|diffusion|phoenix|lucid|sdxl|stable-diffusion|dreamshaper|imagen/.test(id) ||
    /tile|mpx|step|image|pixel/.test(metric)
  ) {
    return { key: 'image_gen', label: 'AI Rapikan & Try-On Foto' };
  }
  if (
    /llama|gemma|llava|qwen|mistral|vision|uform|deepseek/.test(id) ||
    /token/.test(metric)
  ) {
    return { key: 'vision_ocr', label: 'AI Vision Analisa & Baca Label' };
  }
  if (/whisper|melotts|audio|speech|aura/.test(id) || /audio|second/.test(metric)) {
    return { key: 'audio', label: 'AI Audio / Suara' };
  }
  if (/bge|embed|rerank/.test(id)) {
    return { key: 'embedding', label: 'AI Teks / Embedding' };
  }

  // Jika bukan UUID mentah, tampilkan nama singkat modelnya
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  if (id && !isUuid) {
    const shortName = id.split('/').pop() || id;
    return { key: `model_${shortName}`, label: `AI (${shortName})` };
  }
  return { key: 'other_ai', label: 'Proses AI Lainnya' };
}

/**
 * Menjalankan query GraphQL Analytics ke Cloudflare untuk menjumlahkan totalNeurons
 * sekaligus rincian pemakaian berdasarkan fitur/model hari ini (dengan fallback aman).
 */
async function queryCloudflareNeurons(accountId, apiToken, win) {
  const endpoint = 'https://api.cloudflare.com/client/v4/graphql';

  const runGql = async (query) => {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query,
        variables: {
          accountTag: accountId,
          today: win.todayUtc
        }
      })
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || (Array.isArray(json.errors) && json.errors.length > 0)) {
      const firstErr = json?.errors?.[0]?.message || `HTTP ${res.status}`;
      throw new Error(firstErr);
    }
    const groups = json?.data?.viewer?.accounts?.[0]?.aiInferenceAdaptiveGroups;
    if (!Array.isArray(groups)) {
      throw new Error('Dataset aiInferenceAdaptiveGroups tidak ditemukan pada akun.');
    }
    return groups;
  };

  // Query 1: Lengkap dengan count + dimensi modelId & costMetricName1
  const queryDetailed = `
    query WorkersAINeuronsDetail($accountTag: String!, $today: Date!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          aiInferenceAdaptiveGroups(
            limit: 1000
            filter: { date_geq: $today, date_leq: $today }
          ) {
            count
            dimensions {
              modelId
              costMetricName1
            }
            sum {
              totalNeurons
            }
          }
        }
      }
    }
  `;

  // Query 2: Tanpa costMetricName1 (fallback jika schema berbeda)
  const queryByModel = `
    query WorkersAINeuronsByModel($accountTag: String!, $today: Date!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          aiInferenceAdaptiveGroups(
            limit: 1000
            filter: { date_geq: $today, date_leq: $today }
          ) {
            count
            dimensions {
              modelId
            }
            sum {
              totalNeurons
            }
          }
        }
      }
    }
  `;

  // Query 3: Fallback dasar hanya totalNeurons agar status Live Cloudflare selalu stabil
  const querySimple = `
    query WorkersAINeuronsToday($accountTag: String!, $today: Date!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          aiInferenceAdaptiveGroups(
            limit: 1000
            filter: { date_geq: $today, date_leq: $today }
          ) {
            sum {
              totalNeurons
            }
          }
        }
      }
    }
  `;

  let groups = [];
  let hasDimensions = true;

  try {
    groups = await runGql(queryDetailed);
  } catch (_) {
    try {
      groups = await runGql(queryByModel);
    } catch (_) {
      groups = await runGql(querySimple);
      hasDimensions = false;
    }
  }

  let total = 0;
  let totalRequests = 0;
  const bucketMap = new Map();
  const rawModels = [];

  for (const row of groups) {
    const neurons = Number(row?.sum?.totalNeurons) || 0;
    const reqs = Number(row?.count) || 0;
    total += neurons;
    totalRequests += reqs;

    if (hasDimensions && (neurons > 0 || reqs > 0)) {
      const mId = row?.dimensions?.modelId || '';
      const metric = row?.dimensions?.costMetricName1 || '';
      rawModels.push({ modelId: mId, metric, requests: reqs, neurons: Math.round(neurons) });

      const cls = classifyModelUsage(mId, metric);
      const cur = bucketMap.get(cls.key) || { key: cls.key, label: cls.label, neurons: 0, requests: 0 };
      cur.neurons += neurons;
      cur.requests += reqs;
      bucketMap.set(cls.key, cur);
    }
  }

  const roundedTotal = Math.round(total);
  const breakdown = [...bucketMap.values()]
    .map((item) => ({
      key: item.key,
      label: item.label,
      neurons: Math.round(item.neurons),
      requests: item.requests,
      pct: roundedTotal > 0 ? Math.max(1, Math.round((item.neurons / roundedTotal) * 100)) : 0
    }))
    .filter((item) => item.neurons > 0 || item.requests > 0)
    .sort((a, b) => b.neurons - a.neurons);

  return {
    usedNeurons: roundedTotal,
    totalRequests,
    breakdown,
    rawModels
  };
}

/**
 * Membaca statistik download global jika binding KV opsional (STATS_KV) tersedia.
 */
async function readGlobalDownloads(env, todayUtc) {
  if (!env || !env.STATS_KV) return null;
  try {
    const [todayRaw, totalRaw] = await Promise.all([
      env.STATS_KV.get(`downloads_day_${todayUtc}`),
      env.STATS_KV.get('downloads_total')
    ]);
    return {
      scope: 'global',
      today: Math.max(0, parseInt(todayRaw || '0', 10) || 0),
      total: Math.max(0, parseInt(totalRaw || '0', 10) || 0)
    };
  } catch (_) {
    return null;
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const win = getUtcWindow();

  try {
    const body = await request.json().catch(() => null);
    if (!body || body.event !== 'download') {
      return jsonResponse({ error: 'Event tidak dikenali.' }, 400);
    }

    const increment = Math.max(1, Math.min(20, parseInt(body.count, 10) || 1));

    if (env && env.STATS_KV) {
      const current = (await readGlobalDownloads(env, win.todayUtc)) || { today: 0, total: 0 };
      const nextToday = current.today + increment;
      const nextTotal = current.total + increment;

      await Promise.all([
        env.STATS_KV.put(`downloads_day_${win.todayUtc}`, String(nextToday), { expirationTtl: 60 * 60 * 48 }),
        env.STATS_KV.put('downloads_total', String(nextTotal))
      ]);

      return jsonResponse({
        status: 'ok',
        downloads: { scope: 'global', today: nextToday, total: nextTotal }
      }, 200);
    }

    return jsonResponse({
      status: 'ok',
      downloads: { scope: 'local', recorded: increment }
    }, 200);
  } catch (err) {
    return jsonResponse({ status: 'fallback', error: err?.message || 'Gagal mencatat download.' }, 200);
  }
}

export async function onRequestGet(context) {
  const { env } = context;
  const win = getUtcWindow();
  const aiBindingReady = Boolean(env && env.AI);
  const accountId = env?.CF_ACCOUNT_ID ? String(env.CF_ACCOUNT_ID).trim() : '';
  const apiToken = env?.CF_API_TOKEN ? String(env.CF_API_TOKEN).trim() : '';
  const globalDownloads = await readGlobalDownloads(env, win.todayUtc);

  if (!accountId || !apiToken) {
    return jsonResponse({
      status: 'ok',
      source: 'local-estimate',
      liveConfigured: false,
      aiBindingReady,
      limitNeurons: DAILY_FREE_LIMIT,
      todayUtc: win.todayUtc,
      resetAtUtc: win.resetAtUtc,
      breakdown: [],
      downloads: globalDownloads || { scope: 'local' },
      message: 'Mode Estimasi Real-Time aktif. Tambahkan CF_ACCOUNT_ID & CF_API_TOKEN di Cloudflare Pages untuk angka live resmi.'
    }, 200);
  }

  try {
    const stats = await queryCloudflareNeurons(accountId, apiToken, win);
    const remainingNeurons = Math.max(0, DAILY_FREE_LIMIT - stats.usedNeurons);

    return jsonResponse({
      status: 'ok',
      source: 'cloudflare-live',
      liveConfigured: true,
      aiBindingReady,
      usedNeurons: stats.usedNeurons,
      limitNeurons: DAILY_FREE_LIMIT,
      remainingNeurons,
      totalRequests: stats.totalRequests,
      breakdown: stats.breakdown,
      rawModels: stats.rawModels,
      downloads: globalDownloads || { scope: 'local' },
      todayUtc: win.todayUtc,
      resetAtUtc: win.resetAtUtc,
      fetchedAt: new Date().toISOString()
    }, 200);
  } catch (err) {
    console.warn('Gagal query GraphQL /api/quota:', err?.message || err);
    return jsonResponse({
      status: 'fallback',
      source: 'local-estimate',
      liveConfigured: true,
      aiBindingReady,
      limitNeurons: DAILY_FREE_LIMIT,
      todayUtc: win.todayUtc,
      resetAtUtc: win.resetAtUtc,
      breakdown: [],
      downloads: globalDownloads || { scope: 'local' },
      error: err?.message || 'Gagal membaca GraphQL Analytics Cloudflare.'
    }, 200);
  }
}
