import { readFile } from 'node:fs/promises';
import pdf from 'pdf-parse';
import {
  BIBLIOGRAPHY_HEADINGS,
  SECTION_END_KEYWORDS,
} from './config.js';

/**
 * Extrae el texto completo de un archivo PDF.
 * @param {string} pdfPath - Ruta al archivo PDF
 * @returns {Promise<{text: string, metadata: object}>}
 */
export async function extractTextFromPdf(pdfPath) {
  const buffer = await readFile(pdfPath);
  const data = await pdf(buffer);

  return {
    text: data.text,
    metadata: {
      title: data.info?.Title || null,
      author: data.info?.Author || null,
      subject: data.info?.Subject || null,
      pages: data.numpages,
    },
  };
}

/**
 * Intenta extraer el nombre de la asignatura del contenido del PDF.
 * Busca patrones comunes en guias de estudio de la ETSISI/UPM.
 * @param {string} text - Texto completo del PDF
 * @param {object} metadata - Metadatos del PDF
 * @returns {string|null}
 */
export function extractSubjectName(text, metadata) {
  // Intentar desde metadatos primero
  if (metadata.title && metadata.title.length > 3 && metadata.title.length < 120) {
    return cleanSubjectName(metadata.title);
  }
  if (metadata.subject && metadata.subject.length > 3 && metadata.subject.length < 120) {
    return cleanSubjectName(metadata.subject);
  }

  // Buscar patrones comunes en el texto
  const patterns = [
    /gu[ií]a\s+(?:de\s+(?:la\s+)?)?(?:asignatura|estudio)[s]?\s*[:\-]\s*(.+)/i,
    /asignatura\s*[:\-]\s*(.+)/i,
    /nombre\s+de\s+la\s+asignatura\s*[:\-]\s*(.+)/i,
    /materia\s*[:\-]\s*(.+)/i,
    /denominaci[oó]n\s*[:\-]\s*(.+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const name = match[1].trim();
      if (name.length > 2 && name.length < 120) {
        return cleanSubjectName(name);
      }
    }
  }

  return null;
}

/**
 * Limpia el nombre de la asignatura para uso como nombre de carpeta.
 * @param {string} name
 * @returns {string}
 */
function cleanSubjectName(name) {
  return name
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/[.\n]/)[0]
    .trim();
}

/**
 * Localiza y extrae la seccion de bibliografia del texto del PDF.
 * Busca encabezados tipicos y extrae todo el texto hasta la siguiente seccion.
 * @param {string} text - Texto completo del PDF
 * @returns {string|null} - Texto de la seccion de bibliografia, o null si no se encuentra
 */
export function extractBibliographySection(text) {
  const lines = text.split('\n');
  let startIndex = -1;
  let endIndex = lines.length;
  let matchedHeading = '';

  for (let i = 0; i < lines.length; i++) {
    const lineLower = normalizeForSearch(lines[i]);

    if (lineLower.length < 3) continue;

    for (const heading of BIBLIOGRAPHY_HEADINGS) {
      if (lineLower.includes(heading)) {
        if (lines[i].trim().length < 80 || isUpperCase(lines[i])) {
          startIndex = i;
          matchedHeading = heading;
          break;
        }
      }
    }
    if (startIndex !== -1) break;
  }

  if (startIndex === -1) {
    return null;
  }

  for (let i = startIndex + 1; i < lines.length; i++) {
    const lineLower = normalizeForSearch(lines[i]);

    if (lineLower.length < 3) continue;

    for (const keyword of SECTION_END_KEYWORDS) {
      if (lineLower.includes(keyword) && !lineLower.includes(matchedHeading)) {
        if (lines[i].trim().length < 80 || isUpperCase(lines[i])) {
          endIndex = i;
          break;
        }
      }
    }
    if (endIndex !== lines.length) break;
  }

  const section = lines.slice(startIndex, endIndex).join('\n').trim();
  return section.length > 10 ? section : null;
}

/**
 * Normaliza texto para busqueda: quita acentos, pasa a minusculas.
 * @param {string} str
 * @returns {string}
 */
function normalizeForSearch(str) {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Comprueba si una linea esta mayoritariamente en mayusculas.
 * @param {string} line
 * @returns {boolean}
 */
function isUpperCase(line) {
  const letters = line.replace(/[^a-zA-Z\u00C0-\u024F]/g, '');
  if (letters.length < 3) return false;
  const upper = letters.replace(/[^A-Z\u00C0-\u00DE]/g, '');
  return upper.length / letters.length > 0.6;
}
