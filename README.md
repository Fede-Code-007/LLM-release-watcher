# LLM Release Watcher

Monitor automático que revisa periódicamente las páginas oficiales de *release notes* y *changelog* de distintos proveedores de modelos de lenguaje y envía avisos **por correo electrónico** cuando detecta novedades relevantes, nuevos modelos o nuevas variantes.

Actualmente monitorea **GPT (OpenAI)**, **Gemini**, **Grok (xAI)** y **DeepSeek**.

Utiliza [Playwright](https://playwright.dev/) para acceder a las páginas mediante Chromium, incluyendo sitios cuyo contenido se carga dinámicamente con JavaScript, y se ejecuta automáticamente cada 2 horas mediante GitHub Actions.

## ¿Cómo funciona?

1. El monitor abre cada fuente configurada utilizando Chromium en modo *headless*.
2. Extrae el texto del contenedor principal de la página y lo normaliza en líneas.
3. Compara las líneas obtenidas con las almacenadas en `state.json`, que funciona como memoria del monitor.
4. Detecta modelos y variantes mediante expresiones regulares. Por ejemplo, puede distinguir identificadores como `GPT-5.6`, `GPT-5.6-Luna`, `GPT-5.6-Sol` y `GPT-5.6-Terra`.
5. También identifica líneas asociadas a lanzamientos, nuevas versiones, disponibilidad, *preview*, *beta*, actualizaciones, depreciaciones y otros cambios relevantes.
6. Si encuentra novedades, envía un correo con el nombre de la fuente, los modelos detectados y las líneas relevantes.
7. Finalmente, actualiza `state.json`.

En GitHub Actions, el estado actualizado se guarda en el repositorio mediante un commit **solamente cuando hubo cambios**.

### Primera ejecución

La primera ejecución de cada fuente solamente establece una línea base y no genera avisos.

Los avisos comienzan a partir de las ejecuciones posteriores, cuando se detectan cambios respecto del estado almacenado.

Si una fuente falla por un *timeout*, bloqueo, cambio de estructura o cualquier otro problema, el error se registra en el log, el monitor continúa procesando las demás fuentes y no modifica el estado de la fuente que falló.

## Fuentes monitoreadas

| **Fuente**    | **Página**                                                                                          |
| ------------- | --------------------------------------------------------------------------------------------------- |
| GPT (ChatGPT) | [OpenAI — ChatGPT Release Notes](https://help.openai.com/en/articles/6825453-chatgpt-release-notes) |
| GPT (API)     | [OpenAI — API Changelog](https://platform.openai.com/docs/changelog)                                |
| Gemini (app)  | [Google — Gemini Release Notes](https://gemini.google/release-notes/)                               |
| Gemini (API)  | [Google — Gemini API Changelog](https://ai.google.dev/gemini-api/docs/changelog)                    |
| Grok (xAI)    | [xAI — Release Notes](https://docs.x.ai/docs/release-notes)                                         |
| DeepSeek      | [DeepSeek — Updates](https://api-docs.deepseek.com/updates)                                         |

### Agregar o modificar una fuente

Las fuentes se configuran al comienzo de `monitor.mjs`, dentro de `SOURCES`.

Ejemplo:

```js
{
  id: 'deepseek',                         // identificador único
  modelo: 'DeepSeek',                     // nombre utilizado en los avisos
  url: 'https://api-docs.deepseek.com/updates',
  selector: 'main',                       // selector CSS del contenido
}
```

Si una página cambia su estructura y el monitor deja de obtener correctamente el contenido, se puede modificar el `selector`.

## Detección de modelos

Los identificadores de modelos se detectan mediante las expresiones regulares definidas en `MODEL_PATTERNS` dentro de `monitor.mjs`.

El detector contempla diferentes familias y variantes, entre ellas:

* **GPT:** versiones numéricas y variantes como `mini`, `nano`, `pro`, `turbo`, `codex`, `realtime`, `audio`, `image`, `oss`, `preview`, `luna`, `sol` y `terra`.
* **OpenAI o-series:** modelos como `o3`, `o4-mini`, etc.
* **Gemini:** variantes como `pro`, `flash`, `ultra`, `nano`, `thinking`, `live`, `image` y `preview`.
* **Grok:** variantes como `mini`, `fast`, `heavy`, `code` e `imagine`.
* **DeepSeek:** versiones y variantes como `V3`, `V3.2`, `R1`, `Flash`, `Reasoner`, etc.
* Otros modelos relacionados de proveedores monitorizados.

Los identificadores se normalizan antes de almacenarse para evitar que diferencias de mayúsculas, minúsculas o espacios generen duplicados.

## Estructura del proyecto

```text
.
├── .github/
│   └── workflows/
│       └── monitor.yml             # workflow ejecutado por GitHub Actions
├── monitor.mjs                     # script principal
├── package.json                    # dependencias del proyecto
├── package-lock.json               # versiones exactas de dependencias
├── state.json                      # estado persistente del monitor
└── README.md
```

`state.json` se genera automáticamente después de la primera ejecución.

## Puesta en marcha con GitHub Actions

1. Subí el proyecto a un repositorio de GitHub.
2. Verificá que los archivos estén en la raíz del repositorio.
3. En **Settings → Secrets and variables → Actions**, configurá los siguientes secretos:

| **Secreto** | **Obligatorio** | **Descripción**                              |
| ----------- | --------------- | -------------------------------------------- |
| `SMTP_USER` | Sí              | Cuenta utilizada para enviar los correos     |
| `SMTP_PASS` | Sí              | Contraseña de aplicación                     |
| `MAIL_TO`   | Sí              | Dirección que recibirá los avisos            |
| `SMTP_HOST` | No              | Servidor SMTP. Por defecto: `smtp.gmail.com` |
| `SMTP_PORT` | No              | Puerto SMTP. Por defecto: `465`              |
| `MAIL_FROM` | No              | Remitente. Por defecto utiliza `SMTP_USER`   |

4. En **Settings → Actions → General → Workflow permissions**, seleccioná **Read and write permissions**.

Esto es necesario porque el workflow debe poder actualizar `state.json` en el repositorio.

5. Abrí la pestaña **Actions**.
6. Seleccioná **Monitor de LLM**.
7. Utilizá **Run workflow** para ejecutar manualmente el monitor.

Después de la primera ejecución, GitHub Actions ejecutará el monitor automáticamente cada 2 horas:

```yaml
cron: '0 */2 * * *'
```

El horario del `cron` está expresado en **UTC**. GitHub puede retrasar algunos minutos las ejecuciones programadas cuando existe mucha carga.

> **Nota:** GitHub Actions puede desactivar los workflows programados de repositorios públicos que permanezcan sin actividad durante un período prolongado. Si esto ocurre, se pueden reactivar desde la pestaña **Actions**.

## Configuración de Gmail

Si utilizás Gmail, la contraseña normal de la cuenta no debe utilizarse como `SMTP_PASS`.

Se recomienda:

1. Activar la verificación en dos pasos.
2. Generar una **contraseña de aplicación** desde la cuenta de Google.
3. Guardar esa contraseña en el secreto `SMTP_PASS` de GitHub.

## Ejecución local

El proyecto requiere **Node.js 20 o superior**.

### Linux

```bash
npm install
npx playwright install chromium

export SMTP_USER="tucuenta@gmail.com"
export SMTP_PASS="tu-contraseña-de-aplicación"
export MAIL_TO="destino@ejemplo.com"

node monitor.mjs
```

### Windows PowerShell

```powershell
npm install
npx playwright install chromium

$env:SMTP_USER="tucuenta@gmail.com"
$env:SMTP_PASS="tu-contraseña-de-aplicación"
$env:MAIL_TO="destino@ejemplo.com"

node monitor.mjs
```

Si no se configuran las variables de correo, el monitor continúa funcionando y muestra las novedades directamente en la consola.

## ¿Cómo probar que el correo funciona?

Una vez realizada la primera ejecución, debe existir `state.json`.

Para probar el sistema:

1. Abrí `state.json`.
2. Elegí una fuente.
3. Eliminá una o dos líneas de su lista `lines`.
4. Guardá el archivo.
5. Ejecutá nuevamente el workflow.

Si esas líneas todavía están presentes en la fuente monitoreada, el monitor las interpretará como nuevas y debería generar un aviso.

No se debe eliminar completamente la lista de líneas de una fuente, ya que el programa podría interpretarla como una fuente sin línea base y establecerla nuevamente.

## Reiniciar el monitor

Se puede eliminar `state.json` cuando sea necesario.

En la siguiente ejecución, el monitor establecerá una nueva línea base para cada fuente y no enviará avisos correspondientes a esa primera ejecución.

Las novedades que aparezcan entre el momento en que se elimina `state.json` y la siguiente ejecución no generarán un aviso independiente, ya que formarán parte de la nueva línea base.

## Problemas frecuentes

| **Síntoma**                                   | **Causa probable**                                                             | **Solución**                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------- |
| Error 403 al guardar `state.json`             | El workflow no tiene permisos de escritura                                     | Activar **Read and write permissions**        |
| Error de autenticación al enviar el correo    | Credenciales SMTP incorrectas                                                  | Verificar `SMTP_USER` y `SMTP_PASS`           |
| Gmail rechaza la contraseña                   | Se está utilizando la contraseña normal                                        | Generar una contraseña de aplicación          |
| Una fuente falla con timeout o bloqueo        | El sitio bloquea solicitudes desde servidores de GitHub o cambió su estructura | Revisar el log y comprobar el `selector`      |
| Llegan correos con muchas líneas irrelevantes | La página contiene contenido dinámico o cambiante                              | Utilizar un `selector` más específico         |
| El monitor no reconoce una variante de modelo | El identificador no está contemplado en `MODEL_PATTERNS`                       | Agregar o modificar el patrón correspondiente |
| El correo llega con casi toda la página       | El estado almacenado de esa fuente quedó desactualizado o incompleto           | Revisar o regenerar `state.json`              |
| Los workflows programados dejan de ejecutarse | GitHub puede desactivar workflows programados de repositorios sin actividad    | Reactivar el workflow desde **Actions**       |
