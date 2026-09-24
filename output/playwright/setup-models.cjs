async (page) => {
  await page.addInitScript(() => {
    window.modelTest = {
      calls: [],
      mode: 'success',
      testSuccess: true,
      models: [
        { id: 'claude-opus-5', ownedBy: 'Anthropic' },
        { id: 'gpt-5-codex', ownedBy: 'OpenAI' },
        { id: 'private-model', ownedBy: null },
      ],
    };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      invoke: async (command, args) => {
        const state = window.modelTest;
        state.calls.push({ command, args });
        if (command.startsWith('get_')) return {
          base_url: 'https://bob-api.com/', api_key: 'test-key',
          config_exists: true, config_path: 'C:/model-test/config.json',
        };
        if (command === 'check_bob_api_network') return { reachable: true };
        if (/^(fetch_|test_|set_)/.test(command) && !args.apiKey) {
          throw new Error('Missing camelCase apiKey argument');
        }
        if (command.startsWith('fetch_')) {
          if (state.mode === 'delayed') {
            return new Promise((resolve) => { state.resolve = resolve; });
          }
          if (state.mode === 'empty') return [];
          if (state.mode !== 'success') throw new Error(state.mode);
          return state.models;
        }
        if (command.startsWith('test_')) return {
          success: state.testSuccess, message: state.testSuccess ? 'ok' : 'HTTP 401',
        };
        if (command.startsWith('set_')) return;
        throw new Error(`Unexpected command: ${command}`);
      },
    };
  });
  await page.setViewportSize({ width: 460, height: 500 });
  await page.goto('http://127.0.0.1:3031/');
}
