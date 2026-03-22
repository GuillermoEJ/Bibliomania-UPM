/**
 * Integracion con LLM (Groq) para extraccion inteligente de bibliografia.
 *
 * Reemplaza el parsing regex por una llamada a Llama 3.3 70B via Groq,
 * que extrae nombre de asignatura y lista de libros con metadatos
 * de forma mucho mas fiable independientemente del formato del PDF.
 */

import chalk from 'chalk';
import { GROQ_API_URL, GROQ_MODEL, GROQ_MAX_CHARS } from './config.js';

const SYSTEM_PROMPT = `Eres un extractor de bibliografia academica. Analizas guias de estudio de la ETSISI (Escuela Tecnica Superior de Ingenieria de Sistemas Informaticos) de la Universidad Politecnica de Madrid.

Dado el texto crudo de un PDF de guia de estudios, extrae:
1. El nombre exacto de la asignatura
2. Todos los libros mencionados en la seccion de bibliografia o referencias

Devuelve UNICAMENTE JSON valido con este formato exacto:
{
  "subject": "Nombre de la Asignatura",
  "books": [
    {
      "title": "Titulo completo del libro",
      "author": "Nombre(s) del autor(es)",
      "year": "2024",
      "isbn": "9781234567890",
      "publisher": "Editorial"
    }
  ]
}

Reglas:
- Extrae TODOS los libros de la seccion de bibliografia, no solo los primeros
- Si un campo no se encuentra en el texto, usa null
- El ISBN debe ser solo digitos, sin guiones
- El titulo debe ser el titulo real y completo del libro, no una abreviacion
- Si hay sub-secciones (basica, complementaria, obligatoria, opcional), incluye los libros de todas
- NO incluyas URLs, apuntes del profesor, slides ni recursos online
- Devuelve SOLO el JSON, sin bloques de codigo markdown, sin explicacion, sin texto adicional`;

/**
 * @typedef {Object} LLMBookEntry
 * @property {string} title
 * @property {string|null} author
 * @property {string|null} year
 * @property {string|null} isbn
 * @property {string|null} publisher
 * @property {string} searchQuery - Consulta optimizada para busqueda (calculada post-LLM)
 * @property {string} raw - Representacion textual de la entrada
 */

/**
 * @typedef {Object} LLMExtractionResult
 * @property {string|null} subject - Nombre de la asignatura
 * @property {LLMBookEntry[]} books - Libros extraidos
 * @property {boolean} fromLLM - true si se uso LLM, false si es fallback
 */

/**
 * Extrae nombre de asignatura y bibliografia usando Groq LLM.
 *
 * @param {string} pdfText - Texto crudo extraido del PDF
 * @returns {Promise<LLMExtractionResult>}
 * @throws {Error} Si la API falla o la respuesta no es parseable
 */
export async function extractBibliographyWithLLM(pdfText) {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    throw new Error('GROQ_API_KEY no configurada');
  }

  const truncatedText = pdfText.length > GROQ_MAX_CHARS
    ? pdfText.substring(0, GROQ_MAX_CHARS) + '\n\n[TEXTO TRUNCADO]'
    : pdfText;

  console.log(chalk.gray(`  Enviando ${Math.round(truncatedText.length / 1024)}KB de texto a ${GROQ_MODEL}...`));

  const body = {
    model: GROQ_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Analiza el siguiente texto de una guia de estudios y extrae la asignatura y todos los libros de la bibliografia:\n\n${truncatedText}`,
      },
    ],
    temperature: 0.1,
    max_tokens: 4096,
    response_format: { type: 'json_object' },
  };

  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`Groq API error HTTP ${response.status}: ${errorBody.substring(0, 200)}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('Respuesta vacia del LLM');
  }

  const parsed = parseResponse(content);

  console.log(chalk.gray(`  Tokens: ${data.usage?.prompt_tokens || '?'} entrada, ${data.usage?.completion_tokens || '?'} salida`));

  return parsed;
}

/**
 * Parsea la respuesta JSON del LLM y normaliza los datos.
 *
 * @param {string} content - Respuesta cruda del LLM
 * @returns {LLMExtractionResult}
 */
function parseResponse(content) {
  // Limpiar posibles bloques de codigo markdown
  let cleaned = content.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  let json;
  try {
    json = JSON.parse(cleaned);
  } catch {
    throw new Error(`El LLM no devolvio JSON valido: ${cleaned.substring(0, 100)}...`);
  }

  const subject = typeof json.subject === 'string' ? json.subject.trim() : null;
  const rawBooks = Array.isArray(json.books) ? json.books : [];

  const books = rawBooks
    .filter((b) => b && typeof b.title === 'string' && b.title.trim().length > 2)
    .map((b) => normalizeBookEntry(b));

  return { subject, books, fromLLM: true };
}

/**
 * Normaliza una entrada de libro del LLM al formato esperado por el pipeline.
 *
 * @param {Object} raw - Entrada cruda del LLM
 * @returns {LLMBookEntry}
 */
function normalizeBookEntry(raw) {
  const title = String(raw.title || '').trim();
  const author = normalizeField(raw.author);
  const year = normalizeField(raw.year);
  const publisher = normalizeField(raw.publisher);

  let isbn = normalizeField(raw.isbn);
  if (isbn) {
    isbn = isbn.replace(/[-\s]/g, '');
    if (!/^\d{10,13}$/.test(isbn)) {
      isbn = null;
    }
  }

  const searchQuery = buildSearchQuery(title, author, isbn);
  const authorStr = author ? ` - ${author}` : '';
  const yearStr = year ? ` (${year})` : '';

  return {
    title,
    author,
    year,
    isbn,
    publisher,
    searchQuery,
    raw: `${title}${authorStr}${yearStr}`,
  };
}

/**
 * Normaliza un campo que puede ser null, undefined, "null", o string vacio.
 * @param {*} value
 * @returns {string|null}
 */
function normalizeField(value) {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (str === '' || str.toLowerCase() === 'null' || str.toLowerCase() === 'n/a') return null;
  return str;
}

/**
 * Construye una query de busqueda optimizada para Anna's Archive.
 * @param {string} title
 * @param {string|null} author
 * @param {string|null} isbn
 * @returns {string}
 */
function buildSearchQuery(title, author, isbn) {
  if (isbn) return isbn;

  const parts = [];
  if (title) parts.push(title);
  if (author) {
    const surname = author.split(/[,\s]/)[0];
    if (surname && surname.length > 1) parts.push(surname);
  }

  return parts.join(' ').substring(0, 150);
}

/**
 * Comprueba si la API key de Groq esta configurada.
 * @returns {boolean}
 */
export function isLLMAvailable() {
  return Boolean(process.env.GROQ_API_KEY);
}
