/**
 * Parsea el texto crudo de una seccion de bibliografia y extrae entradas
 * individuales de libros con sus metadatos.
 */

/**
 * @typedef {Object} BookEntry
 * @property {string} title - Titulo del libro
 * @property {string|null} author - Autor(es)
 * @property {string|null} year - Anio de publicacion
 * @property {string|null} isbn - ISBN si se encuentra
 * @property {string|null} publisher - Editorial
 * @property {string} raw - Linea original sin procesar
 * @property {string} searchQuery - Consulta optimizada para busqueda
 */

/**
 * Parsea el texto de la seccion de bibliografia y extrae entradas de libros.
 * @param {string} sectionText - Texto crudo de la seccion de bibliografia
 * @returns {BookEntry[]}
 */
export function parseBibliography(sectionText) {
  const lines = sectionText.split('\n');
  const entries = [];
  let currentEntry = '';

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      if (currentEntry) {
        const entry = parseEntry(currentEntry);
        if (entry) entries.push(entry);
        currentEntry = '';
      }
      continue;
    }

    if (isSectionHeading(trimmed)) {
      if (currentEntry) {
        const entry = parseEntry(currentEntry);
        if (entry) entries.push(entry);
        currentEntry = '';
      }
      continue;
    }

    if (isEntryStart(trimmed) && currentEntry) {
      const entry = parseEntry(currentEntry);
      if (entry) entries.push(entry);
      currentEntry = cleanEntryPrefix(trimmed);
    } else if (!currentEntry) {
      currentEntry = cleanEntryPrefix(trimmed);
    } else {
      currentEntry += ' ' + trimmed;
    }
  }

  if (currentEntry) {
    const entry = parseEntry(currentEntry);
    if (entry) entries.push(entry);
  }

  return deduplicateEntries(entries);
}

/**
 * Comprueba si una linea es un encabezado de seccion/subseccion.
 * @param {string} line
 * @returns {boolean}
 */
function isSectionHeading(line) {
  const normalized = line
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const headingPatterns = [
    /^bibliograf/i,
    /^referencia/i,
    /^libros?\s+(recomendado|basico|complementario|de\s+texto|obligatorio)/i,
    /^textos?\s+(recomendado|basico|complementario|obligatorio)/i,
    /^material\s+bibliogr/i,
    /^b[aá]sica\s*$/i,
    /^complementaria\s*$/i,
    /^obligatoria\s*$/i,
    /^opcional\s*$/i,
    /^de\s+consulta\s*$/i,
  ];

  return headingPatterns.some((p) => p.test(normalized)) && line.length < 60;
}

/**
 * Detecta si una linea parece el inicio de una nueva entrada bibliografica.
 * @param {string} line
 * @returns {boolean}
 */
function isEntryStart(line) {
  if (/^[-*\u2022\u2013\u2014]\s/.test(line)) return true;
  if (/^\d+[.)]\s/.test(line)) return true;
  if (/^\[\d+\]/.test(line)) return true;
  if (/^[A-Z\u00C0-\u00DE][a-z\u00E0-\u00FF]+\s*,\s*[A-Z]/.test(line)) return true;
  if (/^[A-Z\u00C0-\u00DE]{2,}[\s,]/.test(line)) return true;
  return false;
}

/**
 * Limpia prefijos de lista de una entrada (guiones, numeros, etc.)
 * @param {string} text
 * @returns {string}
 */
function cleanEntryPrefix(text) {
  return text
    .replace(/^[-*\u2022\u2013\u2014]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/^\[\d+\]\s*/, '')
    .trim();
}

/**
 * Parsea una entrada bibliografica individual y extrae metadatos.
 * @param {string} rawEntry
 * @returns {BookEntry|null}
 */
function parseEntry(rawEntry) {
  const text = rawEntry.trim();

  if (text.length < 10) return null;
  if (/^https?:\/\//i.test(text)) return null;

  const title = extractTitle(text);
  const author = extractAuthor(text);
  const year = extractYear(text);
  const isbn = extractIsbn(text);
  const publisher = extractPublisher(text);

  if (!title && !author) return null;

  const searchQuery = buildSearchQuery(title, author, isbn);

  return {
    title: title || text.substring(0, 80),
    author,
    year,
    isbn,
    publisher,
    raw: text,
    searchQuery,
  };
}

/**
 * Extrae el titulo del libro de una entrada bibliografica.
 * @param {string} text
 * @returns {string|null}
 */
function extractTitle(text) {
  const quotePatterns = [
    /["\u201C\u201D\u00AB\u00BB](.+?)["\u201C\u201D\u00AB\u00BB]/,
    /"(.+?)"/,
    /'(.+?)'/,
  ];

  for (const pattern of quotePatterns) {
    const match = text.match(pattern);
    if (match && match[1] && match[1].length > 3) {
      return match[1].trim();
    }
  }

  const authorTitleMatch = text.match(
    /^[A-Z\u00C0-\u024F][^.]+?\.\s*(.+?)(?:\.\s*(?:Ed|Editorial|McGraw|Pearson|Springer|Wiley|Addison|O'Reilly|Prentice|Cambridge|Oxford|Paraninfo|Ra-Ma|Anaya|Marcombo)|,\s*\d{4}|\.\s*\d{4}|\.\s*ISBN)/i
  );
  if (authorTitleMatch && authorTitleMatch[1] && authorTitleMatch[1].length > 3) {
    return authorTitleMatch[1].trim();
  }

  const parts = text.split(/[.,;]\s/);
  if (parts.length >= 2) {
    const candidate = parts.length > 1 ? parts[1] : parts[0];
    if (candidate && candidate.length > 5) {
      return candidate.trim();
    }
  }

  return null;
}

/**
 * Extrae el/los autor(es) de una entrada bibliografica.
 * @param {string} text
 * @returns {string|null}
 */
function extractAuthor(text) {
  const authorMatch = text.match(
    /^([A-Z\u00C0-\u024F][a-z\u00E0-\u00FF]+(?:\s+[A-Z\u00C0-\u024F][a-z\u00E0-\u00FF]+)*\s*,\s*[A-Z\u00C0-\u024F](?:[a-z\u00E0-\u00FF]*\.?\s*(?:y|and|&|,)\s*[A-Z\u00C0-\u024F][a-z\u00E0-\u00FF]*\.?|[a-z\u00E0-\u00FF]*\.?))/
  );
  if (authorMatch) {
    return authorMatch[1].trim();
  }

  const upperMatch = text.match(
    /^([A-Z\u00C0-\u00DE]{2,}(?:\s+[A-Z\u00C0-\u00DE]{2,})*(?:\s*,\s*[A-Z][a-z]*\.?)?)/
  );
  if (upperMatch && upperMatch[1].length > 2) {
    return upperMatch[1].trim();
  }

  const simpleMatch = text.match(
    /^([A-Z\u00C0-\u024F][a-z\u00E0-\u00FF]+(?:\s+[A-Z\u00C0-\u024F][a-z\u00E0-\u00FF]+){1,3})\s*[.,;:]/
  );
  if (simpleMatch) {
    return simpleMatch[1].trim();
  }

  return null;
}

/**
 * Extrae el anio de publicacion.
 * @param {string} text
 * @returns {string|null}
 */
function extractYear(text) {
  const yearMatch = text.match(/\((\d{4})\)/);
  if (yearMatch) return yearMatch[1];
  const yearLoose = text.match(/\b((?:19[5-9]\d|20[0-3]\d))\b/);
  if (yearLoose) return yearLoose[1];
  return null;
}

/**
 * Extrae el ISBN si esta presente.
 * @param {string} text
 * @returns {string|null}
 */
function extractIsbn(text) {
  const isbn13 = text.match(/ISBN[:\s-]*(\d[\d-]{11,16}\d)/i);
  if (isbn13) return isbn13[1].replace(/-/g, '');
  const isbn10 = text.match(/ISBN[:\s-]*(\d[\d-]{8,12}[\dXx])/i);
  if (isbn10) return isbn10[1].replace(/-/g, '');
  const bareIsbn = text.match(/\b(97[89][\d-]{10,14}\d)\b/);
  if (bareIsbn) return bareIsbn[1].replace(/-/g, '');
  return null;
}

/**
 * Extrae la editorial si esta presente.
 * @param {string} text
 * @returns {string|null}
 */
function extractPublisher(text) {
  const publishers = [
    'McGraw-Hill', 'McGraw Hill', 'Pearson', 'Springer', 'Wiley',
    'Addison-Wesley', 'Addison Wesley', "O'Reilly", 'Prentice Hall',
    'Prentice-Hall', 'Cambridge University Press', 'Oxford University Press',
    'Paraninfo', 'Ra-Ma', 'Anaya Multimedia', 'Marcombo', 'Sintesis',
    'Alianza Editorial', 'Akal', 'Ariel', 'Gustavo Gili', 'Reverte',
    'Academic Press', 'MIT Press', 'Manning', 'Packt', 'Apress',
    'No Starch Press', 'Cengage', 'Thomson', 'Elsevier',
  ];

  const textLower = text.toLowerCase();
  for (const pub of publishers) {
    if (textLower.includes(pub.toLowerCase())) {
      return pub;
    }
  }

  const edMatch = text.match(/(?:Ed\.|Editorial)\s+([A-Z\u00C0-\u024F][a-z\u00E0-\u00FF]+(?:\s+[A-Z\u00C0-\u024F][a-z\u00E0-\u00FF]+)*)/);
  if (edMatch) return edMatch[1];

  return null;
}

/**
 * Construye una query de busqueda optimizada para Anna's Archive.
 * @param {string|null} title
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
 * Elimina entradas duplicadas basandose en titulo similar.
 * @param {BookEntry[]} entries
 * @returns {BookEntry[]}
 */
function deduplicateEntries(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    const key = normalizeTitle(entry.title || entry.raw);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Normaliza un titulo para comparacion.
 * @param {string} title
 * @returns {string}
 */
function normalizeTitle(title) {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
