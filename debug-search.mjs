import * as cheerio from 'cheerio';
import {
  ANNAS_ARCHIVE_DOMAINS,
  USER_AGENT,
  REQUEST_TIMEOUT_MS,
} from './src/config.js';

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

async function testSearch() {
  const query = 'Don Quixote';
  const params = new URLSearchParams({
    q: query,
    lang: '',
    content: 'book_nonfiction',
    ext: '',
    sort: '',
  });

  for (const domain of ANNAS_ARCHIVE_DOMAINS) {
    const url = `https://${domain}/search?${params}`;
    console.log(`\n\n═══ Probando: ${domain} ═══`);
    console.log(`URL: ${url}\n`);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await fetch(url, {
        headers: HEADERS,
        signal: controller.signal,
        redirect: 'follow',
      });

      clearTimeout(timeout);

      if (!response.ok) {
        console.log(`❌ HTTP ${response.status}`);
        continue;
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      console.log(`✓ Respuesta recibida (${html.length} bytes)`);
      console.log(`\n📋 Estructura del HTML:`);

      // Buscar elementos importantes
      const mdLinks = $('a[href*="/md5/"]');
      console.log(`  • Enlaces /md5/: ${mdLinks.length}`);

      const allLinks = $('a[href]');
      console.log(`  • Total enlaces: ${allLinks.length}`);

      const resultsDiv = $('[class*="result"], [class*="search-result"], [class*="book"]');
      console.log(`  • Divs con clase result/search-result/book: ${resultsDiv.length}`);

      // Mostrar primeros 5 enlaces con /md5/
      console.log(`\n📚 Primeros 5 enlaces encontrados:`);
      mdLinks.slice(0, 5).each((i, elem) => {
        const $elem = $(elem);
        const href = $elem.attr('href');
        const text = $elem.text().trim().substring(0, 60);
        console.log(`  ${i + 1}. href: ${href}`);
        console.log(`     texto: ${text}...`);
      });

      // Si no encontró /md5/, mostrar resultado de búsqueda alternativo
      if (mdLinks.length === 0) {
        console.log(`\n⚠️  No se encontraron enlaces /md5/`);
        console.log(`\n📄 Primeros 10 enlaces en la página:`);
        allLinks.slice(0, 10).each((i, elem) => {
          const href = $(elem).attr('href');
          const text = $(elem).text().trim().substring(0, 40);
          console.log(`  ${i + 1}. ${href} -> "${text}"`);
        });

        // Mostrar estructura HTML general
        console.log(`\n🔍 Primeros 2000 caracteres del HTML:`);
        console.log(html.substring(0, 2000));
      }

      return; // Salir después de la primera búsqueda exitosa
    } catch (err) {
      console.log(`❌ Error: ${err.message}`);
    }
  }
}

testSearch().catch(console.error);
