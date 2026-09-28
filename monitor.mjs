import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import nodemailer from 'nodemailer';

// ---------------------------------------------------------------
// CONFIGURACIÓN
// Cada fuente es una página de novedades / changelog.
// Verificá las URLs y ajustá el "selector" si alguna página cambia.
// ---------------------------------------------------------------
const SOURCES = [
  {
    id: 'gpt-chatgpt',
    modelo: 'GPT (ChatGPT)',
    url: 'https://help.openai.com/en/articles/6825453-chatgpt-release-notes',
    selector: 'body',
  },
  {
    id: 'gpt-api',
    modelo: 'GPT (API)',
    url: 'https://platform.openai.com/docs/changelog',
    selector: 'main',
  },
  {
    id: 'gemini-app',
    modelo: 'Gemini (app)',
    url: 'https://gemini.google/release-notes/?hl=en',
    selector: 'main',
  },
  {
    id: 'gemini-api',
    modelo: 'Gemini (API)',
    url: 'https://ai.google.dev/gemini-api/docs/changelog',
    selector: 'main',
  },
  {
    id: 'grok',
    modelo: 'Grok (xAI)',
    url: 'https://docs.x.ai/docs/release-notes',
    selector: 'main',
  },
  {
    id: 'deepseek',
    modelo: 'DeepSeek',
    url: 'https://api-docs.deepseek.com/updates',
    selector: 'main',
  },
];

// ---------------------------------------------------------------
// QUÉ CUENTA COMO "RELEVANTE"
// ---------------------------------------------------------------

// 1) Identificadores de modelo/versión. Si aparece uno que nunca vimos → "nuevo modelo".
//    Ajustá o agregá patrones cuando salgan familias nuevas.
const MODEL_PATTERNS = [
  // GPT: gpt-5, gpt-5.6, gpt-5.6-luna, gpt-5.6-sol, gpt-5.6-terra,
  // gpt-5-mini, gpt-4.1, gpt-4o, etc.
  /\bgpt[- ]?\d+(?:\.\d+)?(?:[- ]?(?:luna|sol|terra|mini|nano|pro|turbo|codex|chat|realtime|audio|image|oss|preview))?\b/gi,

  // Modelos o-series: o1, o3, o3-mini, o4-mini, etc.
  /\bo\d+(?:[- ]?(?:mini|pro|high|preview))?\b/gi,

  // Sora, Codex, ChatGPT
  /\b(?:chatgpt|sora|codex)[- ]?\d+(?:\.\d+)?\b/gi,

  // Gemini
  /\bgemini[- ]?\d+(?:\.\d+)?(?:[- ]?(?:pro|flash|ultra|nano|lite|thinking|live|image|preview))?\b/gi,

  // Imagen, Veo, Gemma
  /\b(?:imagen|veo|gemma)[- ]?\d+(?:\.\d+)?\b/gi,

  // Nano Banana
  /\bnano[- ]?banana(?:[- ]?\d+(?:\.\d+)?)?\b/gi,

  // Grok
  /\bgrok[- ]?\d+(?:\.\d+)?(?:[- ]?(?:mini|fast|heavy|code|imagine))?\b/gi,

  // DeepSeek
  /\bdeepseek[- ]?(?:v\d+(?:\.\d+)?|r\d+)(?:[- ]?(?:flash|pro|chat|reasoner|terminus|exp|speciale|thinking|\d{4}))?\b/gi,
];

// 2) Palabras que indican un lanzamiento / cambio importante (inglés, porque las páginas están en inglés).
const RELEVANT_RE =
  /\b(introduc\w*|launch\w*|releas\w*|announc\w*|new model|new version|now available|generally available|rolling out|rolled out|rollout|upgrad\w*|deprecat\w*|retir\w*|sunset\w*|shut ?down|discontinu\w*|preview|beta|GA)\b/i;

// 3) Ruido típico que preferimos ignorar aunque contenga alguna palabra de arriba.
const NOISE_RE =
  /\b(typo|bug ?fix(?:es)?|fixed an? (?:issue|bug)|minor (?:fix|improvement)s?|performance improvements?|documentation|docs? (?:update|fix)|cookie|privacy policy|subscribe|sign ?in|log ?in)\b/i;

const STATE_FILE = new URL('./state.json', import.meta.url);
const MAX_LINES = 500;
const MIN_LINES = 5; // si una página devuelve menos, probablemente fue un bloqueo → no tocamos el estado

// Configuración del correo (variables de entorno).
// En GitHub Actions un secreto sin definir llega como cadena vacía, por eso se usa ||.
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = process.env.SMTP_PORT || '465';
const { SMTP_USER, SMTP_PASS, MAIL_TO, MAIL_FROM } = process.env;

const mailer =
  SMTP_USER && SMTP_PASS && MAIL_TO
    ? nodemailer.createTransport({
        host: SMTP_HOST,
        port: Number(SMTP_PORT),
        secure: Number(SMTP_PORT) === 465, // true para 465, false para 587 (STARTTLS)
        auth: { user: SMTP_USER, pass: SMTP_PASS },
      })
    : null;

if (!mailer) {
  console.warn('⚠️  Correo no configurado (faltan SMTP_USER, SMTP_PASS o MAIL_TO): solo se mostrará por consola.');
}

// ---------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------
async function loadState() {
  try {
    return JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

async function saveState(state) {
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

function normalize(text) {
  return text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 3)
    .slice(0, MAX_LINES);
}

// Devuelve un Set con los identificadores de modelo encontrados, normalizados (minúsculas, guiones).
function extractModels(lines) {
  const found = new Set();
  for (const line of lines) {
    for (const re of MODEL_PATTERNS) {
      for (const m of line.matchAll(re)) {
        found.add(m[0].toLowerCase().replace(/\s+/g, '-'));
      }
    }
  }
  return found;
}

// De las líneas nuevas, se queda con las que parecen un lanzamiento/cambio importante.
function filterRelevant(nuevas) {
  return nuevas.filter((l) => {
    if (NOISE_RE.test(l)) return false;
    return RELEVANT_RE.test(l) || extractModels([l]).size > 0;
  });
}

async function scrape(browser, source) {
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
    locale: 'en-US',
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
  });
  const page = await context.newPage();
  try {
    await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    // Muchas páginas cargan el contenido con JS: esperamos a que se calme la red.
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    const el = page.locator(source.selector).first();
    await el.waitFor({ timeout: 15000 });
    const text = await el.innerText();
    const lines = normalize(text);
    if (lines.length < MIN_LINES) {
      throw new Error(`Contenido sospechosamente corto (${lines.length} líneas)`);
    }
    return lines;
  } catch (err) {
    // Diagnóstico: título de la página y captura de pantalla (útil si hay un bloqueo tipo Cloudflare)
    const titulo = await page.title().catch(() => '?');
    await page.screenshot({ path: `error-${source.id}.png` }).catch(() => {});
    err.message += ` | título de la página: "${titulo}" | captura: error-${source.id}.png`;
    throw err;
  } finally {
    await context.close();
  }
}

async function notify(source, { modelosNuevos, relevantes }) {
  const hayModelo = modelosNuevos.length > 0;
  const titulo = hayModelo
    ? `Nuevo modelo/versión en ${source.modelo}: ${modelosNuevos.slice(0, 3).join(', ')}`
    : `Actualización relevante en ${source.modelo}`;

  const resumen = relevantes.slice(0, 15).map((l) => `• ${l.slice(0, 200)}`).join('\n');
  const cabecera = hayModelo ? `Modelos detectados: ${modelosNuevos.join(', ')}\n\n` : '';
  const mensaje =
    `🔔 ${titulo}\n${source.url}\n\n${cabecera}${resumen}` +
    (relevantes.length > 15 ? `\n…y ${relevantes.length - 15} líneas más` : '');

  console.log('\n' + mensaje + '\n');

  if (mailer) {
    try {
      const escapar = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const html =
        `<h3>${escapar(titulo)}</h3>` +
        `<p><a href="${escapar(source.url)}">${escapar(source.url)}</a></p>` +
        (hayModelo ? `<p><b>Modelos detectados:</b> ${escapar(modelosNuevos.join(', '))}</p>` : '') +
        `<ul>${relevantes.slice(0, 30).map((l) => `<li>${escapar(l.slice(0, 300))}</li>`).join('')}</ul>` +
        (relevantes.length > 30 ? `<p>…y ${relevantes.length - 30} líneas más</p>` : '');

      await mailer.sendMail({
        from: MAIL_FROM || SMTP_USER,
        to: MAIL_TO,
        subject: `🔔 ${titulo}`,
        text: mensaje,
        html,
      });
      console.log(`Correo enviado a ${MAIL_TO}`);
    } catch (err) {
      console.error('No se pudo enviar el correo:', err.message);
    }
  }
}

// ---------------------------------------------------------------
// Main
// ---------------------------------------------------------------
const state = await loadState();
const browser = await chromium.launch({
  headless: true,
  args: ['--disable-blink-features=AutomationControlled'],
});

for (const source of SOURCES) {
  try {
    const lines = await scrape(browser, source);
    const previo = state[source.id];
    const modelosActuales = extractModels(lines);

    if (!previo?.lines?.length) {
      console.log(
        `[${source.modelo}] Primera ejecución: línea base (${lines.length} líneas, ${modelosActuales.size} modelos conocidos).`
      );
      state[source.id] = { lines, models: [...modelosActuales].sort() };
      continue;
    }

    // Modelos conocidos = los guardados + los que salen de re-analizar las líneas guardadas con los
    // patrones actuales. Así, si cambiás MODEL_PATTERNS no se disparan avisos falsos por modelos viejos.
    const modelosConocidos = new Set([...(previo.models ?? []), ...extractModels(previo.lines)]);
    const vistas = new Set(previo.lines);

    const nuevas = lines.filter((l) => !vistas.has(l));
    const modelosNuevos = [...extractModels(nuevas)].filter((m) => !modelosConocidos.has(m));
    const relevantes = filterRelevant(nuevas);

    if (modelosNuevos.length > 0 || relevantes.length > 0) {
      await notify(source, { modelosNuevos, relevantes });
    } else if (nuevas.length > 0) {
      console.log(`[${source.modelo}] ${nuevas.length} líneas nuevas, pero ninguna relevante (ignoradas).`);
    } else {
      console.log(`[${source.modelo}] Sin cambios.`);
    }

    // Los modelos se acumulan (unión) para no volver a avisar si una versión sale y vuelve a aparecer.
    state[source.id] = {
      lines,
      models: [...new Set([...modelosConocidos, ...modelosActuales])].sort(),
    };
  } catch (err) {
    // Si falla, NO tocamos el estado guardado de esa fuente.
    console.error(`[${source.modelo}] Error: ${err.message}`);
  }
}

await browser.close();
await saveState(state);
