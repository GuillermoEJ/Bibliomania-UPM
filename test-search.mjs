import * as cheerio from 'cheerio';
import { writeFileSync } from 'fs';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
};

const query = 'Silberschatz Operating System Concepts';

// Test .vg - it returned 523KB
console.log('=== Testing annas-archive.vg ===');
try {
  const url = `https://annas-archive.vg/search?q=${encodeURIComponent(query)}&content=book_nonfiction`;
  const r = await fetch(url, { headers, redirect: 'follow' });
  const html = await r.text();
  
  console.log('Status:', r.status, 'Length:', html.length);
  
  console.log('\nContains /md5/:', html.includes('/md5/'));
  console.log('Contains md5:', html.includes('md5'));
  console.log('Contains Silberschatz:', html.includes('Silberschatz'));
  console.log('Contains captcha:', html.includes('captcha'));
  console.log('Contains cloudflare:', html.includes('cloudflare'));
  console.log('Contains challenge:', html.includes('challenge'));
  console.log('Contains blocked:', html.includes('blocked'));
  
  const $ = cheerio.load(html);
  console.log('\nPage title:', $('title').text());
  
  const hrefs = new Set();
  $('a[href]').each((_i, el) => {
    hrefs.add($(el).attr('href'));
  });
  console.log('\nUnique href count:', hrefs.size);
  const hrefList = [...hrefs].slice(0, 30);
  console.log('Sample hrefs:', hrefList);
  
  writeFileSync('test-response.html', html.substring(0, 8000));
  console.log('\nSaved first 8000 chars to test-response.html');
} catch (e) {
  console.log('ERROR:', e.message);
}

// Also test .pk 403 page
console.log('\n=== Testing annas-archive.pk (403 analysis) ===');
try {
  const url = `https://annas-archive.pk/search?q=${encodeURIComponent(query)}&content=book_nonfiction`;
  const r = await fetch(url, { headers, redirect: 'follow' });
  const html = await r.text();
  
  console.log('Status:', r.status);
  console.log('Contains captcha:', html.includes('captcha'));
  console.log('Contains challenge:', html.includes('challenge'));
  console.log('First 500 chars:', html.substring(0, 500));
} catch (e) {
  console.log('ERROR:', e.message);
}
