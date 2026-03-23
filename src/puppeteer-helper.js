/**
 * Módulo para acceder a Anna's Archive usando Puppeteer para evitar protección de Cloudflare
 */

import puppeteer from 'puppeteer';
import chalk from 'chalk';

let browser = null;

/**
 * Inicializa el navegador Puppeteer
 */
export async function initBrowser() {
  if (browser) return browser;

  console.log(chalk.gray('  Inicializando navegador...'));

  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-web-resources',
        '--disable-dev-shm-usage',
      ],
    });

    console.log(chalk.green('  ✓ Navegador iniciado'));
    return browser;
  } catch (err) {
    console.error(chalk.red(`  Error al iniciar navegador: ${err.message}`));
    throw err;
  }
}

/**
 * Cierra el navegador
 */
export async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

/**
 * Realiza una búsqueda usando Puppeteer
 * @param {string} query
 * @param {string[]} domains - Lista de dominios a intentar
 * @returns {Promise<{html: string, domain: string, error: string|null}>}
 */
export async function searchWithPuppeteer(query, domains) {
  const b = await initBrowser();
  let lastError = null;
  let blockedByFirewall = false;

  for (const domain of domains) {
    try {
      const url = `https://${domain}/search?q=${encodeURIComponent(query)}&lang=&content=book_nonfiction&ext=&sort=`;

      const page = await b.newPage();

      try {
        // Configurar timeout y viewport
        await page.setViewport({ width: 1280, height: 720 });
        page.setDefaultTimeout(30000);
        page.setDefaultNavigationTimeout(30000);

        // Navegar con espera a que la red esté quieta
        console.log(chalk.gray(`  Accediendo a ${domain}...`));

        await page.goto(url, {
          waitUntil: 'networkidle2',
          timeout: 15000,
        });

        // Esperar a que carguen los resultados
        try {
          await page.waitForSelector('a[href*="/md5/"]', { timeout: 5000 });
        } catch {
          // Si no encuentra enlaces en 5 segundos, procede igualmente
        }

        // Obtener el HTML
        const html = await page.content();

        // Detectar si está bloqueado por Zscaler o similar firewall
        if (html.includes('Zscaler') || html.includes('zscaler') || html.includes('Internet Security')) {
          blockedByFirewall = true;
          lastError = `${domain}: Bloqueado por firewall corporativo (Zscaler)`;
          console.log(chalk.red(`  ❌ ${lastError}`));
          await page.close();
          continue;
        }

        console.log(chalk.green(`  ✓ Búsqueda en ${domain} exitosa`));

        await page.close();

        return {
          html,
          domain,
          error: null,
        };
      } finally {
        if (!page.isClosed()) {
          await page.close();
        }
      }
    } catch (err) {
      lastError = `${domain}: ${err.message}`;
      console.log(chalk.yellow(`  ⚠ ${lastError}`));
    }
  }

  const errorMsg = blockedByFirewall
    ? 'Anna\'s Archive está bloqueado por firewall corporativo. Intente usar un VPN.'
    : lastError || 'Todos los dominios fallaron';

  return {
    html: null,
    domain: null,
    error: errorMsg,
  };
}
