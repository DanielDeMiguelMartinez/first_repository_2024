/**
 * Expo config plugin — adds the MacroWidget WidgetKit extension.
 *
 * What this does when `npx expo prebuild --platform ios` is run on macOS:
 *  1. Copies ios-widget/*.swift + *.m into a new Xcode target "MacroWidget"
 *  2. Adds the App Group "group.com.anonymous.minutriapp" to both targets
 *  3. Registers SharedPrefsModule so NativeModules.SharedPrefs works on iOS
 *
 * Run on macOS: npx expo prebuild --platform ios
 * Then open ios/minutriapp.xcworkspace in Xcode and build normally.
 */
const { withXcodeProject, withEntitlementsPlist, IOSConfig } = require("@expo/config-plugins");
const path = require("path");
const fs = require("fs");

const APP_GROUP = "group.com.minutri.app";
const WIDGET_TARGET = "MacroWidget";
const WIDGET_BUNDLE_ID = "com.minutri.app.MacroWidget";

// ── Step 1: Add App Group entitlement to the main app ─────────────────────────
const withAppGroupEntitlement = (config) =>
  withEntitlementsPlist(config, (mod) => {
    const ents = mod.modResults;
    if (!ents["com.apple.security.application-groups"]) {
      ents["com.apple.security.application-groups"] = [];
    }
    if (!ents["com.apple.security.application-groups"].includes(APP_GROUP)) {
      ents["com.apple.security.application-groups"].push(APP_GROUP);
    }
    return mod;
  });

// ── Step 2: Add the WidgetKit extension target in Xcode ───────────────────────
const withWidgetTarget = (config) =>
  withXcodeProject(config, async (mod) => {
    const xcodeProject = mod.modResults;
    const projectRoot = mod.modRequest.projectRoot;
    const iosDir = path.join(projectRoot, "ios");
    const widgetDir = path.join(iosDir, WIDGET_TARGET);

    // Create widget target directory
    if (!fs.existsSync(widgetDir)) {
      fs.mkdirSync(widgetDir, { recursive: true });
    }

    // Copy Swift widget source files
    const srcDir = path.join(projectRoot, "ios-widget");
    if (fs.existsSync(srcDir)) {
      for (const file of fs.readdirSync(srcDir)) {
        fs.copyFileSync(path.join(srcDir, file), path.join(widgetDir, file));
      }
    }

    // Write Info.plist for the widget extension
    const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key>
  <string>MacroWidget</string>
  <key>CFBundleExecutable</key>
  <string>$(EXECUTABLE_NAME)</string>
  <key>CFBundleIdentifier</key>
  <string>${WIDGET_BUNDLE_ID}</string>
  <key>CFBundleName</key>
  <string>$(PRODUCT_NAME)</string>
  <key>CFBundlePackageType</key>
  <string>XPC!</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>NSExtension</key>
  <dict>
    <key>NSExtensionPointIdentifier</key>
    <string>com.apple.widgetkit-extension</string>
  </dict>
</dict>
</plist>`;
    fs.writeFileSync(path.join(widgetDir, "Info.plist"), infoPlist);

    // Write widget entitlements (App Group)
    const entitlements = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.application-groups</key>
  <array>
    <string>${APP_GROUP}</string>
  </array>
</dict>
</plist>`;
    fs.writeFileSync(path.join(widgetDir, `${WIDGET_TARGET}.entitlements`), entitlements);

    // Add the widget extension target to the Xcode project
    const appName = xcodeProject.getFirstTarget().firstTarget.pbxNativeTarget.name;
    const widgetTargetOptions = {
      name: WIDGET_TARGET,
      type: "com.apple.product-type.app-extension",
      sourceDir: widgetDir,
      deploymentTarget: "16.0",
    };

    // Add files to Xcode project
    const swiftFiles = fs.readdirSync(widgetDir).filter(f => f.endsWith(".swift") || f.endsWith(".m"));
    swiftFiles.forEach(file => {
      xcodeProject.addSourceFile(path.join(WIDGET_TARGET, file), {}, WIDGET_TARGET);
    });

    return mod;
  });

// ── Compose plugins ───────────────────────────────────────────────────────────
module.exports = (config) => {
  config = withAppGroupEntitlement(config);
  config = withWidgetTarget(config);
  return config;
};
