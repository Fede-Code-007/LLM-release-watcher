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
    selector: 'main',
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
    url: 'https://gemini.google/release-notes/',
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

const STATE_FILE = new URL('./state.json', import.meta.url);
const MAX_LINES = 500;

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

async function scrape(browser, source) {
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
    locale: 'en-US',
  });
  const page = await context.newPage();
  try {
    await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    // Muchas páginas cargan el contenido con JS: esperamos a que se calme la red.
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    const el = page.locator(source.selector).first();
    await el.waitFor({ timeout: 15000 });
    const text = await el.innerText();
    return normalize(text);
  } finally {
    await context.close();
  }
}

async function notify(source, nuevas) {
  const resumen = nuevas.slice(0, 15).map((l) => `• ${l.slice(0, 200)}`).join('\n');
  const mensaje =
    `🔔 Novedades en ${source.modelo}\n${source.url}\n\n${resumen}` +
    (nuevas.length > 15 ? `\n…y ${nuevas.length - 15} líneas más` : '');

  console.log('\n' + mensaje + '\n');

  if (mailer) {
    try {
      const escapar = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const html =
        `<h3>Novedades en ${escapar(source.modelo)}</h3>` +
        `<p><a href="${source.url}">${source.url}</a></p>` +
        `<ul>${nuevas.slice(0, 30).map((l) => `<li>${escapar(l.slice(0, 300))}</li>`).join('')}</ul>` +
        (nuevas.length > 30 ? `<p>…y ${nuevas.length - 30} líneas más</p>` : '');

      await mailer.sendMail({
        from: MAIL_FROM || SMTP_USER,
        to: MAIL_TO,
        subject: `🔔 Novedades en ${source.modelo}`,
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
const browser = await chromium.launch({ headless: true });

for (const source of SOURCES) {
  try {
    const lines = await scrape(browser, source);
    const previas = state[source.id]?.lines;

    if (!previas) {
      console.log(`[${source.modelo}] Primera ejecución: guardo línea base (${lines.length} líneas).`);
    } else {
      const vistas = new Set(previas);
      const nuevas = lines.filter((l) => !vistas.has(l));
      if (nuevas.length > 0) await notify(source, nuevas);
      else console.log(`[${source.modelo}] Sin cambios.`);
    }

    state[source.id] = { lines };
  } catch (err) {
    // Si falla, NO tocamos el estado guardado de esa fuente.
    console.error(`[${source.modelo}] Error: ${err.message}`);
  }
}

await browser.close();
await saveState(state);
