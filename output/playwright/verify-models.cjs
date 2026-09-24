async (page) => {
  const checks = [];
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
    checks.push(message);
  };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.reload();
  await page.getByLabel('测试模型', { exact: true }).waitFor();
  check(await page.evaluate(() => window.modelTest.calls.every(c => !c.command.startsWith('fetch_'))), 'No automatic model requests');

  for (const [tab, prefix, keyPlaceholder] of [
    ['ChatGPT (Codex)', 'codex', 'CUSTOM_OPENAI_API_KEY'],
    ['Claude Code', 'claude', 'ANTHROPIC_AUTH_TOKEN'],
  ]) {
    await page.getByRole('button', { name: tab, exact: true }).click();
    const input = page.getByLabel('测试模型', { exact: true });
    const fetchButton = page.getByRole('button', { name: '获取模型列表', exact: true });
    const keyInput = page.getByPlaceholder(keyPlaceholder, { exact: true });
    await input.waitFor();
    await keyInput.fill('');
    await fetchButton.click();
    await page.getByText('请先填写 API Key', { exact: true }).waitFor();
    await keyInput.fill('test-key');
    await fetchButton.click();
    await page.getByRole('button', { name: '选择模型', exact: true }).waitFor();
    check(await input.inputValue() === '', `${tab}: fetch leaves model selection unchanged`);
    check(await page.evaluate((prefix) => window.modelTest.calls.some(c => c.command === `fetch_${prefix}_models` && c.args.apiKey === 'test-key'), prefix), `${tab}: camelCase fetch arguments`);
    await page.getByRole('button', { name: '选择模型', exact: true }).click();
    await page.getByPlaceholder('搜索模型...').fill('OpenAI');
    await page.getByRole('option', { name: 'gpt-5-codex', exact: true }).waitFor();
    check(await page.getByRole('option').count() === 1, `${tab}: vendor search filters models`);
    await page.getByPlaceholder('搜索模型...').fill('no-matching-model');
    await page.getByText('未找到匹配的模型', { exact: true }).waitFor();
    await page.getByPlaceholder('搜索模型...').fill('claude');
    await page.getByPlaceholder('搜索模型...').press('ArrowDown');
    await page.getByPlaceholder('搜索模型...').press('Enter');
    check(await input.inputValue() === 'claude-opus-5', `${tab}: keyboard selection fills the input`);
    await input.fill('manual-model');
    await page.evaluate(() => { window.modelTest.testSuccess = false; });
    await page.getByRole('button', { name: '保存配置', exact: true }).click();
    await page.getByText('测试失败: HTTP 401', { exact: true }).waitFor();
    check(await page.evaluate(prefix => window.modelTest.calls.every(c => c.command !== `set_${prefix}_config`), prefix), `${tab}: failed Hi test prevents saving`);
    await page.evaluate(() => { window.modelTest.testSuccess = true; });
    await page.getByRole('button', { name: '保存配置', exact: true }).click();
    await page.waitForFunction(prefix => window.modelTest.calls.some(c => c.command === `set_${prefix}_config`), prefix);
    check(await page.evaluate(prefix => {
      const calls = window.modelTest.calls;
      const index = calls.findIndex(c => c.command === `set_${prefix}_config`);
      return calls[index - 1].command === `test_${prefix}_config` && calls[index - 1].args.model === 'manual-model';
    }, prefix), `${tab}: manual model is tested before saving`);
  }

  const fetchButton = page.getByRole('button', { name: '获取模型列表', exact: true });
  for (const [error, message] of [
    ['HTTP 401', 'API Key 无效或无权限'],
    ['All candidates failed: HTTP 404', '未找到可用的模型列表端点，请检查 Base URL 或确认供应商是否开放该接口'],
    ['Request timeout', '请求超时，请检查网络连接'],
    ['Failed to parse response', '该供应商不支持获取模型列表'],
    ['connection failed', '获取模型列表失败'],
  ]) {
    await page.evaluate(error => { window.modelTest.mode = error; }, error);
    await fetchButton.click();
    await page.getByText(message, { exact: true }).waitFor();
    check(await page.getByRole('button', { name: '选择模型', exact: true }).count() === 1, `Failed refresh preserves fetched list: ${error}`);
  }
  await page.evaluate(() => { window.modelTest.mode = 'empty'; });
  await fetchButton.click();
  await page.getByText('未找到可用模型', { exact: true }).waitFor();
  check(await page.getByRole('button', { name: '选择模型', exact: true }).count() === 0, 'Empty results do not show preset models');

  await page.evaluate(() => { window.modelTest.mode = 'delayed'; });
  await fetchButton.click();
  check(await fetchButton.isDisabled(), 'Fetch button disabled while loading');
  await page.getByRole('button', { name: 'https://taijiai.online/', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.includes('获取模型列表') && !button.disabled));
  await page.evaluate(() => window.modelTest.resolve([{ id: 'stale-model', ownedBy: null }]));
  check(await page.getByRole('button', { name: '选择模型', exact: true }).count() === 0, 'Old endpoint response is ignored');
  check(await fetchButton.isEnabled(), 'New endpoint can fetch immediately');

  await page.evaluate(() => { window.modelTest.mode = 'success'; });
  await fetchButton.click();
  for (const [width, height] of [[460, 500], [520, 640], [480, 580], [375, 812], [1280, 800]]) {
    await page.setViewportSize({ width, height });
    await page.getByRole('button', { name: '选择模型', exact: true }).click();
    await page.getByPlaceholder('搜索模型...').waitFor();
    await page.screenshot({ path: `output/playwright/model-picker-${width}.png` });
    const bounds = await page.getByRole('dialog').boundingBox();
    check(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= height, `Model picker fits ${width}x${height}`);
    await page.getByPlaceholder('搜索模型...').press('Escape');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No horizontal overflow at ${width}px`);
  }
  check(errors.length === 0, `No runtime errors: ${errors.join('; ')}`);
  console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
}
