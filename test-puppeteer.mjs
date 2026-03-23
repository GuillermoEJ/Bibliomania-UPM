import { searchWithPuppeteer, closeBrowser } from './src/puppeteer-helper.js';
import { ANNAS_ARCHIVE_DOMAINS } from './src/config.js';
import * as cheerio from 'cheerio';

async function testPuppeteer() {
  console.log('🧪 Testing search con Puppeteer...\n');

  const query = 'Don Quixote';

  const result = await searchWithPuppeteer(query, ANNAS_ARCHIVE_DOMAINS);

  if (result.error) {
    console.error('❌ Error:', result.error);
    return;
  }

  console.log(`\n✓ Búsqueda exitosa en ${result.domain}`);
  console.log(`Tamaño del HTML: ${result.html.length} bytes\n`);

  // Parsear resultados
  const $ = cheerio.load(result.html);
  const mdLinks = $('a[href*="/md5/"]');

  console.log(`📚 Enlaces encontrados: ${mdLinks.length}\n`);

  if (mdLinks.length > 0) {
    console.log('Primeros 5 resultados:');
    mdLinks.slice(0, 5).each((i, elem) => {
      const $elem = $(elem);
      const href = $elem.attr('href');
      const text = $elem.text().trim().substring(0, 80);
      console.log(`  ${i + 1}. ${href}`);
      console.log(`     ${text}`);
    });
  } else {
    console.log('⚠️  No se encontraron enlaces /md5/');
    console.log('\n📄 Primeros 1000 caracteres del HTML:');
    console.log(result.html.substring(0, 1000));
  }

  await closeBrowser();
}

testPuppeteer().catch(console.error);
