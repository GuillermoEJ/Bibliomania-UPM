import { readdirSync, statSync } from 'node:fs';
import { join, extname, basename, relative } from 'node:path';
import { BOOK_EXTENSIONS, BIBLIOTECA_DIR, TITLE_SIMILARITY_THRESHOLD } from './config.js';

/**
 * Busca recursivamente en /Biblioteca si un libro ya existe.
 * Usa coincidencia difusa por titulo para cubrir variaciones de nombres de archivo.
 *
 * @param {string} bookTitle - Titulo del libro a buscar
 * @param {string} basePath - Ruta base del proyecto (donde esta /Biblioteca)
 * @returns {{found: boolean, path: string|null, filename: string|null}}
 */
export function findBookInLibrary(bookTitle, basePath) {
  const bibliotecaPath = join(basePath, BIBLIOTECA_DIR);

  let allBooks;
  try {
    allBooks = scanDirectory(bibliotecaPath);
  } catch {
    return { found: false, path: null, filename: null };
  }

  if (allBooks.length === 0) {
    return { found: false, path: null, filename: null };
  }

  const normalizedSearch = normalizeForMatch(bookTitle);
  let bestMatch = null;
  let bestScore = 0;

  for (const bookPath of allBooks) {
    const filename = basename(bookPath, extname(bookPath));
    const normalizedFilename = normalizeForMatch(filename);

    const score = calculateSimilarity(normalizedSearch, normalizedFilename);

    if (score > bestScore && score >= TITLE_SIMILARITY_THRESHOLD) {
      bestScore = score;
      bestMatch = bookPath;
    }
  }

  if (bestMatch) {
    return {
      found: true,
      path: relative(basePath, bestMatch),
      filename: basename(bestMatch),
    };
  }

  return { found: false, path: null, filename: null };
}

/**
 * Lista todos los libros encontrados en /Biblioteca.
 * @param {string} basePath - Ruta base del proyecto
 * @returns {Array<{path: string, filename: string, subject: string}>}
 */
export function listAllBooks(basePath) {
  const bibliotecaPath = join(basePath, BIBLIOTECA_DIR);
  let files;
  try {
    files = scanDirectory(bibliotecaPath);
  } catch {
    return [];
  }

  return files.map((filePath) => {
    const relPath = relative(basePath, filePath);
    const parts = relPath.split(/[/\\]/);
    return {
      path: relPath,
      filename: basename(filePath),
      subject: parts.length > 1 ? parts[1] : '(raiz)',
    };
  });
}

/**
 * Escanea recursivamente un directorio buscando archivos de libros.
 * @param {string} dirPath
 * @returns {string[]}
 */
function scanDirectory(dirPath) {
  const results = [];

  let entries;
  try {
    entries = readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);

    if (entry.isDirectory()) {
      results.push(...scanDirectory(fullPath));
    } else if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase();
      if (BOOK_EXTENSIONS.includes(ext)) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

/**
 * Normaliza un texto para comparacion difusa.
 * @param {string} text
 * @returns {string}
 */
function normalizeForMatch(text) {
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
 * Calcula la similitud entre dos cadenas usando coeficiente de Dice
 * basado en bigramas. Devuelve un valor entre 0 y 1.
 * @param {string} str1
 * @param {string} str2
 * @returns {number}
 */
function calculateSimilarity(str1, str2) {
  if (str1 === str2) return 1;
  if (str1.length < 2 || str2.length < 2) return 0;

  if (str1.includes(str2) || str2.includes(str1)) {
    const shorter = Math.min(str1.length, str2.length);
    const longer = Math.max(str1.length, str2.length);
    return shorter / longer;
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
