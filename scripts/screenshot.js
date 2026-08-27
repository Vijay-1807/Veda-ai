const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const out = path.join(__dirname, 'shots');
  require('fs').mkdirSync(out, { recursive: true });

  // ── DESKTOP ─────────────────────────────────────────────
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  desktop.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text()); });
  desktop.on('pageerror', (e) => console.log('[pageerror]', e.message));

  await desktop.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await desktop.waitForTimeout(1500);
  await desktop.screenshot({ path: path.join(out, 'desktop-upload-empty.png'), fullPage: true });

  // Upload filled state — attach files
  const inputs = desktop.locator('input[type="file"]');
  const count = await inputs.count();
  console.log('file inputs found:', count);
  if (count >= 2) {
    await inputs.nth(0).setInputFiles(path.join(__dirname, 'sample-question.pdf')).catch(async () => {
      // create dummy pdf if missing
      require('fs').writeFileSync(path.join(__dirname, 'sample-question.pdf'), '%PDF-1.4 test question paper content');
      await inputs.nth(0).setInputFiles(path.join(__dirname, 'sample-question.pdf'));
    });
    await desktop.waitForTimeout(500);
    await inputs.nth(1).setInputFiles(path.join(__dirname, 'sample-answer.pdf')).catch(async () => {
      require('fs').writeFileSync(path.join(__dirname, 'sample-answer.pdf'), '%PDF-1.4 student handwritten answer sheet');
      await inputs.nth(1).setInputFiles(path.join(__dirname, 'sample-answer.pdf'));
    });
    await desktop.waitForTimeout(800);
    await desktop.screenshot({ path: path.join(out, 'desktop-upload-filled.png'), fullPage: true });

    // Click Start Mapping -> processing state
    const btn = desktop.locator('.start-btn');
    if (await btn.isEnabled()) {
      await btn.click();
      await desktop.waitForTimeout(1200);
      await desktop.screenshot({ path: path.join(out, 'desktop-processing.png') });

      // Wait for either results or error
      try {
        await desktop.waitForSelector('.results-page', { timeout: 90000 });
        await desktop.waitForTimeout(1000);
        await desktop.screenshot({ path: path.join(out, 'desktop-results.png'), fullPage: false });

        // Click second question
        const cards = desktop.locator('.q-card-top');
        if ((await cards.count()) > 1) {
          await cards.nth(1).click();
          await desktop.waitForTimeout(800);
          await desktop.screenshot({ path: path.join(out, 'desktop-results-q2.png') });
        }
        // Expand a card
        const expandBtns = desktop.locator('.q-expand-icon');
        if ((await expandBtns.count()) > 0) {
          await expandBtns.first().click();
          await desktop.waitForTimeout(400);
          await desktop.screenshot({ path: path.join(out, 'desktop-results-expanded.png') });
        }
      } catch {
        await desktop.screenshot({ path: path.join(out, 'desktop-after-processing-timeout.png'), fullPage: true });
        console.log('Results screen did not appear within 90s — likely API error (no key configured).');
      }
    } else {
      console.log('Start Mapping button still disabled after uploads!');
    }
  }

  // Demo results (no upload)
  const demoLink = true;
  if (demoLink) {
    await desktop.goto('http://localhost:3000/?demo=1', { waitUntil: 'networkidle' });
    await desktop.waitForTimeout(1500);
    await desktop.screenshot({ path: path.join(out, 'desktop-demo-results.png') });
    const cards = desktop.locator('.q-card-top');
    console.log('demo question cards:', await cards.count());
    if ((await cards.count()) > 2) {
      await cards.nth(2).click();
      await desktop.waitForTimeout(800);
      await desktop.screenshot({ path: path.join(out, 'desktop-demo-q3.png') });
    }
  }

  // ── MOBILE ──────────────────────────────────────────────
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  mobile.on('pageerror', (e) => console.log('[mobile pageerror]', e.message));
  await mobile.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await mobile.waitForTimeout(1200);
  await mobile.screenshot({ path: path.join(out, 'mobile-upload-empty.png'), fullPage: true });

  const minputs = mobile.locator('input[type="file"]');
  if ((await minputs.count()) >= 2) {
    require('fs').writeFileSync(path.join(__dirname, 'sample-question.pdf'), '%PDF-1.4 q');
    require('fs').writeFileSync(path.join(__dirname, 'sample-answer.pdf'), '%PDF-1.4 a');
    await minputs.nth(0).setInputFiles(path.join(__dirname, 'sample-question.pdf'));
    await minputs.nth(1).setInputFiles(path.join(__dirname, 'sample-answer.pdf'));
    await mobile.waitForTimeout(600);
    await mobile.screenshot({ path: path.join(out, 'mobile-upload-filled.png'), fullPage: true });
  }

  const mdemo = true;
  if (mdemo) {
    await mobile.goto('http://localhost:3000/?demo=1', { waitUntil: 'networkidle' });
    await mobile.waitForTimeout(1500);
    await mobile.screenshot({ path: path.join(out, 'mobile-demo-results.png') });
    const tabs = mobile.locator('.mobile-tab');
    console.log('mobile tabs:', await tabs.count());
    if ((await tabs.count()) === 2) {
      await tabs.nth(1).click(); // Answer Sheet tab
      await mobile.waitForTimeout(700);
      await mobile.screenshot({ path: path.join(out, 'mobile-demo-answersheet.png') });
    }
  }

  await browser.close();
  console.log('DONE. Screenshots in', out);
})();
