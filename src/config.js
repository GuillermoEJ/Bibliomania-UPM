// Configuracion central de Bibliomania

// Dominios de Anna's Archive ordenados por fiabilidad.
// Los dominios .org y .se fueron suspendidos en enero 2026.
// Actualizar esta lista si cambian: https://en.wikipedia.org/wiki/Anna%27s_Archive
// Nota: Si está bloqueado por firewall corporativo, intente usar un VPN
export const ANNAS_ARCHIVE_DOMAINS = [
  'annas-archive.gs',
  'annas-archive.vg',
  'annas-archive.pk',
  'annas-archive.gd',
  'annas-archive.net',
  'annas-archive.is',
  'annas-archive.how',
  'annas-archive.gg',
];

// Formatos de libro ordenados por preferencia
export const FORMAT_PRIORITY = ['pdf', 'epub', 'djvu', 'mobi', 'azw3'];

// Extensiones de archivo consideradas libros
export const BOOK_EXTENSIONS = ['.pdf', '.epub', '.djvu', '.mobi', '.azw3', '.cbr', '.cbz'];

// Palabras clave para detectar secciones de bibliografia en PDFs academicos
export const BIBLIOGRAPHY_HEADINGS = [
  'bibliograf',
  'referencias bibliogr',
  'libros recomendados',
  'libros de texto',
  'textos recomendados',
  'material bibliogr',
  'fuentes bibliogr',
  'bibliography',
  'references',
  'recommended reading',
  'lecturas recomendadas',
  'recursos bibliogr',
  'documentacion recomendada',
  'textos basicos',
  'textos complementarios',
  'manuales recomendados',
];

// Palabras clave que marcan el fin de la seccion de bibliografia
// (inicio de la siguiente seccion)
export const SECTION_END_KEYWORDS = [
  'metodolog',
  'evaluaci',
  'sistema de evaluaci',
  'criterios de evaluaci',
  'calificaci',
  'horario',
  'cronograma',
  'planificaci',
  'temporalizaci',
  'actividades',
  'competencias',
  'resultados de aprendizaje',
  'recursos',
  'tutoria',
  'profesorado',
  'datos de la asignatura',
  'contenido',
  'temario',
  'programa',
  'objetivos',
  'prerequisitos',
  'anexo',
];

// Encabezados que marcan sub-secciones dentro de la bibliografia
export const BIBLIOGRAPHY_SUBSECTIONS = [
  'basica',
  'fundamental',
  'obligatoria',
  'complementaria',
  'adicional',
  'opcional',
  'de consulta',
  'de referencia',
  'de apoyo',
];

// User-Agent para las peticiones HTTP
export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Tiempo de espera entre peticiones a Anna's Archive (ms) para no saturar
export const REQUEST_DELAY_MS = 2000;

// Numero maximo de reintentos por descarga
export const MAX_RETRIES = 2;

// Tiempo maximo de espera por peticion HTTP (ms)
export const REQUEST_TIMEOUT_MS = 30000;

// Umbral de similitud para considerar que un titulo coincide (0-1)
export const TITLE_SIMILARITY_THRESHOLD = 0.5;

// Directorio base de la biblioteca
export const BIBLIOTECA_DIR = 'Biblioteca';

// --- Groq LLM ---

// Modelo a usar en Groq (Llama 3.3 70B ofrece el mejor equilibrio calidad/velocidad)
export const GROQ_MODEL = 'llama-3.3-70b-versatile';

// Endpoint de la API (compatible con OpenAI)
export const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Maximo de caracteres del texto del PDF a enviar al LLM.
// Llama 3.3 70B soporta 128K tokens (~400K chars), pero limitamos
// para no desperdiciar el rate limit del tier gratuito.
export const GROQ_MAX_CHARS = 120000;
