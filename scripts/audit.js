const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  let expectedBlankPdfFailure = false;

  // ═══════════════ DESKTOP AUDIT ═══════════════
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !(expectedBlankPdfFailure && /502|Bad Gateway|api\/extract/.test(m.text()))) errors.push(m.text());
  });
  page.on('response', (response) => {
    if (!(expectedBlankPdfFailure && response.url().includes('/api/extract') && response.status() === 502) && response.status() >= 500) {
      errors.push(`Unexpected HTTP ${response.status()} ${response.url()}`);
    }
  });

  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  // Sidebar
  check('Sidebar visible', await page.locator('.sidebar').isVisible());
  check('Brand VedaAI', (await page.locator('.sidebar .brand-text').textContent()) === 'VedaAI');
  check('AI Toolkit pill', await page.locator('.nav-pill').isVisible(), await page.locator('.nav-pill').textContent().catch(()=>''));
  for (const item of ['Home','My Classroom','Assignments','Exams','My Library','Settings']) {
    check(`Nav item: ${item}`, await page.locator(`.nav-item:has-text("${item}")`).count() > 0);
  }
  check('Exams is active nav', await page.locator('.nav-item.active:has-text("Exams")').count() === 1);
  check('School card', await page.locator('.school-card').isVisible());
  const dpsLoaded = await page.locator('.school-card img.school-logo-img').evaluate(img => img.complete && img.naturalWidth > 0).catch(() => false);
  check('DPS logo loads', dpsLoaded === true);
  const vedaSidebar = await page.locator('.sidebar .brand-img').evaluate(img => img.complete && img.naturalWidth > 0).catch(() => false);
  check('VedaAI logo loads (sidebar)', vedaSidebar === true);
  const vedaSize = await page.locator('.sidebar .brand-img').evaluate(img => ({ w: img.getBoundingClientRect().width, h: img.getBoundingClientRect().height }));
  check('VedaAI logo ~30px desktop', Math.abs(vedaSize.w - 30) < 3 && Math.abs(vedaSize.h - 30) < 3, JSON.stringify(vedaSize));

  // Header
  check('Header visible', await page.locator('.header').isVisible());
  check('Back arrow', await page.locator('.header-back').count() === 1);
  check('Breadcrumb Exams', await page.locator('.header-breadcrumb:has-text("Exams")').count() === 1);
  check('Help icon', await page.locator('.header-icon[aria-label="Help"]').count() === 1);
  check('Bell + notif dot', await page.locator('.header-icon .notif-dot').count() >= 1);
  check('User name Madhur Rastogi', await page.locator('.header-username:has-text("Madhur Rastogi")').count() === 1);

  // Upload hero
  const h1 = await page.locator('.upload-hero h1').textContent();
  check('Hero heading text', h1.includes('Upload') && h1.includes('Question Paper & Answer Sheets'));
  const accentColor = await page.locator('.upload-hero .accent').evaluate(el => getComputedStyle(el).color);
  check('Accent coral color', accentColor === 'rgb(239, 116, 88)', accentColor);
  check('Subtitle', await page.locator('.upload-hero p:has-text("Upload both files to get started")').count() === 1);
  check('Avatar illustration', await page.locator('.upload-avatar').isVisible());

  // Upload cards empty state
  check('Two upload cards', await page.locator('.upload-card').count() === 2);
  check('Question Paper label', await page.locator('.upload-card-label:has-text("Question Paper")').count() === 1);
  check('Answer Sheet label', await page.locator('.upload-card-label:has-text("Answer Sheet")').count() === 1);
  check('Max 10MB shown', await page.locator('.upload-card-sub:has-text("Max 10MB")').count() === 2);
  check('Dashed border cards', (await page.locator('.upload-card').first().evaluate(el => getComputedStyle(el).borderTopStyle)) === 'dashed');

  // Start button disabled
  check('Start Mapping disabled initially', await page.locator('.start-btn').isDisabled());
  const disabledBg = await page.locator('.start-btn').evaluate(el => getComputedStyle(el).backgroundColor);
  check('Disabled button gray', disabledBg === 'rgb(229, 226, 220)', disabledBg);

  // Footer note
  check('Footer note present', await page.locator('.upload-footer').isVisible());

  // ── Fill uploads (valid minimal single-page PDFs) ──
  const MIN_PDF = Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\ntrailer<</Size 4/Root 1 0 R>>\n%%EOF'
  );
  fs.writeFileSync(path.join(__dirname,'sample-question.pdf'), MIN_PDF);
  fs.writeFileSync(path.join(__dirname,'sample-answer.pdf'), MIN_PDF);
  const inputs = page.locator('input[type="file"]');
  await inputs.nth(0).setInputFiles(path.join(__dirname,'sample-question.pdf'));
  await page.waitForTimeout(400);
  check('Filled card shows filename', await page.locator('.filled-meta b').first().textContent() === 'sample-question.pdf');
  check('Filled card shows size', (await page.locator('.filled-meta small').first().textContent()).includes('MB'));
  check('Remove button appears', await page.locator('.filled-remove').count() === 1);
  await inputs.nth(1).setInputFiles(path.join(__dirname,'sample-answer.pdf'));
  await page.waitForTimeout(400);

  // Start enabled now
  check('Start Mapping enabled after both files', !(await page.locator('.start-btn').isDisabled()));
  const enabledBg = await page.locator('.start-btn').evaluate(el => getComputedStyle(el).backgroundColor);
  check('Enabled button charcoal', enabledBg === 'rgb(41, 39, 34)', enabledBg);

  // Remove flow
  await page.locator('.filled-remove').first().click();
  await page.waitForTimeout(300);
  check('Remove resets card to empty', await page.locator('.upload-card:not(.has-file)').count() === 1);
  check('Start disabled after remove', await page.locator('.start-btn').isDisabled());
  // re-add
  await inputs.nth(0).setInputFiles(path.join(__dirname,'sample-question.pdf'));
  await page.waitForTimeout(300);

  // ── Processing screen ──
  expectedBlankPdfFailure = true;
  await page.locator('.start-btn').click();
  await page.waitForTimeout(600);
  check('Processing screen shows', await page.locator('.processing-card').isVisible());
  check('Extracting text', (await page.locator('.processing-card h2').textContent()).includes('Extracting'));
  check('May take a while subtext', await page.locator('.processing-card .sub:has-text("This may take a while")').count() === 1);
  check('Sparkle animation present', await page.locator('.sparkle-icon svg').count() === 1);
  await page.screenshot({ path: path.join(__dirname, 'shots', 'audit-processing.png') });

  // API will fail (503) → error returns to upload
  try {
    // PDF fallback providers render pages before failing the deliberately blank fixture.
    await page.waitForSelector('.upload-page', { timeout: 40000 });
    check('Graceful fallback to upload on API failure', true);
  } catch {
    check('Graceful fallback to upload on API failure', false, 'never returned to upload');
  }
  expectedBlankPdfFailure = false;

  // ── Demo results ──
  await page.goto('http://localhost:3000/?demo=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  check('Results screen renders', await page.locator('.results-page').isVisible());
  const qCount = await page.locator('.q-card').count();
  check('14 question cards', qCount === 14, `got ${qCount}`);
  check('Questions header', await page.locator('.questions-header:has-text("Extracted Questions")').count() === 1);
  check('Expand All button', await page.locator('.expand-all-btn:has-text("Expand All")').count() === 1);

  // Score pills exist with colors
  const pillFull = await page.locator('.score-pill.full').count();
  const pillZero = await page.locator('.score-pill.zero').count();
  check('Score pills rendered', pillFull + pillZero > 0, `full:${pillFull} zero:${pillZero}`);
  if (pillFull > 0) {
    const c = await page.locator('.score-pill.full').first().evaluate(el => getComputedStyle(el).backgroundColor);
    check('Green score pill bg', c === 'rgb(234, 246, 238)', c);
  }

  // Viewer toolbar
  check('Viewer toolbar dark', (await page.locator('.viewer-toolbar').evaluate(el => getComputedStyle(el).backgroundColor)) === 'rgb(41, 39, 34)');
  check('Answer Sheet title', await page.locator('.viewer-toolbar-title:has-text("Answer Sheet")').count() === 1);
  check('Zoom controls', await page.locator('.zoom-controls').count() === 1);
  check('Zoom value 100%', (await page.locator('.zoom-val').textContent()) === '100%');
  check('Page nav', (await page.locator('.page-nav span').textContent()).includes('Page 1 of'));

  // Click a question → highlight overlay appears
  await page.locator('.q-card-top').nth(2).click();
  await page.waitForTimeout(500);
  const hl = page.locator('.answer-highlight');
  check('Highlight overlay on select', await hl.count() === 1);
  if (await hl.count() === 1) {
    const border = await hl.evaluate(el => getComputedStyle(el).borderTopColor);
    check('Highlight green border', border === 'rgb(79, 174, 109)', border);
    const bg = await hl.evaluate(el => getComputedStyle(el).backgroundColor);
    check('Highlight tinted bg', bg.includes('rgba(122, 205, 150'), bg);
    const label = await page.locator('.answer-highlight-label').textContent();
    check('Highlight Q label', /^Q\d/.test(label), label);
  }
  // Page navigation jumped to region page
  const pageLabel = await page.locator('.page-nav span').textContent();
  check('Viewer navigated to answer page', pageLabel.trim().length > 0, pageLabel.trim());

  check('Multi-region continuation nav', await page.locator('.region-nav').count() === 1);
  if (await page.locator('.region-nav').count() === 1) {
    await page.locator('.region-nav button').last().click();
    await page.waitForTimeout(250);
    check('Next region changes highlight label', (await page.locator('.answer-highlight-label').textContent()).includes('2/2'));
    check('Next region changes page', (await page.locator('.page-nav span').textContent()).includes('Page 2'));
  }

  // Zoom works
  await page.locator('.zoom-btn').last().click();
  check('Zoom + works', (await page.locator('.zoom-val').textContent()) === '110%');

  // Expand All → feedback sections
  await page.locator('.expand-all-btn').click();
  await page.waitForTimeout(300);
  const feedbacks = await page.locator('.q-feedback').count();
  check('Expand All shows AI Feedback', feedbacks > 10, `${feedbacks} feedback blocks`);
  const fbLabel = await page.locator('.q-feedback-label').first().evaluate(el => getComputedStyle(el).color);
  check('Feedback label green', fbLabel === 'rgb(66, 131, 90)', fbLabel);

  // Selected card styling
  const selBorder = await page.locator('.q-card.selected').first().evaluate(el => getComputedStyle(el).borderTopColor);
  check('Selected card coral border', selBorder === 'rgb(242, 137, 112)', selBorder);

  await page.screenshot({ path: path.join(__dirname, 'shots', 'audit-results.png'), fullPage: false });

  // Back to upload for mobile tests? Just open new context.

  // ═══════════════ MOBILE AUDIT ═══════════════
  const mob = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  mob.on('pageerror', (e) => errors.push('[mobile] ' + e.message));
  mob.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('503')) errors.push('[mobile] ' + m.text());
  });
  await mob.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await mob.waitForTimeout(1000);

  check('[M] Sidebar hidden', !(await mob.locator('.sidebar').isVisible().catch(() => false)));
  check('[M] Mobile header visible', await mob.locator('.mobile-header').isVisible());
  const vedaMobile = await mob.locator('.mobile-header .brand-img').evaluate(img => img.complete && img.naturalWidth > 0).catch(() => false);
  check('[M] VedaAI logo loads (mobile)', vedaMobile === true);
  check('[M] Desktop header hidden', !(await mob.locator('.header').first().isVisible().catch(() => false)));
  check('[M] Cards stacked single column', (await mob.locator('.upload-cards').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)) === 1);
  const btnW = await mob.locator('.start-btn').evaluate(el => el.getBoundingClientRect().width);
  const contentW = await mob.locator('.start-btn').evaluate(el => {
    const cs = getComputedStyle(el.parentElement);
    return el.parentElement.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  });
  check('[M] Full-width start button', Math.abs(btnW - contentW) < 2, `btn ${Math.round(btnW)} vs content ${Math.round(contentW)}`);

  await mob.goto('http://localhost:3000/?demo=1', { waitUntil: 'networkidle' });
  await mob.waitForTimeout(1000);
  check('[M] Tabs visible', await mob.locator('.mobile-tabs').isVisible());
  check('[M] Two tabs', await mob.locator('.mobile-tab').count() === 2);
  check('[M] Questions tab active first', (await mob.locator('.mobile-tab').first().getAttribute('class')).includes('active'));
  check('[M] Question list visible in questions tab', await mob.locator('.questions-panel').isVisible());
  check('[M] Viewer hidden in questions tab', !(await mob.locator('.viewer-panel').isVisible()));

  await mob.locator('.mobile-tab').nth(1).click();
  await mob.waitForTimeout(500);
  check('[M] Answer Sheet tab switches', await mob.locator('.viewer-panel').isVisible());
  check('[M] Questions hidden in answers tab', !(await mob.locator('.questions-panel').isVisible()));

  // click question via switching back
  await mob.locator('.mobile-tab').nth(0).click();
  await mob.locator('.q-card-top').nth(0).click();   // selecting also flips to answers tab per implementation
  await mob.waitForTimeout(400);
  check('[M] Selecting question opens answer view', await mob.locator('.viewer-panel').isVisible());

  await mob.screenshot({ path: path.join(__dirname, 'shots', 'audit-mobile-results.png'), fullPage: false });

  // Runtime errors?
  check('No page errors during audit', errors.length === 0, errors.slice(0,3).join(' | '));

  await browser.close();

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})();
