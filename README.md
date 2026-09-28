# LLM Release Watcher

Monitor automático que te avisa **por correo** cuando aparecen novedades en las páginas de release notes / changelog de **GPT (OpenAI)**, **Gemini**, **Grok (xAI)** y **DeepSeek**.

Usa [Playwright](https://playwright.dev/) para abrir cada página como lo haría un navegador real (incluso las que cargan su contenido con JavaScript) y se ejecuta cada 2 horas con GitHub Actions.

## Cómo funciona?

1. EL monitor abre cada fuente configurada con Chromium en modo headless.
2. Extrae el texto del contenedor principal de la página y lo normaliza en líneas.
3. Compara esas líneas con las guardadas en `state.json` (la "memoria" del monitor).
4. Si hay líneas nuevas, envía un correo con el asunto `🔔 Novedades en <modelo>`, el enlace a la fuente y la lista de líneas nuevas.
5. Guarda el estado actualizado. En GitHub Actions, `state.json` se sube al repo con un commit, y solo cuando cambió.

**La primera ejecución** solo guarda la línea base y no envía correos. Los avisos empiezan desde la segunda corrida.

Si una fuente falla (timeout, bloqueo, cambio de estructura), el script lo registra en el log, sigue con las demás y no toca el estado de esa fuente.

## Fuentes monitoreadas

| Modelo | Página |
| --- | --- |
| GPT (ChatGPT) | https://help.openai.com/en/articles/6825453-chatgpt-release-notes |
| GPT (API) | https://platform.openai.com/docs/changelog |
| Gemini (app) | https://gemini.google/release-notes/ |
| Gemini (API) | https://ai.google.dev/gemini-api/docs/changelog |
| Grok (xAI) | https://docs.x.ai/docs/release-notes |
| DeepSeek | https://api-docs.deepseek.com/updates |

Para agregar, quitar o corregir una fuente, editá la lista `SOURCES` al comienzo de `monitor.mjs`:

```js
{
  id: 'deepseek',            // identificador único (clave en state.json)
  modelo: 'DeepSeek',        // nombre que aparece en el correo
  url: 'https://api-docs.deepseek.com/updates',
  selector: 'main',          // selector CSS del contenido a vigilar
}
```

Si una página cambia su estructura y el monitor deja de leerla, ajustá el `selector`.

## Estructura del proyecto

```
.
├── .github/workflows/monitor.yml   # workflow que corre cada 2 horas
├── monitor.mjs                     # script principal
├── package.json                    # dependencias (playwright, nodemailer)
├── state.json                      # se genera solo tras la primera corrida
└── README.md
```

## Puesta en marcha con GitHub Actions

1. Subí este proyecto a un repositorio de GitHub, con estos archivos en la raíz.
2. En *Settings → Secrets and variables → Actions*, creá los secretos:

   | Secreto | Obligatorio | Descripción |
   | --- | --- | --- |
   | `SMTP_USER` | Sí | Usuario / cuenta que envía el correo |
   | `SMTP_PASS` | Sí | Contraseña de aplicación (ver nota sobre Gmail) |
   | `MAIL_TO` | Sí | Dirección que recibe los avisos |
   | `SMTP_HOST` | No | Por defecto `smtp.gmail.com` |
   | `SMTP_PORT` | No | Por defecto `465` (con `587` usa STARTTLS) |
   | `MAIL_FROM` | No | Remitente; por defecto es `SMTP_USER` |

3. En *Settings → Actions → General → Workflow permissions*, elegí **Read and write permissions** (el workflow necesita subir `state.json`).
4. Andá a la pestaña *Actions*, elegí **Monitor de LLM** y usá **Run workflow** para lanzar la primera corrida.

A partir de ahí corre solo cada 2 horas (`cron: '0 */2 * * *'`, hora UTC). GitHub puede demorar unos minutos las ejecuciones programadas cuando hay mucha carga.

> **Gmail:** no funciona la contraseña normal. Activá la verificación en dos pasos y generá una *contraseña de aplicación* en tu cuenta de Google.

## Ejecución local

Requiere Node.js 20 o superior.

//Codigo Linux:

```bash
npm install
npx playwright install chromium

export SMTP_USER="tucuenta@gmail.com"
export SMTP_PASS="tu-contraseña-de-aplicación"
export MAIL_TO="destino@ejemplo.com"

node monitor.mjs
```

//Codigo en Windows:

```bash
npm install
npx playwright install chromium

$env:SMTP_USER="tucuenta@gmail.com"
$env:SMTP_PASS="tu-contraseña-de-aplicación"
$env:MAIL_TO="destino@ejemplo.com"

node monitor.mjs
```

Si no configurás el correo, el script sigue funcionando y solo muestra las novedades por consola.

## Cómo probar que el correo funciona

1. Esperá a que exista `state.json` (tras la primera corrida).
2. Editalo y borrá **una o dos líneas** de la lista de alguna fuente. No vacíes la lista completa: con la lista vacía el script la trata como línea base nueva y no envía nada.
3. Ejecutá el workflow de nuevo. Esas líneas se detectan como novedad y llega el correo.

## Reiniciar el monitor

Podés borrar `state.json` cuando quieras. En la siguiente corrida se guarda una línea base nueva y no se envía ningún correo. Las novedades que aparezcan entre el borrado y esa corrida no generan aviso.

## Problemas frecuentes

| Síntoma | Causa probable | Solución |
| --- | --- | --- |
| Error 403 al guardar `state.json` | El workflow no tiene permiso de escritura | Activar *Read and write permissions* (ver paso 3) |
| Error de autenticación al enviar el correo | Falta la contraseña de aplicación | Generar una y guardarla en `SMTP_PASS` |
| Una fuente falla con timeout o bloqueo | El sitio bloquea IPs de datacenter (por ejemplo, con Cloudflare) | Revisar el log; el resto de las fuentes sigue funcionando |
| Llegan correos con muchas líneas irrelevantes | La página tiene contenido cambiante (fechas relativas, contadores) | Usar un `selector` más específico |
| El correo llega con casi toda la página | La lista guardada de esa fuente quedó incompleta | Borrar `state.json` para regenerar la base |
| Los workflows dejan de ejecutarse | GitHub desactiva los programados tras 60 días sin actividad en repos públicos | Reactivarlos desde la pestaña *Actions* |

