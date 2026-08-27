const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  for (const item of [
    { name: 'desk', viewport: { width: 1440, height: 787 }, mobile: false },
    { name: 'mob', viewport: { width: 393, height: 853 }, mobile: true },
  ]) {
    const page = await browser.newPage({ viewport: item.viewport, isMobile: item.mobile, hasTouch: item.mobile });
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `scripts/shots/reference-size-${item.name}-upload.png`, fullPage: false });
    await page.close();
  }
  await browser.close();
})();
