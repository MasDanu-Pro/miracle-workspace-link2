// FILE: functions/api/analyze.js
/**
 * Cloudflare Pages Function — GET & POST /api/analyze
 * -----------------------------------------------------------------------------
 * Endpoint AI Vision 100% Gratis (Cloudflare Workers AI Free Tier:
 * 10.000 Neurons/hari, reset 00:00 UTC / 07:00 WIB) untuk BrandFeed AI Studio.
 *
 * Mengisi OTOMATIS seluruh keterangan poster dari foto produk:
 * - brand (bila tercetak di kemasan/label/baju)
 * - label_atas (pil kategori/koleksi di atas judul)
 * - nama_produk (judul utama poster)
 * - tagline (1 baris kalimat promosi singkat)
 * - kategori, bahan, detail_produk, info_fit, warna_label, warna_hex
 */

const ALLOWED_CATEGORIES = new Set([
  'baju_cewek',
  'baju_cowok',
  'baju_anak',
  'sepatu',
  'tas',
  'parfum_kosmetik'
]);

const SYSTEM_PROMPT = `Kamu adalah asisten merchandiser & copywriter ritel Matahari Department Store Indonesia.
Tugasmu menganalisa foto produk secara akurat dan mengembalikan HANYA 1 objek JSON valid (tanpa teks tambahan, tanpa markdown) dengan struktur persis:
{
  "brand": "Nama merek yang tercetak jelas di produk/label (HURUF KAPITAL, maks 22 karakter; isi string kosong \"\" jika tidak ada merek yang terbaca)",
  "label_atas": "Label koleksi singkat 2-4 kata HURUF KAPITAL (contoh: EAU DE PARFUM • KOLEKSI TERBARU, NEW ARRIVAL • SEPATU KASUAL)",
  "nama_produk": "Nama produk singkat & menarik sesuai foto (maks 5 kata)",
  "tagline": "1 baris kalimat promosi singkat & elegan yang cocok dengan produk (5-8 kata)",
  "kategori": "pilih tepat satu: baju_cewek | baju_cowok | baju_anak | sepatu | tas | parfum_kosmetik",
  "bahan": "Estimasi bahan/jenis singkat (2-4 kata)",
  "detail_produk": "Fitur visual utama singkat (maks 7 kata)",
  "info_fit": "Keterangan singkat fit/kenyamanan/ketahanan (maks 6 kata)",
  "warna_label": ["Nama warna 1", "Nama warna 2"],
  "warna_hex": ["#RRGGBB", "#RRGGBB"]
}
Aturan wajib:
- Baca teks merek/logo pada botol, kemasan, atau baju dengan teliti untuk mengisi "brand" dan "nama_produk".
- Jika gambar adalah sepatu/sandal/sneaker/boots/heels, kategori WAJIB "sepatu".
- Jika gambar adalah tas/ransel/dompet/pouch, kategori WAJIB "tas".
- Jika gambar adalah parfum/skincare/kosmetik/body mist/lipstik, kategori WAJIB "parfum_kosmetik".
- warna_label dan warna_hex masing-masing 1 sampai 3 item dalam Bahasa Indonesia.`;

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

export async function onRequestGet(context) {
  const aiReady = Boolean(context.env && context.env.AI);
  return jsonResponse({
    status: 'ok',
    service: 'BrandFeed AI Studio - Workers AI Vision Full-Auto',
    aiBindingReady: aiReady,
    message: aiReady
      ? 'Binding Workers AI (AI) aktif. Analisa lengkap seluruh teks poster siap digunakan (Rp 0).'
      : 'Binding Workers AI (AI) belum terdeteksi. Tambahkan binding AI di Cloudflare Pages atau wrangler.toml.'
  }, 200);
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

function base64ToUint8Array(base64) {
  const clean = String(base64 || '')
    .replace(/^data:[^;]+;base64,/, '')
    .replace(/\s+/g, '');
  const binary = atob(clean);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function extractJsonObject(rawText) {
  if (!rawText) return null;
  if (typeof rawText === 'object' && !Array.isArray(rawText)) return rawText;

  const fencePattern = new RegExp('\\x60{3}(?:json)?\\s*', 'gi');
  const cleaned = String(rawText).replace(fencePattern, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch (_) {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch (_) {
        return null;
      }
    }
    return null;
  }
}

function sanitizeAnalysis(parsed, fallbackCategory = 'baju_cewek') {
  const safeCategory = ALLOWED_CATEGORIES.has(parsed?.kategori)
    ? parsed.kategori
    : (ALLOWED_CATEGORIES.has(fallbackCategory) ? fallbackCategory : 'baju_cewek');

  const rawBrand = String(parsed?.brand || '').trim();
  const cleanBrand = /^(none|tidak ada|unknown|n\/a|-)$/i.test(rawBrand)
    ? ''
    : rawBrand.toUpperCase().slice(0, 28);

  const rawLabels = Array.isArray(parsed?.warna_label) ? parsed.warna_label.slice(0, 3) : [];
  const rawHexes = Array.isArray(parsed?.warna_hex) ? parsed.warna_hex.slice(0, 3) : [];

  const warna_label = rawLabels
    .map((l) => String(l || 'Netral').trim().slice(0, 16))
    .filter(Boolean);

  const warna_hex = warna_label.map((_, idx) => {
    const h = String(rawHexes[idx] || '').trim();
    return /^#[0-9a-fA-F]{6}$/.test(h) ? h : '#64748b';
  });

  const defaultByCat = {
    parfum_kosmetik: {
      label_atas: 'KOLEKSI WEWANGIAN • PILIHAN',
      tagline: 'Aroma Elegan & Segar Sepanjang Hari'
    },
    sepatu: {
      label_atas: 'NEW ARRIVAL • KOLEKSI SEPATU',
      tagline: 'Nyaman Melangkah, Gaya Kasual Seharian'
    },
    tas: {
      label_atas: 'NEW ARRIVAL • KOLEKSI TAS',
      tagline: 'Ringkas, Rapi & Elegan untuk Harian'
    },
    baju_cowok: {
      label_atas: 'NEW ARRIVAL • KOLEKSI PRIA',
      tagline: 'Tampil Rapi, Kasual & Nyaman Setiap Hari'
    },
    baju_anak: {
      label_atas: 'NEW ARRIVAL • KOLEKSI ANAK',
      tagline: 'Bahan Lembut & Nyaman untuk Aktivitas Anak'
    },
    baju_cewek: {
      label_atas: 'NEW ARRIVAL • KOLEKSI TERBARU',
      tagline: 'Tampil Stylish, Rapi & Nyaman Setiap Hari'
    }
  };
  const catDef = defaultByCat[safeCategory] || defaultByCat.baju_cewek;

  return {
    brand: cleanBrand,
    label_atas: String(parsed?.label_atas || catDef.label_atas).trim().toUpperCase().slice(0, 38),
    nama_produk: String(parsed?.nama_produk || 'Koleksi Pilihan Terbaru').trim().slice(0, 55),
    tagline: String(parsed?.tagline || catDef.tagline).trim().slice(0, 64),
    kategori: safeCategory,
    bahan: String(parsed?.bahan || 'Material Pilihan Nyaman').trim().slice(0, 42),
    detail_produk: String(parsed?.detail_produk || 'Desain rapi, cocok harian').trim().slice(0, 58),
    info_fit: String(parsed?.info_fit || 'Nyaman digunakan sehari-hari').trim().slice(0, 48),
    warna_label: warna_label.length ? warna_label : ['Netral'],
    warna_hex: warna_hex.length ? warna_hex : ['#d6cfc1']
  };
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    if (!env || !env.AI) {
      return jsonResponse({
        error: 'Workers AI binding (AI) belum dikonfigurasi pada Cloudflare Pages.',
        fallback: true
      }, 503);
    }

    const body = await request.json().catch(() => null);
    if (!body || !body.imageBase64 || typeof body.imageBase64 !== 'string') {
      return jsonResponse({ error: 'Field imageBase64 wajib dikirim.' }, 400);
    }

    const cleanB64 = body.imageBase64
      .replace(/^data:[^;]+;base64,/, '')
      .replace(/\s+/g, '');

    if (cleanB64.length > 5_500_000) {
      return jsonResponse({ error: 'Ukuran gambar terlalu besar. Kompres dulu di bawah 3MB.' }, 413);
    }

    const mimeType = body.mimeType === 'image/png' || body.mimeType === 'image/webp'
      ? body.mimeType
      : 'image/jpeg';
    const dataUrl = `data:${mimeType};base64,${cleanB64}`;
    const userPrompt = 'Analisa foto produk ini secara lengkap (termasuk baca merek/teks pada kemasan/label) dan kembalikan HANYA 1 JSON valid sesuai instruksi sistem dalam Bahasa Indonesia.';

    const visionPayload = {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: userPrompt },
            { type: 'image_url', image_url: { url: dataUrl } }
          ]
        }
      ],
      max_tokens: 380,
      temperature: 0.2
    };

    let rawOutput = null;
    let usedModel = '';

    // Urutan model vision gratis Cloudflare paling cepat & stabil (tanpa hambatan lisensi)
    const primaryModels = [
      '@cf/meta/llama-4-scout-17b-16e-instruct',
      '@cf/google/gemma-3-12b-it',
      '@cf/meta/llama-3.2-11b-vision-instruct'
    ];

    for (const modelId of primaryModels) {
      try {
        const res = await env.AI.run(modelId, visionPayload);
        const text = res?.response || res?.choices?.[0]?.message?.content || res;
        if (extractJsonObject(text)) {
          rawOutput = text;
          usedModel = modelId;
          break;
        }
      } catch (err) {
        const msg = String(err?.message || err);
        console.warn(`Vision ${modelId} gagal:`, msg);
        if (modelId === '@cf/meta/llama-3.2-11b-vision-instruct' && /5016|agree|license/i.test(msg)) {
          try {
            await env.AI.run(modelId, { prompt: 'agree' });
            const retryRes = await env.AI.run(modelId, visionPayload);
            const text = retryRes?.response || retryRes?.choices?.[0]?.message?.content || retryRes;
            if (extractJsonObject(text)) {
              rawOutput = text;
              usedModel = modelId;
              break;
            }
          } catch (_) {}
        }
      }
    }

    // Fallback terakhir LLaVA 1.5 7B HF
    if (!rawOutput) {
      const imageBytes = Array.from(base64ToUint8Array(cleanB64));
      const llavaResult = await env.AI.run('@cf/llava-hf/llava-1.5-7b-hf', {
        image: imageBytes,
        prompt: `${SYSTEM_PROMPT}\n\n${userPrompt}`,
        max_tokens: 360
      });
      rawOutput = llavaResult?.description || llavaResult?.response || llavaResult;
      usedModel = '@cf/llava-hf/llava-1.5-7b-hf';
    }

    const parsed = extractJsonObject(rawOutput);
    if (!parsed) {
      return jsonResponse({
        error: 'Output model AI tidak berformat JSON valid.',
        fallback: true
      }, 502);
    }

    const cleanData = sanitizeAnalysis(parsed, body.currentCategory);
    return jsonResponse({
      ...cleanData,
      model: usedModel,
      estimatedNeurons: 20
    }, 200);
  } catch (err) {
    console.error('Error /api/analyze:', err);
    const msg = String(err?.message || 'Gagal memproses analisa gambar di Workers AI.');
    const isQuotaExhausted = /4006|3036|10,000 neurons|daily free allocation|exhausted/i.test(msg);

    return jsonResponse({
      error: isQuotaExhausted
        ? 'Kuota gratis harian 10.000 Neurons sudah habis. Otomatis reset pukul 07:00 WIB.'
        : msg,
      quotaExhausted: isQuotaExhausted,
      fallback: true
    }, isQuotaExhausted ? 429 : 500);
  }
}
