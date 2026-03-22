# Bibliomania

Herramienta de linea de comandos para la descarga automatica de bibliografia recomendada a partir de guias de estudio de la ETSISI (Universidad Politecnica de Madrid).

Bibliomania recibe un PDF de guia de estudios, analiza su contenido con un LLM (Llama 3.3 70B via Groq) para extraer el nombre de la asignatura y la lista de libros de la bibliografia, comprueba cuales ya estan disponibles en la biblioteca local o en el indice compartido, y descarga los que faltan desde Anna's Archive.

---

## Requisitos

- Node.js 20 o superior
- Cuenta en Groq (gratuita) para la API key del LLM
- Conexion a internet

## Instalacion

```bash
git clone <url-del-repositorio>
cd Bibliomania
npm install
```

### Configurar API key de Groq

1. Crear una cuenta gratuita en [console.groq.com](https://console.groq.com)
2. Generar una API key en [console.groq.com/keys](https://console.groq.com/keys)
3. Copiar el archivo de ejemplo y pegar la key:

```bash
cp .env.example .env
```

4. Editar `.env` y reemplazar el valor:

```
GROQ_API_KEY=gsk_tu_api_key_real
```

El tier gratuito de Groq es suficiente para uso normal. Sin API key, Bibliomania funciona con un analizador regex de fallback (menos preciso).

## Uso

```bash
node src/index.js <ruta-al-pdf>
```

### Ejemplo

```bash
node src/index.js "guias/Bases de Datos - Guia de Estudio 2025-2026.pdf"
```

### Opciones

| Opcion | Descripcion |
|---|---|
| `-n, --nombre <nombre>` | Nombre de la asignatura (si no se detecta automaticamente del PDF) |
| `-s, --solo-buscar` | Solo identificar y buscar libros, sin descargar nada |
| `--no-cache` | No comprobar la biblioteca local antes de descargar |
| `--no-llm` | No usar el LLM, forzar analisis regex |
| `-V, --version` | Mostrar version |
| `-h, --help` | Mostrar ayuda |

### Ejemplos

Forzar el nombre de la asignatura:

```bash
node src/index.js guia.pdf --nombre "Sistemas Operativos"
```

Solo ver que libros se encontrarian sin descargar nada:

```bash
node src/index.js guia.pdf --solo-buscar
```

Forzar analisis regex (sin LLM):

```bash
node src/index.js guia.pdf --no-llm
```

---

## Como funciona

Bibliomania ejecuta los siguientes pasos en orden:

1. **Extraccion de texto**: Lee el PDF y extrae todo el texto con `pdf-parse`.
2. **Analisis con LLM**: Envia el texto a Llama 3.3 70B (via Groq) que identifica el nombre de la asignatura y extrae todos los libros de la seccion de bibliografia con sus metadatos (titulo, autor, anio, ISBN, editorial). Si el LLM no esta disponible, se usa un analizador regex como fallback.
3. **Comprobacion local e indice**: Para cada libro, comprueba si ya existe un archivo en `Biblioteca/` (coincidencia difusa por titulo) o si esta registrado en el indice compartido.
4. **Descarga**: Los libros que no se encuentran se buscan en Anna's Archive, priorizando formato PDF y con fallback a EPUB y otros formatos. Los libros que estan en el indice se descargan directamente sin necesidad de busqueda.
5. **Registro**: Cada libro descargado se registra en el indice compartido con su hash SHA-256 para integridad y el MD5 de Anna's Archive para futuras descargas directas.

### Analisis LLM vs regex

| | LLM (Groq) | Regex (fallback) |
|---|---|---|
| Precision | Alta. Entiende contexto y variaciones de formato | Baja. Depende de patrones predefinidos |
| Requisitos | API key de Groq | Ninguno |
| Velocidad | 2-5 segundos | Instantaneo |
| Formatos soportados | Cualquier formato de bibliografia | Solo formatos comunes (APA, IEEE, listas) |

El LLM se usa por defecto cuando `GROQ_API_KEY` esta configurada. Si la llamada falla (red, rate limit), se cae automaticamente al regex sin intervencion del usuario.

---

## Indice compartido

Bibliomania mantiene un archivo `Biblioteca/index.json` que actua como registro de todos los libros descargados. Este archivo se comparte via Git (los binarios de los libros no).

### Flujo entre usuarios

1. El usuario A ejecuta Bibliomania y descarga 5 libros. Se registran en `index.json`.
2. El usuario A hace commit y push de `index.json`.
3. El usuario B hace pull y obtiene el indice actualizado.
4. El usuario B ejecuta Bibliomania con la misma guia (u otra que incluya los mismos libros). Bibliomania detecta que esos libros ya estan en el indice y los descarga directamente usando el MD5 almacenado, sin necesidad de busqueda.

### Que contiene el indice

Cada entrada registra:

- Titulo, autor, ISBN, anio y editorial
- Formato y tamano del archivo
- Hash SHA-256 (integridad)
- Hash MD5 de Anna's Archive (descarga directa)
- Asignatura de origen
- Fecha de registro

### Que NO va en Git

Los archivos de libros (`.pdf`, `.epub`, `.djvu`, `.mobi`, `.azw3`, `.cbr`, `.cbz`) estan en `.gitignore`. Solo el indice y la estructura de carpetas se comparten.

---

## Estructura del proyecto

```
Bibliomania/
  package.json
  .env.example          # Plantilla para la API key de Groq
  .env                  # API key real (no va en Git)
  .gitignore
  Biblioteca/
    index.json          # Indice compartido de libros
    .gitkeep
    <asignatura>/       # Carpetas creadas al descargar (no en Git)
      libro1.pdf
      libro2.epub
  src/
    index.js            # Punto de entrada CLI, orquesta el flujo completo
    config.js           # Constantes: dominios, formatos, umbrales, LLM
    llm.js              # Integracion con Groq (Llama 3.3 70B)
    pdf-parser.js       # Extraccion de texto del PDF
    bibliography.js     # Parseo regex de bibliografia (fallback)
    library.js          # Busqueda de libros existentes en Biblioteca/ (fuzzy matching)
    registry.js         # Gestion del indice compartido (index.json)
    anna.js             # Scraping de Anna's Archive con failover entre dominios
    downloader.js       # Descarga HTTP con barra de progreso y reintentos
```

## Configuracion

Las constantes principales estan en `src/config.js`:

| Constante | Valor por defecto | Descripcion |
|---|---|---|
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | Modelo de Groq para el analisis |
| `GROQ_MAX_CHARS` | `120000` | Maximo de caracteres del PDF enviados al LLM |
| `ANNAS_ARCHIVE_DOMAINS` | `gs`, `vg`, `pk`, `gd` | Dominios de Anna's Archive con failover automatico |
| `FORMAT_PRIORITY` | `pdf, epub, djvu, mobi, azw3` | Orden de preferencia de formatos |
| `TITLE_SIMILARITY_THRESHOLD` | `0.5` | Umbral de similitud (Dice coefficient) para coincidencia de titulos |
| `REQUEST_DELAY_MS` | `2000` | Pausa entre peticiones a Anna's Archive (ms) |
| `MAX_RETRIES` | `2` | Reintentos por descarga fallida |
| `REQUEST_TIMEOUT_MS` | `30000` | Timeout por peticion HTTP (ms) |

Los dominios de Anna's Archive cambian con frecuencia. Consultar la pagina de Wikipedia del proyecto para actualizaciones: https://en.wikipedia.org/wiki/Anna%27s_Archive

## Formatos soportados

Bibliomania busca libros en Anna's Archive priorizando los siguientes formatos, en este orden:

1. PDF
2. EPUB
3. DJVU
4. MOBI
5. AZW3

Si un libro no esta disponible en PDF, se descarga automaticamente en el siguiente formato disponible.

---

## Licencia

MIT
