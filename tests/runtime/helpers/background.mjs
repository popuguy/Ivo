/** Opt-in background mode for explicitly qualified component runners only. */
export const backgroundTest = process.env.IVO_TEST_BACKGROUND === '1';
export function prepareBackgroundTest(app) {
  if (!backgroundTest) return;
  console.log(
    'Background component mode: hidden offscreen windows; native activation prohibited on macOS.',
  );
  if (process.platform === 'darwin') app.setActivationPolicy('prohibited');
  app.on('browser-window-created', (_event, window) => {
    const check = () => {
      try {
        assertBackgroundWindow(window);
      } catch (error) {
        console.error(error.message);
        app.exit(1);
      }
    };
    window.on('show', check);
    window.on('focus', check);
    check();
  });
}
export function testWindowOptions(options) {
  return backgroundTest
    ? {
        ...options,
        show: false,
        webPreferences: {
          ...options.webPreferences,
          offscreen: true,
          backgroundThrottling: false,
        },
      }
    : options;
}
export function focusTestWindow(window) {
  if (!backgroundTest) window.focus();
  window.webContents.focus();
}
export function assertBackgroundWindow(window) {
  if (backgroundTest && (window.isVisible() || window.isFocused()))
    throw Error('A background component test displayed or focused a native window');
}
