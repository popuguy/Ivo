/**
 * Chromium's Cocoa forceTouchEvent reads this NSUserDefaults key before opening
 * Look Up. Electron writes the current application's preference domain, never
 * NSGlobalDomain. Disable the gesture throughout Ivo so pressure cannot steal
 * the editor's retained selection/IME owner. Explicit dictionary commands remain.
 */
export function configureTextInput(systemPreferences, platform = process.platform) {
  if (platform === 'darwin')
    systemPreferences.setUserDefault('com.apple.trackpad.forceClick', 'integer', 0);
}
