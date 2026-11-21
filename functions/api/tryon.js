// FILE: functions/api/tryon.js
/**
 * Cloudflare Pages Function — GET & POST /api/tryon
 * -----------------------------------------------------------------------------
 * Endpoint AI Virtual Try-On 100% Gratis (Cloudflare Workers AI Free Tier:
 * 10.000 Neurons/hari, reset 00:00 UTC) menggunakan @cf/black-forest-labs/flux-2-klein-4b.
 *
 * Estimasi hemat: ~100–150 Neurons per gambar (±65–90 foto AI Try-On/hari Rp 0).
 *
 * Cara aktifkan di proyek miracle-workspace:
 * 1. Simpan file ini persis di: functions/api/tryon.js
 * 2. Pastikan binding Workers AI bernama "AI" sudah aktif di Cloudflare Pages / wrangler.toml.
 * 3. Cek status lewat browser: https://miracle-workspace.pages.dev/api/tryon
 */

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

/**
 * Endpoint GET /api/tryon untuk mengecek apakah fungsi & binding AI sudah aktif.
 */
export async function onRequestGet(context) {
  const aiReady = Boolean(context.env && context.env.AI);
  return jsonResponse({
    status: 'ok',
    service: 'BrandFeed AI Studio - Workers AI Studio (Clean + Try-On FLUX.2 Klein 4B)',
    model: '@cf/black-forest-labs/flux-2-klein-4b',
    aiBindingReady: aiReady,
    message: aiReady
      ? 'Binding Workers AI (AI) aktif. AI Rapikan Produk & AI Try-On Manekin/Tangan siap digunakan (Rp 0).'
      : 'Binding Workers AI (AI) belum terdeteksi. Tambahkan binding AI di Cloudflare Pages atau wrangler.toml.'
  }, 200);
}

/**
 * Menangani preflight CORS (OPTIONS /api/tryon).
 */
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

/**
 * Konversi string base64 menjadi Blob biner untuk multipart FormData FLUX.2 Klein 4B.
 */
function base64ToBlob(base64, mimeType = 'image/jpeg') {
  const clean = String(base64 || '')
    .replace(/^data:[^;]+;base64,/, '')
    .replace(/\s+/g, '');
  const binary = atob(clean);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

/**
 * Konversi ArrayBuffer ke string base64 secara aman (chunked) tanpa stack overflow.
 */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Auto-OCR ringan (±15 Neurons) untuk membaca ejaan persis teks/logo pada produk
 * sebelum FLUX.2 Klein 4B menggambar ulang, agar tulisan di label tidak rusak/ngawur.
 */
async function readExactLabelText(env, productBase64, productMime = 'image/jpeg') {
  const cleanB64 = String(productBase64 || '')
    .replace(/^data:[^;]+;base64,/, '')
    .replace(/\s+/g, '');
  if (!cleanB64) return '';

  const mime = productMime === 'image/png' || productMime === 'image/webp'
    ? productMime
    : 'image/jpeg';
  const dataUrl = `data:${mime};base64,${cleanB64}`;

  const payload = {
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Read ONLY the exact printed brand name and label text visible on the main retail product (ignore price tags, barcode stickers, and background boxes). Reply with ONLY the exact text lines separated by " | " preserving exact spelling and accents. If there is no readable text on the product, reply NONE.'
          },
          { type: 'image_url', image_url: { url: dataUrl } }
        ]
      }
    ],
    max_tokens: 70,
    temperature: 0.0
  };

  const ocrModels = [
    '@cf/google/gemma-3-12b-it',
    '@cf/meta/llama-4-scout-17b-16e-instruct',
    '@cf/meta/llama-3.2-11b-vision-instruct'
  ];

  for (const modelId of ocrModels) {
    try {
      const res = await env.AI.run(modelId, payload);
      const raw = String(res?.response || res?.choices?.[0]?.message?.content || '').trim();
      if (!raw) continue;
      if (/^NONE\b/i.test(raw)) return '';
      const cleaned = raw
        .replace(/[`"*\r\n]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 140);
      if (cleaned) return cleaned;
    } catch (_) {
      // Lanjut ke model OCR cadangan jika model ini gagal
    }
  }
  return '';
}

/**
 * Menyusun prompt katalog studio sesuai mode & kategori (bebas kata pemicu filter 3030
 * dan menyuntikkan ejaan teks label hasil Auto-OCR agar huruf tetap tajam & benar).
 */
function buildTryOnPrompt(mode, category, productTitle, hasBottom = false, framing = 'torso', labelText = '') {
  const typographyGuard = labelText
    ? ` CRITICAL TYPOGRAPHY RULE: The printed label or logo on the product MUST accurately and crisply spell the exact text "${labelText}" with sharp legible lettering, zero typos, and zero garbled characters.`
    : ` Strictly preserve the exact printed label typography, brand logo, and fine details cleanly and legibly without distortion.`;

  if (mode === 'clean') {
    if (category === 'parfum_kosmetik') {
      return (
        `Clean commercial e-commerce studio packshot photography of ONLY the exact perfume bottle or cosmetic container from image 0, standing upright and centered on a pure solid white background (#FFFFFF). ` +
        `Isolate ONLY the standalone bottle on pure white studio backdrop, excluding all surrounding objects, background boxes, shelves, price stickers, and barcode tags from image 0. ` +
        `Strictly preserve the exact original glass bottle shape, black cap, spray nozzle, liquid color, white rectangular bordered label design, and proportions from image 0.` +
        `${typographyGuard} ` +
        `Crisp even commercial studio lighting with subtle clean glass reflections, ultra-sharp macro focus. Pure product packshot only, no watermark.`
      );
    }

    if (category === 'sepatu') {
      return (
        `Clean commercial e-commerce studio packshot photography of ONLY the exact shoe or footwear from image 0, cleanly centered on a pure solid white background (#FFFFFF). ` +
        `Isolate ONLY the footwear on pure white studio backdrop, excluding shoe boxes, shelves, price stickers, barcode labels, and paper hangtags from image 0. ` +
        `Strictly preserve the exact original shoe shape, upper material, stitching, laces, sole, and colors from image 0.` +
        `${typographyGuard} ` +
        `Soft even commercial studio lighting, sharp focus. Pure product packshot only, no watermark.`
      );
    }

    if (category === 'tas') {
      return (
        `Clean commercial e-commerce studio packshot photography of ONLY the exact bag, handbag, backpack, or wallet from image 0, standing neatly centered on a pure solid white background (#FFFFFF). ` +
        `Isolate ONLY the bag on pure white studio backdrop, excluding store racks, price stickers, barcode labels, and paper hangtags from image 0. ` +
        `Strictly preserve the exact original bag shape, straps, zippers, hardware, material texture, and colors from image 0.` +
        `${typographyGuard} ` +
        `Soft even commercial studio lighting, sharp focus. Pure product packshot only, no watermark.`
      );
    }

    return (
      `Clean commercial e-commerce studio product photography of the exact garment from image 0 neatly presented flat on a pure solid white background (#FFFFFF). ` +
      `Freshly steamed and neatly pressed fabric without wrinkles or creases, excluding price stickers, barcode labels, paper hangtags, hangers, and store racks. ` +
      `Strictly preserve the exact original garment silhouette, colors, graphic print, buttons, pockets, seams, and fabric texture from image 0.` +
      `${typographyGuard} ` +
      `Soft even commercial studio lighting, centered framing, sharp focus. Pure apparel packshot only, no watermark.`
    );
  }

  if (mode === 'hand') {
    const itemDesc = category === 'parfum_kosmetik'
      ? 'the exact perfume bottle or cosmetic product'
      : category === 'tas'
        ? 'the exact bag or wallet'
        : 'the exact retail product';

    return (
      `Clean commercial studio retail catalog photography. Place ONLY ${itemDesc} from image 1 resting naturally and upright on the open palm of the studio reference hand from image 0 on a pure solid white studio background (#FFFFFF). ` +
      `Keep the exact studio reference composition from image 0 and isolate ONLY ${itemDesc} from image 1 without background boxes or price stickers. ` +
      `Strictly preserve the exact original shape, cap, proportions, colors, and material texture of ${itemDesc} from image 1.` +
      `${typographyGuard} ` +
      `Add soft natural contact shadow under the product and even studio lighting. Clean retail catalog shot, no watermark.`
    );
  }

  const mannequinDesc = category === 'baju_cowok'
    ? 'male matte off-white fiberglass retail display mannequin'
    : category === 'baju_anak'
      ? 'child matte off-white fiberglass retail display mannequin'
      : 'female matte off-white fiberglass retail display mannequin';

  if (hasBottom) {
    return (
      `Clean commercial studio fashion catalog photography. Dress the full-body ${mannequinDesc} from image 0 wearing BOTH the exact top garment from image 1 AND the exact bottom garment from image 2 on a pure solid white background (#FFFFFF). ` +
      `Keep the exact matte off-white fiberglass mannequin pose and standing base from image 0. ` +
      `Fit the top from image 1 and bottom from image 2 neatly with freshly steamed, wrinkle-free fabric drape, excluding price stickers, hangtags, or hangers.` +
      `${typographyGuard} ` +
      `Soft even studio lighting, crisp high-end retail catalog look, no watermark.`
    );
  }

  if (framing === 'torso') {
    const torsoDesc = category === 'baju_cowok'
      ? 'male freestanding half-body upper-torso tabletop retail display form (cleanly cut flat at the lower waist)'
      : category === 'baju_anak'
        ? 'child freestanding half-body upper-torso tabletop retail display form (cleanly cut flat at the lower waist)'
        : 'female freestanding half-body upper-torso tabletop retail display form (cleanly cut flat at the lower waist)';

    return (
      `Clean commercial studio fashion catalog photography. Dress the ${torsoDesc} from image 0 wearing the exact upper garment from image 1 on a pure solid white studio background (#FFFFFF). ` +
      `FRAMING RULE: Freestanding waist-up half-body tabletop torso form cut cleanly and flat at the waist, with NO metal stand, NO vertical pole, NO iron rod, NO tripod, and NO pedestal base. ` +
      `Fit the exact garment from image 1 neatly with freshly steamed, wrinkle-free fabric drape, excluding price stickers, hangtags, or hangers while preserving collar, sleeves, buttons, pockets, seams, and colors.` +
      `${typographyGuard} ` +
      `Soft even studio lighting, centered framing, crisp high-end retail catalog look, no watermark.`
    );
  }

  return (
    `Clean commercial studio fashion catalog photography. Dress the full-body ${mannequinDesc} from image 0 wearing the exact garment from image 1 on a pure solid white studio background (#FFFFFF). ` +
    `Keep the exact matte off-white fiberglass mannequin pose and standing base from image 0. ` +
    `Fit the exact garment from image 1 neatly with freshly steamed, wrinkle-free fabric drape, excluding price stickers, hangtags, or hangers.` +
    `${typographyGuard} ` +
    `Soft even studio lighting, crisp high-end retail catalog look, no watermark.`
  );
}

/**
 * Prompt ringkas aman untuk auto-retry bila FLUX mengembalikan error filter 3030.
 */
function buildCompactSafePrompt(mode, category, hasBottom, framing, labelText = '') {
  const txt = labelText ? ` Label clearly spells "${labelText}".` : '';
  if (mode === 'clean') {
    return `Clean commercial studio product packshot of the exact retail item from image 0 centered on a pure solid white background (#FFFFFF). Preserve exact shape, colors, and details.${txt} Soft even studio lighting, sharp focus.`;
  }
  if (mode === 'hand') {
    return `Clean studio retail catalog photo placing the exact product from image 1 neatly on the open palm from image 0 on a pure solid white background (#FFFFFF). Preserve exact shape and colors.${txt} Soft contact shadow, even lighting.`;
  }
  if (hasBottom) {
    return `Studio fashion catalog photo of the retail mannequin from image 0 wearing the top from image 1 and bottom from image 2 on a pure solid white background (#FFFFFF). Neatly pressed fabric.${txt}`;
  }
  if (framing === 'torso') {
    return `Studio fashion catalog photo of a freestanding waist-up tabletop torso display form from image 0 wearing the exact garment from image 1 on a pure solid white background (#FFFFFF). Cut cleanly at the waist, no metal pole or stand.${txt}`;
  }
  return `Studio fashion catalog photo of the retail mannequin from image 0 wearing the exact garment from image 1 on a pure solid white background (#FFFFFF). Neatly pressed fabric.${txt}`;
}

/**
 * Eksekusi FLUX.2 Klein 4B via multipart FormData.
 */
async function runFluxKlein(env, prompt, files, width, height) {
  const form = new FormData();
  form.append('prompt', prompt);
  form.append('width', String(width));
  form.append('height', String(height));

  files.forEach((item, idx) => {
    form.append(`input_image_${idx}`, item.blob, item.name);
  });

  const formResponse = new Response(form);
  const aiResp = await env.AI.run('@cf/black-forest-labs/flux-2-klein-4b', {
    multipart: {
      body: formResponse.body,
      contentType: formResponse.headers.get('content-type')
    }
  });

  if (aiResp && typeof aiResp.image === 'string') {
    return aiResp.image;
  }
  if (aiResp instanceof ReadableStream) {
    const buf = await new Response(aiResp).arrayBuffer();
    return arrayBufferToBase64(buf);
  }
  if (aiResp instanceof Uint8Array || aiResp instanceof ArrayBuffer) {
    return arrayBufferToBase64(aiResp instanceof Uint8Array ? aiResp.buffer : aiResp);
  }
  return null;
}

/**
 * Handler utama POST /api/tryon (mendukung mode: 'clean', 'mannequin', 'hand').
 */
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
    if (!body || !body.productBase64) {
      return jsonResponse({ error: 'Field productBase64 wajib dikirim.' }, 400);
    }

    const mode = body.mode === 'clean'
      ? 'clean'
      : body.mode === 'hand'
        ? 'hand'
        : 'mannequin';

    if (mode !== 'clean') {
      if (!body.referenceBase64) {
        return jsonResponse({ error: 'Field referenceBase64 wajib dikirim untuk mode Manekin / Tangan.' }, 400);
      }
      if (body.category === 'sepatu') {
        return jsonResponse({ error: 'Aturan bisnis: Sepatu tidak menggunakan Manekin maupun Tangan Acuan.' }, 400);
      }
    }

    const maxLen = 5_500_000;
    if (
      body.productBase64.length > maxLen ||
      (body.referenceBase64 && body.referenceBase64.length > maxLen) ||
      (body.bottomBase64 && body.bottomBase64.length > maxLen)
    ) {
      return jsonResponse({ error: 'Ukuran gambar terlalu besar. Kompres di bawah 3MB.' }, 413);
    }

    const hasBottom = mode === 'mannequin' && Boolean(body.bottomBase64);
    const framing = hasBottom ? 'full' : (body.framing === 'full' ? 'full' : 'torso');

    // Langkah 1: Auto-OCR ejaan teks label asli agar FLUX tidak mengacak huruf kecil
    const detectedLabelText = await readExactLabelText(
      env,
      body.productBase64,
      body.productMime || 'image/jpeg'
    );

    const primaryPrompt = buildTryOnPrompt(
      mode,
      body.category,
      body.productTitle,
      hasBottom,
      framing,
      detectedLabelText
    );

    const files = [];
    let width = 768;
    let height = 1024;

    if (mode === 'clean') {
      // Resolusi 1024x1024 agar teks label kecil (seperti EAU DE PARFUM / JEANSINDUSTRY) tetap tajam
      width = 1024;
      height = 1024;
      files.push({
        blob: base64ToBlob(body.productBase64, body.productMime || 'image/jpeg'),
        name: 'product.jpg'
      });
    } else {
      files.push({
        blob: base64ToBlob(body.referenceBase64, body.referenceMime || 'image/jpeg'),
        name: 'reference.jpg'
      });
      files.push({
        blob: base64ToBlob(body.productBase64, body.productMime || 'image/jpeg'),
        name: 'product.jpg'
      });
      if (hasBottom) {
        files.push({
          blob: base64ToBlob(body.bottomBase64, body.bottomMime || 'image/jpeg'),
          name: 'bottom.jpg'
        });
      }
    }

    let resultBase64 = null;
    try {
      resultBase64 = await runFluxKlein(env, primaryPrompt, files, width, height);
    } catch (firstErr) {
      const firstMsg = String(firstErr?.message || '');
      if (/3030|flagged/i.test(firstMsg)) {
        const safePrompt = buildCompactSafePrompt(mode, body.category, hasBottom, framing, detectedLabelText);
        resultBase64 = await runFluxKlein(env, safePrompt, files, width, height);
      } else {
        throw firstErr;
      }
    }

    if (!resultBase64) {
      return jsonResponse({
        error: 'Respon model FLUX.2 Klein 4B tidak berisi gambar.',
        fallback: true
      }, 502);
    }

    const ocrCost = detectedLabelText ? 15 : 0;
    const estimatedNeurons = (mode === 'clean' ? 165 : (hasBottom ? 210 : 188)) + ocrCost;

    return jsonResponse({
      imageBase64: resultBase64,
      mimeType: 'image/jpeg',
      model: '@cf/black-forest-labs/flux-2-klein-4b',
      mode,
      framing,
      detectedLabelText,
      estimatedNeurons
    }, 200);
  } catch (err) {
    console.error('Error /api/tryon:', err);
    const msg = String(err?.message || 'Gagal memproses AI Try-On di Cloudflare Workers AI.');
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
