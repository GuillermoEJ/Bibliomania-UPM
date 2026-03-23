import * as cheerio from 'cheerio';
import chalk from 'chalk';
import {
  ANNAS_ARCHIVE_DOMAINS,
  FORMAT_PRIORITY,
  USER_AGENT,
  REQUEST_DELAY_MS,
  REQUEST_TIMEOUT_MS,
} from './config.js';
import { searchWithPuppeteer, closeBrowser } from './puppeteer-helper.js';

/**
 * @typedef {Object} SearchResult
 * @property {string} title
 * @property {string} author
 * @property {string} extension - Formato del archivo (pdf, epub, etc.)
 * @property {string} size - Tamano del archivo
 * @property {string} language
 * @property {string} detailPath - Ruta relativa a la pagina de detalle (/md5/...)
 * @property {string} domain - Dominio que respondio
 */

const HEADERS = {
  'User-Agent': USER_AGENT,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Sec-Ch-Ua': '"Not A(Brand";v="99", "Google Chrome";v="131", "Chromium";v="131"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
};

/**
 * Realiza una peticion HTTP con failover entre dominios de Anna's Archive.
 * @param {string} path - Ruta relativa (ej. /search?q=...)
 * @param {Object} [options] - Opciones adicionales para fetch
 * @returns {Promise<{response: Response, domain: string}>}
 */
async function fetchWithFailover(path, options = {}) {
  const errors = [];

  for (const domain of ANNAS_ARCHIVE_DOMAINS) {
    const url = `https://${domain}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        headers: HEADERS,
        signal: controller.signal,
        redirect: 'follow',
        ...options,
      });

      clearTimeout(timeout);

      if (response.ok) {
        return { response, domain };
      }

      errors.push(`${domain}: HTTP ${response.status}`);
    } catch (err) {
      clearTimeout(timeout);
      errors.push(`${domain}: ${err.message}`);
    }
  }

  throw new Error(
    `Todos los dominios de Anna\'s Archive fallaron:\n  ${errors.join('\n  ')}`
  );
}

/**
 * Espera un tiempo para no saturar el servidor.
 * @param {number} [ms]
 */
function delay(ms = REQUEST_DELAY_MS) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function searchBook(query, preferredFormats = FORMAT_PRIORITY) {
  const allResults = [];

  const params = new URLSearchParams({
    q: query,
    lang: '',
    content: 'book_nonfiction',
    ext: '',
    sort: '',
  });

  // Intentar primero con fetch simple
  try {
    const { response, domain } = await fetchWithFailover(`/search?${params}`);
    const html = await response.text();

    // Detectar si es página de Cloudflare
    if (html.includes('Verifying your connection') || html.includes('cf_challenge')) {
      console.log(chalk.yellow(`  ⚠ Cloudflare detectado en ${domain}, usando navegador...`));
      const puppeteerResult = await searchWithPuppeteer(query, ANNAS_ARCHIVE_DOMAINS);
      if (puppeteerResult.error) {
        throw new Error(puppeteerResult.error);
      }
      const results = parseSearchResults(puppeteerResult.html, puppeteerResult.domain, query);
      allResults.push(...results);
    } else {
      const results = parseSearchResults(html, domain, query);
      allResults.push(...results);
    }
  } catch (err) {
    console.log(chalk.yellow(`  ⚠ Fetch falló, intentando con navegador: ${err.message}`));
    // Fallback a Puppeteer
    try {
      const puppeteerResult = await searchWithPuppeteer(query, ANNAS_ARCHIVE_DOMAINS);
      if (!puppeteerResult.error) {
        const results = parseSearchResults(puppeteerResult.html, puppeteerResult.domain, query);
        allResults.push(...results);
      } else {
        console.log(chalk.red(`  Error con ambos métodos: ${puppeteerResult.error}`));
        return [];
      }
    } catch (puppeteerErr) {
      console.log(chalk.red(`  Error buscando "${query}": ${puppeteerErr.message}`));
      return [];
    }
  }

  if (allResults.length === 0) {
    const simplifiedQuery = simplifyQuery(query);
    if (simplifiedQuery !== query) {
      await delay();
      try {
        const params2 = new URLSearchParams({ q: simplifiedQuery });
        const { response, domain } = await fetchWithFailover(`/search?${params2}`);
        const html = await response.text();

        if (html.includes('Verifying your connection') || html.includes('cf_challenge')) {
          const puppeteerResult = await searchWithPuppeteer(simplifiedQuery, ANNAS_ARCHIVE_DOMAINS);
          if (!puppeteerResult.error) {
            const results = parseSearchResults(puppeteerResult.html, puppeteerResult.domain, simplifiedQuery);
            allResults.push(...results);
          }
        } else {
          const results = parseSearchResults(html, domain, simplifiedQuery);
          allResults.push(...results);
        }
      } catch {
        // Silenciar error en busqueda simplificada
      }
    }
  }

  return sortByFormatPreference(allResults, preferredFormats);
}

/**
 * Parsea los resultados de busqueda de Anna's Archive.
 * @param {string} html
 * @param {string} domain
 * @param {string} query
 * @returns {SearchResult[]}
 */
function parseSearchResults(html, domain, query = '') {
  const $ = cheerio.load(html);
  const results = [];
  const seenMd5 = new Set();

  // Debug: verificar estructura HTML
  const mdLinks = $('a[href*="/md5/"]');
  const totalLinks = $('a[href]').length;

  if (mdLinks.length === 0 && totalLinks > 0) {
    // Intentar alternativas cuando no hay enlaces /md5/
    console.log(chalk.gray(`    (Sin enlaces /md5/, buscando alternativas...)`));

    // Buscar patrones alternativos
    const allLinks = $('a[href]');
    const bookPatterns = ['/book/', '/isbn/', '/title/'];

    allLinks.each((_i, elem) => {
      const href = $(elem).attr('href');
      if (!href) return;

      const isBook = bookPatterns.some((p) => href.includes(p)) || href.includes('/md5/');
      if (!isBook) return;

      try {
        const text = $(elem).text().trim();
        if (text.length < 2) return;

        results.push({
          title: text.substring(0, 200),
          author: '',
          extension: '',
          size: '',
          language: '',
          detailPath: href,
          domain,
        });
      } catch {
        // Saltar resultado que no se puede procesar
      }
    });

    if (results.length === 0) {
      // Si tampoco encontramos con alternativas, guardar HTML para debug
      const haveCloudflare = html.includes('Verifying') || html.includes('cf_challenge');
      const haveContent = html.length > 5000;

      console.log(chalk.gray(`    Tamaño HTML: ${html.length} bytes, Cloudflare: ${haveCloudflare}, Contenido: ${haveContent}`));
    }
  }

  mdLinks.each((_i, elem) => {
    try {
      const $elem = $(elem);
      const href = $elem.attr('href');

      if (!href || !href.startsWith('/md5/')) return;

      const md5 = extractMd5(href);
      if (seenMd5.has(md5)) return;
      seenMd5.add(md5);

      // Limpiar comentarios HTML del contenido
      const innerHtml = $elem.html() || '';
      const cleanHtml = innerHtml.replace(/<!--/g, '').replace(/-->/g, '');
      const $clean = cheerio.load(`<div>${cleanHtml}</div>`);

      let title =
        $clean('h3').first().text().trim() ||
        $clean('[class*="font-bold"]').first().text().trim() ||
        $clean('div').first().text().trim();

      if (!title || title.length < 2) return;

      const author =
        $clean('[class*="italic"]').first().text().trim() || '';

      const allText = $clean('div').text();
      const metaInfo = extractMetadata(allText);

      results.push({
        title: title.substring(0, 200),
        author: author.substring(0, 100),
        extension: metaInfo.extension || '',
        size: metaInfo.size || '',
        language: metaInfo.language || '',
        detailPath: href,
        domain,
      });
    } catch {
      // Saltar resultados que no se pueden parsear
    }
  });

  return results;
}

/**
 * Extrae metadatos del texto de un resultado de busqueda.
 * @param {string} text
 * @returns {{extension: string, size: string, language: string}}
 */
function extractMetadata(text) {
  const result = { extension: '', size: '', language: '' };

  const extMatch = text.match(
    /\b(pdf|epub|djvu|mobi|azw3|cbr|cbz|fb2|doc|docx|txt|rtf)\b/i
  );
  if (extMatch) {
    result.extension = extMatch[1].toLowerCase();
  }

  const sizeMatch = text.match(
    /(\d+(?:\.\d+)?\s*(?:KB|MB|GB|bytes))/i
  );
  if (sizeMatch) {
    result.size = sizeMatch[1];
  }

  const langPatterns = [
    { pattern: /\bspanish\b/i, lang: 'Spanish' },
    { pattern: /\benglish\b/i, lang: 'English' },
    { pattern: /\bfrench\b/i, lang: 'French' },
    { pattern: /\bgerman\b/i, lang: 'German' },
    { pattern: /\bitalian\b/i, lang: 'Italian' },
    { pattern: /\bportuguese\b/i, lang: 'Portuguese' },
    { pattern: /\bespanol\b/i, lang: 'Spanish' },
    { pattern: /\bingl[eé]s\b/i, lang: 'English' },
  ];

  for (const { pattern, lang } of langPatterns) {
    if (pattern.test(text)) {
      result.language = lang;
      break;
    }
  }

  return result;
}

/**
 * Obtiene la URL de descarga directa desde la pagina de detalle de un libro.
 * Flujo: pagina de detalle -> slow_download -> URL directa
 *
 * @param {SearchResult} result - Resultado de busqueda
 * @returns {Promise<{url: string|null, filename: string|null, error: string|null}>}
 */
export async function resolveDownloadUrl(result) {
  const detailUrl = `/md5/${extractMd5(result.detailPath)}`;

  try {
    const { response, domain } = await fetchWithFailover(detailUrl);
    const html = await response.text();
    const $ = cheerio.load(html);

    const slowLinks = [];
    const mirrorLinks = [];

    $('a[href]').each((_i, elem) => {
      const href = $(elem).attr('href');
      if (!href) return;

      if (href.includes('/slow_download/')) {
        slowLinks.push(href);
      } else if (
        href.includes('library.lol') ||
        href.includes('libgen') ||
        href.includes('lib.is')
      ) {
        mirrorLinks.push(href);
      }
    });

    // Intentar slow download primero
    for (const slowPath of slowLinks) {
      try {
        await delay(1000);

        const fullSlowPath = slowPath.startsWith('/') ? slowPath : `/${slowPath}`;
        const { response: slowResponse } = await fetchWithFailover(fullSlowPath);
        const slowHtml = await slowResponse.text();
        const $slow = cheerio.load(slowHtml);

        const directUrl =
          $slow('a[href*="//"]').filter((_i, el) => {
            const h = $slow(el).attr('href');
            return h && !h.includes('annas-archive') && !h.includes('javascript:');
          }).first().attr('href') ||
          $slow('p.mb-4 a').attr('href') ||
          $slow('a.btn').attr('href') ||
          $slow('a[download]').attr('href');

        if (directUrl && directUrl.startsWith('http')) {
          const ext = result.extension || 'pdf';
          const safeTitle = result.title.substring(0, 100);
          return {
            url: directUrl,
            filename: `${safeTitle}.${ext}`,
            error: null,
          };
        }
      } catch {
        continue;
      }
    }

    // Fallback: intentar mirrors externos
    for (const mirrorUrl of mirrorLinks) {
      try {
        await delay(1000);

        const mirrorResponse = await fetch(mirrorUrl, {
          headers: HEADERS,
          redirect: 'follow',
        });

        if (!mirrorResponse.ok) continue;

        const mirrorHtml = await mirrorResponse.text();
        const $mirror = cheerio.load(mirrorHtml);

        const downloadUrl =
          $mirror('a[href*="/get"]').first().attr('href') ||
          $mirror('#download a').first().attr('href') ||
          $mirror('a:contains("GET")').first().attr('href') ||
          $mirror('a[download]').first().attr('href');

        if (downloadUrl) {
          const fullUrl = downloadUrl.startsWith('http')
            ? downloadUrl
            : new URL(downloadUrl, mirrorUrl).href;

          const ext = result.extension || 'pdf';
          const safeTitle = result.title.substring(0, 100);
          return {
            url: fullUrl,
            filename: `${safeTitle}.${ext}`,
            error: null,
          };
        }
      } catch {
        continue;
      }
    }

    return {
      url: null,
      filename: null,
      error: 'No se encontraron enlaces de descarga validos',
    };
  } catch (err) {
    return {
      url: null,
      filename: null,
      error: `Error accediendo a la pagina de detalle: ${err.message}`,
    };
  }
}

/**
 * Busca un libro y devuelve el mejor resultado disponible para descarga,
 * probando formatos en orden de preferencia.
 *
 * @param {string} query - Consulta de busqueda
 * @param {string} bookTitle - Titulo original del libro (para mostrar al usuario)
 * @returns {Promise<{result: SearchResult|null, downloadUrl: string|null, filename: string|null, annaMd5: string|null, error: string|null}>}
 */
export async function findAndResolveBook(query, bookTitle) {
  console.log(chalk.cyan(`  Buscando en Anna's Archive: "${query}"`));

  const results = await searchBook(query);

  if (results.length === 0) {
    return {
      result: null,
      downloadUrl: null,
      filename: null,
      annaMd5: null,
      error: `No se encontraron resultados para "${bookTitle}"`,
    };
  }

  console.log(
    chalk.gray(`  ${results.length} resultado(s) encontrado(s), seleccionando mejor opcion...`)
  );

  const maxAttempts = Math.min(results.length, 3);

  for (let i = 0; i < maxAttempts; i++) {
    const result = results[i];
    console.log(
      chalk.gray(
        `  Intentando: "${result.title}" [${result.extension || '?'}] ${result.size || ''}`
      )
    );

    await delay();
    const download = await resolveDownloadUrl(result);

    if (download.url) {
      return {
        result,
        downloadUrl: download.url,
        filename: download.filename,
        annaMd5: extractMd5(result.detailPath),
        error: null,
      };
    }
  }

  return {
    result: results[0],
    downloadUrl: null,
    filename: null,
    annaMd5: null,
    error: `Se encontro "${results[0].title}" pero no se pudo obtener enlace de descarga`,
  };
}

/**
 * Resuelve la URL de descarga directamente desde un hash MD5 conocido
 * (obtenido del indice compartido). Salta toda la fase de busqueda.
 *
 * @param {string} md5Hash - Hash MD5 de Anna's Archive
 * @param {string} bookTitle - Titulo del libro (para mostrar progreso)
 * @param {string} [format='pdf'] - Formato esperado
 * @returns {Promise<{downloadUrl: string|null, filename: string|null, error: string|null}>}
 */
export async function resolveBookByMd5(md5Hash, bookTitle, format = 'pdf') {
  console.log(chalk.cyan(`  Resolviendo desde indice (MD5: ${md5Hash.substring(0, 12)}...)`));

  const fakeResult = {
    title: bookTitle,
    extension: format,
    detailPath: `/md5/${md5Hash}`,
    domain: '',
  };

  const download = await resolveDownloadUrl(fakeResult);

  if (download.url) {
    return {
      downloadUrl: download.url,
      filename: download.filename,
      error: null,
    };
  }

  return {
    downloadUrl: null,
    filename: null,
    error: download.error || 'No se pudo resolver el enlace desde el MD5 del indice',
  };
}

/**
 * Extrae el hash MD5 de una ruta de detalle.
 * @param {string} path
 * @returns {string}
 */
function extractMd5(path) {
  const match = path.match(/\/md5\/([a-fA-F0-9]+)/);
  return match ? match[1] : path.replace('/md5/', '');
}

/**
 * Simplifica una consulta de busqueda eliminando elementos secundarios.
 * @param {string} query
 * @returns {string}
 */
function simplifyQuery(query) {
  const isbn = query.match(/\b(97[89]\d{10})\b/);
  if (isbn) return isbn[1];

  const parts = query.split(/\s+/);
  if (parts.length > 5) {
    return parts.slice(0, 5).join(' ');
  }

  return query;
}

/**
 * Ordena resultados priorizando formatos preferidos.
 * @param {SearchResult[]} results
 * @param {string[]} preferredFormats
 * @returns {SearchResult[]}
 */
function sortByFormatPreference(results, preferredFormats) {
  return results.sort((a, b) => {
    const aIdx = preferredFormats.indexOf(a.extension.toLowerCase());
    const bIdx = preferredFormats.indexOf(b.extension.toLowerCase());

    const aPrio = aIdx === -1 ? 999 : aIdx;
    const bPrio = bIdx === -1 ? 999 : bIdx;

    return aPrio - bPrio;
  });
}
