import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import cliProgress from 'cli-progress';
import chalk from 'chalk';
import { USER_AGENT, MAX_RETRIES, REQUEST_TIMEOUT_MS, BIBLIOTECA_DIR } from './config.js';

/**
 * Descarga un archivo desde una URL mostrando progreso en la terminal.
 *
 * @param {string} url - URL directa de descarga
 * @param {string} destDir - Directorio destino (dentro de /Biblioteca)
 * @param {string} filename - Nombre del archivo
 * @param {string} basePath - Ruta base del proyecto
 * @returns {Promise<{success: boolean, filePath: string|null, error: string|null}>}
 */
export async function downloadBook(url, destDir, filename, basePath) {
  const fullDir = join(basePath, BIBLIOTECA_DIR, destDir);
  await mkdir(fullDir, { recursive: true });

  const filePath = join(fullDir, sanitizeFilename(filename));

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await attemptDownload(url, filePath, filename);
      return result;
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        console.log(
          chalk.yellow(`  Reintentando descarga (${attempt}/${MAX_RETRIES})...`)
        );
      } else {
        return {
          success: false,
          filePath: null,
          error: `Fallo tras ${MAX_RETRIES} intentos: ${err.message}`,
        };
      }
    }
  }

  return { success: false, filePath: null, error: 'Error desconocido' };
}

/**
 * Intenta descargar un archivo una vez, con barra de progreso.
 * @param {string} url
 * @param {string} filePath
 * @param {string} displayName
 * @returns {Promise<{success: boolean, filePath: string, error: null}>}
 */
async function attemptDownload(url, filePath, displayName) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: '*/*',
      },
      signal: controller.signal,
      redirect: 'follow',
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const totalBytes = parseInt(response.headers.get('content-length') || '0', 10);

    const bar = new cliProgress.SingleBar(
      {
        format:
          '  {bar} {percentage}% | {value}/{total} KB | {filename}',
        barCompleteChar: '#',
        barIncompleteChar: '-',
        hideCursor: true,
        clearOnComplete: false,
        stopOnComplete: true,
      },
      cliProgress.Presets.shades_classic
    );

    const totalKB = totalBytes > 0 ? Math.round(totalBytes / 1024) : 0;

    if (totalBytes > 0) {
      bar.start(totalKB, 0, { filename: truncate(displayName, 40) });
    } else {
      console.log(`  Descargando: ${displayName} (tamano desconocido)...`);
    }

    let downloaded = 0;
    const fileStream = createWriteStream(filePath);
    const reader = response.body.getReader();

    await new Promise((resolve, reject) => {
      fileStream.on('error', reject);

      function pump() {
        reader.read().then(({ done, value }) => {
          if (done) {
            fileStream.end(() => {
              if (totalBytes > 0) bar.stop();
              resolve();
            });
            return;
          }

          downloaded += value.length;
          if (totalBytes > 0) {
            bar.update(Math.round(downloaded / 1024));
          }

          const canWrite = fileStream.write(value);
          if (canWrite) {
            pump();
          } else {
            fileStream.once('drain', pump);
          }
        }).catch(reject);
      }

      pump();
    });

    return { success: true, filePath, error: null };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Sanitiza un nombre de archivo eliminando caracteres problematicos.
 * @param {string} name
 * @returns {string}
 */
function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/_{2,}/g, '_')
    .trim()
    .substring(0, 200);
}

/**
 * Trunca una cadena a un largo maximo.
 * @param {string} str
 * @param {number} max
 * @returns {string}
 */
function truncate(str, max) {
  if (str.length <= max) return str;
  return str.substring(0, max - 3) + '...';
}
