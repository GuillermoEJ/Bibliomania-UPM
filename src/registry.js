/**
 * Registro compartido de libros descargados.
 *
 * Mantiene un indice en Biblioteca/index.json que se comparte via Git.
 * Los binarios de los libros se ignoran en .gitignore, pero el indice
 * permite que otros usuarios salten la busqueda en Anna's Archive
 * y descarguen directamente usando el hash MD5 almacenado.
 *
 * Ademas, se almacena el SHA-256 de cada archivo para verificar
 * integridad tras la descarga.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { BIBLIOTECA_DIR, TITLE_SIMILARITY_THRESHOLD } from './config.js';

const INDEX_FILENAME = 'index.json';

/**
 * @typedef {Object} IndexEntry
 * @property {string} title - Titulo del libro
 * @property {string|null} author - Autor(es)
 * @property {string|null} isbn - ISBN
 * @property {string|null} year - Anio de publicacion
 * @property {string|null} publisher - Editorial
 * @property {string} format - Formato del archivo (pdf, epub, etc.)
 * @property {number} size_bytes - Tamano en bytes
 * @property {string} sha256 - Hash SHA-256 del archivo descargado
 * @property {string} subject - Nombre de la asignatura
 * @property {string} path - Ruta relativa dentro de Biblioteca/
 * @property {string|null} anna_md5 - Hash MD5 de Anna's Archive (para descarga directa)
 * @property {string} added_at - Fecha ISO 8601 de registro
 */

/**
 * @typedef {Object} BookIndex
 * @property {number} version - Version del esquema
 * @property {string} updated_at - Ultima actualizacion ISO 8601
 * @property {IndexEntry[]} books - Entradas de libros
 */

/**
 * Carga el indice desde disco. Si no existe, devuelve uno vacio.
 * @param {string} basePath - Ruta base del proyecto
 * @returns {BookIndex}
 */
export function loadIndex(basePath) {
  const indexPath = join(basePath, BIBLIOTECA_DIR, INDEX_FILENAME);

  if (!existsSync(indexPath)) {
    return createEmptyIndex();
  }

  try {
    const raw = readFileSync(indexPath, 'utf-8');
    const data = JSON.parse(raw);

    if (!data || typeof data.version !== 'number' || !Array.isArray(data.books)) {
      return createEmptyIndex();
    }

    return data;
  } catch {
    return createEmptyIndex();
  }
}

/**
 * Guarda el indice en disco con formato legible.
 * @param {string} basePath - Ruta base del proyecto
 * @param {BookIndex} index - Indice a guardar
 */
export function saveIndex(basePath, index) {
  const indexPath = join(basePath, BIBLIOTECA_DIR, INDEX_FILENAME);
  index.updated_at = new Date().toISOString();
  writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n', 'utf-8');
}

/**
 * Registra un libro en el indice. Evita duplicados por SHA-256 o titulo normalizado.
 *
 * @param {BookIndex} index - Indice actual (se muta en lugar)
 * @param {Object} bookInfo
 * @param {string} bookInfo.title
 * @param {string|null} bookInfo.author
 * @param {string|null} bookInfo.isbn
 * @param {string|null} bookInfo.year
 * @param {string|null} bookInfo.publisher
 * @param {string} bookInfo.format
 * @param {number} bookInfo.sizeBytes
 * @param {string} bookInfo.sha256
 * @param {string} bookInfo.subject
 * @param {string} bookInfo.filePath - Ruta absoluta del archivo descargado
 * @param {string|null} bookInfo.annaMd5 - Hash MD5 de Anna's Archive
 * @param {string} basePath - Ruta base del proyecto
 * @returns {boolean} true si se anadio, false si ya existia
 */
export function registerBook(index, bookInfo, basePath) {
  const relPath = relative(
    join(basePath, BIBLIOTECA_DIR),
    bookInfo.filePath
  ).replace(/\\/g, '/');

  // Deduplicar por SHA-256
  const existsBySha = index.books.some(
    (b) => b.sha256 === bookInfo.sha256
  );
  if (existsBySha) return false;

  // Deduplicar por titulo normalizado
  const normalizedTitle = normalizeForIndex(bookInfo.title);
  const existsByTitle = index.books.some(
    (b) => normalizeForIndex(b.title) === normalizedTitle
  );
  if (existsByTitle) return false;

  /** @type {IndexEntry} */
  const entry = {
    title: bookInfo.title,
    author: bookInfo.author || null,
    isbn: bookInfo.isbn || null,
    year: bookInfo.year || null,
    publisher: bookInfo.publisher || null,
    format: bookInfo.format,
    size_bytes: bookInfo.sizeBytes,
    sha256: bookInfo.sha256,
    subject: bookInfo.subject,
    path: relPath,
    anna_md5: bookInfo.annaMd5 || null,
    added_at: new Date().toISOString(),
  };

  index.books.push(entry);
  return true;
}

/**
 * Busca un libro en el indice por titulo (coincidencia difusa).
 *
 * @param {string} title - Titulo a buscar
 * @param {BookIndex} index - Indice cargado
 * @returns {{found: boolean, entry: IndexEntry|null, score: number}}
 */
export function findBookInIndex(title, index) {
  if (index.books.length === 0) {
    return { found: false, entry: null, score: 0 };
  }

  const normalizedSearch = normalizeForIndex(title);
  let bestEntry = null;
  let bestScore = 0;

  for (const entry of index.books) {
    const normalizedEntry = normalizeForIndex(entry.title);
    const score = diceCoefficient(normalizedSearch, normalizedEntry);

    if (score > bestScore && score >= TITLE_SIMILARITY_THRESHOLD) {
      bestScore = score;
      bestEntry = entry;
    }
  }

  if (bestEntry) {
    return { found: true, entry: bestEntry, score: bestScore };
  }

  return { found: false, entry: null, score: 0 };
}

/**
 * Calcula el hash SHA-256 de un archivo.
 * @param {string} filePath - Ruta absoluta al archivo
 * @returns {Promise<string>} Hash en hexadecimal
 */
export function computeFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);

    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * Crea un indice vacio con la estructura base.
 * @returns {BookIndex}
 */
function createEmptyIndex() {
  return {
    version: 1,
    updated_at: new Date().toISOString(),
    books: [],
  };
}

/**
 * Normaliza un texto para comparacion en el indice.
 * @param {string} text
 * @returns {string}
 */
function normalizeForIndex(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(the|a|an|el|la|los|las|un|una|de|del|y|and|or|o)\b/g, '')
    .replace(/\b\d+(st|nd|rd|th|a|era)?\s*(edition|edicion|ed)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Coeficiente de Dice basado en bigramas.
 * @param {string} str1
 * @param {string} str2
 * @returns {number} Valor entre 0 y 1
 */
function diceCoefficient(str1, str2) {
  if (str1 === str2) return 1;
  if (str1.length < 2 || str2.length < 2) return 0;

  if (str1.includes(str2) || str2.includes(str1)) {
    return Math.min(str1.length, str2.length) / Math.max(str1.length, str2.length);
  }

  const bigrams1 = getBigrams(str1);
  const bigrams2 = getBigrams(str2);

  let intersection = 0;
  const map2 = new Map();

  for (const bg of bigrams2) {
    map2.set(bg, (map2.get(bg) || 0) + 1);
  }

  for (const bg of bigrams1) {
    const count = map2.get(bg);
    if (count && count > 0) {
      intersection++;
      map2.set(bg, count - 1);
    }
  }

  return (2 * intersection) / (bigrams1.length + bigrams2.length);
}

/**
 * Genera bigramas de una cadena.
 * @param {string} str
 * @returns {string[]}
 */
function getBigrams(str) {
  const bigrams = [];
  for (let i = 0; i < str.length - 1; i++) {
    bigrams.push(str.substring(i, i + 2));
  }
  return bigrams;
}
