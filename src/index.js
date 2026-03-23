#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, basename, extname } from 'node:path';
import { program } from 'commander';
import chalk from 'chalk';
import { extractTextFromPdf } from './pdf-parser.js';
import { findBookInLibrary } from './library.js';
import { findAndResolveBook, resolveBookByMd5 } from './anna.js';
import { downloadBook } from './downloader.js';
import { loadIndex, saveIndex, registerBook, findBookInIndex, computeFileHash } from './registry.js';
import { extractBibliographyWithLLM, isLLMAvailable } from './llm.js';
import { closeBrowser } from './puppeteer-helper.js';
import { BIBLIOTECA_DIR, REQUEST_DELAY_MS } from './config.js';

const PROJECT_ROOT = resolve(import.meta.dirname, '..');

// Cargar .env si existe (sin dependencia externa)
loadEnvFile(resolve(PROJECT_ROOT, '.env'));

program
  .name('bibliomania')
  .description(
    'Descarga automatica de bibliografia recomendada desde guias de estudio de la ETSISI (UPM)'
  )
  .version('1.0.0')
  .argument('<pdf>', 'Ruta al PDF de la guia de estudios')
  .option('-n, --nombre <nombre>', 'Nombre de la asignatura (si no se detecta del PDF)')
  .option('-s, --solo-buscar', 'Solo buscar libros, no descargar', false)
  .option('--no-cache', 'No buscar en la biblioteca local antes de descargar')
  .option('--no-llm', 'No usar LLM, analisis regex unicamente')
  .action(run);

program.parse();

/**
 * Estado de busqueda por libro.
 * @typedef {'local'|'indexed'|'missing'} BookStatus
 */

/**
 * @typedef {Object} BookCheckResult
 * @property {BookStatus} status
 * @property {string|null} localPath
 * @property {import('./registry.js').IndexEntry|null} indexEntry
 */

async function run(pdfPath, options) {
  try {
    await runInternal(pdfPath, options);
  } finally {
    // Asegurar que el navegador Puppeteer se cierre siempre
    await closeBrowser();
  }
}

/**
 * Funcion interna que realiza el procesamiento.
 */
async function runInternal(pdfPath, options) {
  const resolvedPath = resolve(pdfPath);

  printHeader();

  // --- Validar PDF ---
  if (!existsSync(resolvedPath)) {
    fatal(`No se encontro el archivo: ${resolvedPath}`);
  }

  if (extname(resolvedPath).toLowerCase() !== '.pdf') {
    fatal('El archivo debe ser un PDF (.pdf)');
  }

  // --- Paso 1: Extraer texto del PDF ---
  step(1, 'Extrayendo texto del PDF');
  let text;
  try {
    const result = await extractTextFromPdf(resolvedPath);
    text = result.text;
    console.log(chalk.gray(`  ${result.metadata.pages} paginas procesadas`));
  } catch (err) {
    fatal(`Error leyendo el PDF: ${err.message}`);
  }

  // --- Paso 2: Extraer asignatura y bibliografia ---
  let subjectName = null;
  let books = [];

  const useLLM = options.llm !== false && isLLMAvailable();

  if (useLLM) {
    step(2, 'Analizando con LLM (Groq)');
    try {
      const extraction = await extractBibliographyWithLLM(text);
      subjectName = extraction.subject;
      books = extraction.books;

      if (subjectName) {
        console.log(chalk.green(`  Asignatura: "${subjectName}"`));
      }

      if (books.length > 0) {
        console.log(chalk.green(`  ${books.length} libro(s) extraido(s) por LLM\n`));
      } else {
        console.log(chalk.yellow('  El LLM no encontro libros en la bibliografia'));
      }
    } catch (err) {
      console.log(chalk.yellow(`  Error con LLM: ${err.message}`));
      console.log(chalk.yellow('  Continuando con analisis regex como fallback...\n'));
    }
  }

  // Fallback regex si LLM no disponible, fallo, o no encontro libros
  if (books.length === 0) {
    const regexResult = await fallbackRegexAnalysis(text, !useLLM);

    if (!subjectName) {
      subjectName = regexResult.subject;
    }
    books = regexResult.books;

    if (books.length === 0) {
      fatal(
        'No se pudieron extraer libros de la seccion de bibliografia.\n' +
          '  El formato del PDF puede no ser compatible.'
      );
    }
  }

  // Nombre de asignatura: flag > LLM/regex > nombre archivo
  if (options.nombre) {
    subjectName = options.nombre;
  } else if (!subjectName) {
    subjectName = basename(resolvedPath, extname(resolvedPath));
    console.log(
      chalk.yellow(
        `  No se pudo detectar el nombre de la asignatura. Usando nombre del archivo: "${subjectName}"`
      )
    );
  }

  // Mostrar libros encontrados
  step(3, `${books.length} libro(s) identificado(s)`);
  console.log();
  for (let i = 0; i < books.length; i++) {
    const b = books[i];
    const authorStr = b.author ? ` - ${b.author}` : '';
    const yearStr = b.year ? ` (${b.year})` : '';
    console.log(chalk.white(`  ${i + 1}. "${b.title}"${authorStr}${yearStr}`));
    if (b.isbn) console.log(chalk.gray(`     ISBN: ${b.isbn}`));
    if (b.publisher) console.log(chalk.gray(`     Editorial: ${b.publisher}`));
  }
  console.log();

  // --- Paso 4: Comprobar biblioteca local + indice compartido ---
  step(4, 'Comprobando biblioteca local e indice compartido');
  const index = loadIndex(PROJECT_ROOT);
  const indexBookCount = index.books.length;

  if (indexBookCount > 0) {
    console.log(chalk.gray(`  Indice compartido: ${indexBookCount} libro(s) registrado(s)`));
  }

  /** @type {BookCheckResult[]} */
  const checkResults = [];

  for (const book of books) {
    const localResult = findBookInLibrary(book.title, PROJECT_ROOT);

    if (localResult.found) {
      checkResults.push({ status: 'local', localPath: localResult.path, indexEntry: null });
      console.log(
        chalk.green(`  [LOCAL] "${book.title}"`) +
          chalk.gray(`\n    -> ${localResult.path}`)
      );
      continue;
    }

    const indexResult = findBookInIndex(book.title, index);

    if (indexResult.found) {
      checkResults.push({ status: 'indexed', localPath: null, indexEntry: indexResult.entry });
      console.log(
        chalk.cyan(`  [INDICE] "${book.title}"`) +
          chalk.gray(`\n    -> Registrado por otro usuario (${indexResult.entry.format}, ${indexResult.entry.subject})`)
      );
      if (indexResult.entry.anna_md5) {
        console.log(chalk.gray('    -> Descarga directa disponible (sin busqueda)'));
      }
      continue;
    }

    checkResults.push({ status: 'missing', localPath: null, indexEntry: null });
    console.log(chalk.yellow(`  [NO ENCONTRADO] "${book.title}"`));
  }

  const localCount = checkResults.filter((r) => r.status === 'local').length;
  const indexedCount = checkResults.filter((r) => r.status === 'indexed').length;
  const missingCount = checkResults.filter((r) => r.status === 'missing').length;

  console.log();
  console.log(chalk.white('  Resumen:'));
  console.log(chalk.green(`    ${localCount} en biblioteca local`));
  if (indexedCount > 0) {
    console.log(chalk.cyan(`    ${indexedCount} en indice (descarga directa)`));
  }
  if (missingCount > 0) {
    console.log(chalk.yellow(`    ${missingCount} no encontrado(s) (busqueda necesaria)`));
  }

  const booksToProcess = books.filter((_b, i) => checkResults[i].status !== 'local');

  if (booksToProcess.length === 0) {
    console.log(
      chalk.green('\n  Todos los libros ya estan en la biblioteca. Nada que descargar.')
    );
    printFooter(subjectName, books.length, localCount, 0, 0, indexedCount);
    return;
  }

  if (options.soloBuscar) {
    console.log(chalk.yellow('\n  Modo solo-buscar activo. No se descargara nada.'));
    printFooter(subjectName, books.length, localCount, 0, 0, indexedCount);
    return;
  }

  // --- Paso 5: Buscar y descargar ---
  step(5, `Descargando ${booksToProcess.length} libro(s)`);
  console.log(chalk.gray(`  Destino: ${BIBLIOTECA_DIR}/${subjectName}/\n`));

  let downloaded = 0;
  let failed = 0;
  let indexModified = false;

  for (let i = 0; i < booksToProcess.length; i++) {
    const bookIdx = books.indexOf(booksToProcess[i]);
    const book = booksToProcess[i];
    const check = checkResults[bookIdx];
    const num = `[${i + 1}/${booksToProcess.length}]`;

    console.log(chalk.white(`\n${num} "${book.title}"`));

    let downloadUrl = null;
    let filename = null;
    let annaMd5 = null;

    // Si el libro esta en el indice con MD5, saltar la busqueda
    if (check.status === 'indexed' && check.indexEntry && check.indexEntry.anna_md5) {
      annaMd5 = check.indexEntry.anna_md5;
      const resolved = await resolveBookByMd5(annaMd5, book.title, check.indexEntry.format);

      if (resolved.downloadUrl) {
        downloadUrl = resolved.downloadUrl;
        filename = resolved.filename;
      } else {
        console.log(chalk.yellow('  MD5 del indice no resolvio, buscando normalmente...'));
      }
    }

    // Busqueda normal si no tenemos URL
    if (!downloadUrl) {
      const searchResult = await findAndResolveBook(book.searchQuery, book.title);

      if (searchResult.error || !searchResult.downloadUrl) {
        console.log(
          chalk.red(`  FALLO: ${searchResult.error || 'No se pudo resolver la descarga'}`)
        );
        failed++;
        continue;
      }

      downloadUrl = searchResult.downloadUrl;
      filename = searchResult.filename;
      annaMd5 = searchResult.annaMd5;
    }

    console.log(chalk.gray(`  Descargando desde: ${truncateUrl(downloadUrl, 80)}`));
    const downloadResult = await downloadBook(downloadUrl, subjectName, filename, PROJECT_ROOT);

    if (downloadResult.success) {
      console.log(chalk.green(`  OK -> ${downloadResult.filePath}`));
      downloaded++;

      try {
        console.log(chalk.gray('  Calculando hash SHA-256...'));
        const sha256 = await computeFileHash(downloadResult.filePath);
        const fileStat = await stat(downloadResult.filePath);
        const ext = extname(downloadResult.filePath).replace('.', '').toLowerCase();

        const added = registerBook(
          index,
          {
            title: book.title,
            author: book.author,
            isbn: book.isbn,
            year: book.year,
            publisher: book.publisher,
            format: ext || 'pdf',
            sizeBytes: fileStat.size,
            sha256,
            subject: subjectName,
            filePath: downloadResult.filePath,
            annaMd5,
          },
          PROJECT_ROOT
        );

        if (added) {
          console.log(chalk.gray('  Registrado en indice compartido'));
          indexModified = true;
        }
      } catch (err) {
        console.log(chalk.yellow(`  Aviso: No se pudo registrar en indice: ${err.message}`));
      }
    } else {
      console.log(chalk.red(`  FALLO: ${downloadResult.error}`));
      failed++;
    }

    if (i < booksToProcess.length - 1) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  if (indexModified) {
    try {
      saveIndex(PROJECT_ROOT, index);
      console.log(
        chalk.gray(`\n  Indice compartido actualizado (${index.books.length} libro(s) total)`)
      );
    } catch (err) {
      console.log(chalk.yellow(`\n  Aviso: No se pudo guardar el indice: ${err.message}`));
    }
  }

  printFooter(subjectName, books.length, localCount, downloaded, failed, indexedCount);
}

// --- Fallback regex ---

/**
 * Analisis de fallback con regex cuando el LLM no esta disponible o falla.
 * @param {string} text - Texto crudo del PDF
 * @param {boolean} showHeader - Mostrar encabezado de paso
 * @returns {Promise<{subject: string|null, books: Array}>}
 */
async function fallbackRegexAnalysis(text, showHeader = true) {
  if (showHeader) {
    if (!isLLMAvailable()) {
      console.log(chalk.yellow('  GROQ_API_KEY no configurada. Usando analisis regex.'));
    }
    step(2, 'Analizando con regex (fallback)');
  }

  const { extractSubjectName, extractBibliographySection } = await import('./pdf-parser.js');
  const { parseBibliography } = await import('./bibliography.js');

  const subject = extractSubjectName(text, {});
  const bibSection = extractBibliographySection(text);

  if (!bibSection) {
    console.log(chalk.yellow('  No se encontro seccion de bibliografia con regex'));
    return { subject, books: [] };
  }

  console.log(chalk.green('  Seccion de bibliografia localizada'));
  const books = parseBibliography(bibSection);
  console.log(chalk.green(`  ${books.length} libro(s) extraido(s)\n`));

  return { subject, books };
}

// --- Carga de .env ---

/**
 * Carga variables de entorno desde un archivo .env.
 * No sobreescribe variables ya existentes en el entorno.
 * @param {string} envPath
 */
function loadEnvFile(envPath) {
  if (!existsSync(envPath)) return;

  try {
    const content = readFileSync(envPath, 'utf-8');

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;

      const key = trimmed.substring(0, eqIdx).trim();
      const value = trimmed.substring(eqIdx + 1).trim().replace(/^["']|["']$/g, '');

      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // Silenciar errores al leer .env
  }
}

// --- Utilidades de presentacion ---

function printHeader() {
  console.log();
  console.log(chalk.bold.white('  BIBLIOMANIA'));
  console.log(chalk.gray('  Descarga automatica de bibliografia academica'));
  console.log(chalk.gray('  ETSISI - Universidad Politecnica de Madrid'));
  console.log(chalk.gray('  ' + '\u2500'.repeat(50)));
  console.log();
}

function printFooter(subject, total, local, downloaded, failed, indexed = 0) {
  console.log();
  console.log(chalk.gray('  ' + '\u2500'.repeat(50)));
  console.log(chalk.bold.white('  RESULTADO'));
  console.log(chalk.white(`  Asignatura:     ${subject}`));
  console.log(chalk.white(`  Total libros:   ${total}`));
  console.log(chalk.green(`  En biblioteca:  ${local}`));
  if (indexed > 0) {
    console.log(chalk.cyan(`  Desde indice:   ${indexed}`));
  }
  console.log(chalk.green(`  Descargados:    ${downloaded}`));
  if (failed > 0) {
    console.log(chalk.red(`  Fallidos:       ${failed}`));
  }
  console.log(chalk.gray(`  Destino:        ${BIBLIOTECA_DIR}/${subject}/`));
  console.log();
}

function step(num, message) {
  console.log(chalk.bold.white(`[${num}] ${message}`));
}

function fatal(message) {
  console.error(chalk.red(`\n  ERROR: ${message}\n`));
  process.exit(1);
}

function truncateUrl(url, max) {
  if (url.length <= max) return url;
  return url.substring(0, max - 3) + '...';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
