async (page) => {
  await page.evaluate(() => { window.modelTest.mode = 'success'; });
  await page.getByRole('button', { name: '获取模型列表', exact: true }).click();
  await page.getByRole('button', { name: '选择模型', exact: true }).waitFor();
  const checks = [];
  for (const [width, height] of [[460, 500], [520, 640], [480, 580], [375, 812], [1280, 800]]) {
    await page.setViewportSize({ width, height });
    await page.getByRole('button', { name: '选择模型', exact: true }).click();
    await page.getByPlaceholder('搜索模型...').waitFor();
    await page.screenshot({ path: `output/playwright/model-picker-${width}.png` });
    const bounds = await page.getByRole('dialog').boundingBox();
    if (!bounds || bounds.x < 0 || bounds.y < 0 || bounds.x + bounds.width > width || bounds.y + bounds.height > height) {
      throw new Error(`Model picker outside viewport: ${width}x${height}: ${JSON.stringify(bounds)}`);
    }
    await page.getByPlaceholder('搜索模型...').press('Escape');
    if (!await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)) throw new Error(`Overflow at ${width}px`);
    checks.push(`${width}x${height}: picker fits, no horizontal overflow`);
  }
  console.log(JSON.stringify(checks));
}
