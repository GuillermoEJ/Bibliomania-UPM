import { searchWithPuppeteer, closeBrowser } from './src/puppeteer-helper.js';
import { ANNAS_ARCHIVE_DOMAINS } from './src/config.js';
import { writeFileSync } from 'fs';
import * as cheerio from 'cheerio';

async function testPuppeteerParsing() {
  console.log('Testing Puppeteer HTML parsing...\n');

  const query = 'Evolutionary Optimization';

  const result = await searchWithPuppeteer(query, ANNAS_ARCHIVE_DOMAINS);

  if (result.error) {
    console.error('Error:', result.error);
    return;
  }

  console.log(`✓ Got HTML from ${result.domain} (${result.html.length} bytes)\n`);

  // Save full HTML for inspection
  writeFileSync('debug-puppeteer-output.html', result.html);
  console.log('Saved full HTML to debug-puppeteer-output.html');

  // Parse with cheerio
  const $ = cheerio.load(result.html);

  // Check various selectors
  const results = {
    '/md5/ links': $('a[href*="/md5/"]').length,
    '/book/ links': $('a[href*="/book/"]').length,
    '/isbn/ links': $('a[href*="/isbn/"]').length,
    'All links': $('a[href]').length,
    'Divs with class': $('div[class]').length,
    'Has "search" in HTML': result.html.includes('search'),
    'Has "result" in HTML': result.html.includes('result'),
    'HTML size': result.html.length,
  };

  console.log('\nStructure analysis:');
  Object.entries(results).forEach(([key, val]) => {
    console.log(`  ${key}: ${val}`);
  });

  // Show first few links
  console.log('\nFirst 10 links:');
  const links = new Set();
  $('a[href]').each((i, elem) => {
    if (links.size < 10) {
      const href = $(elem).attr('href');
      const text = $(elem).text().trim().substring(0, 40);
      links.add(`${href} -> "${text}"`);
    }
  });

  [...links].forEach((link, i) => {
    console.log(`  ${i + 1}. ${link}`);
  });

  // Look for specific patterns
  console.log('\nSearching for result patterns:');
  const patterns = ['data-md5', 'data-book', 'class="result', 'class="book', 'role="listitem"'];
  patterns.forEach((pat) => {
    const count = (result.html.match(new RegExp(pat, 'g')) || []).length;
    console.log(`  "${pat}": ${count} occurrences`);
  });

  await closeBrowser();
}

testPuppeteerParsing().catch(console.error);
