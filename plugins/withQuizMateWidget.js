const fs = require('fs');
const path = require('path');
const {
  withAndroidManifest,
  withAppBuildGradle,
  withProjectBuildGradle,
  withDangerousMod,
} = require('@expo/config-plugins');

const RECEIVER = 'com.sami.quizmate.widget.QuizMateWidgetReceiver';

function copyTemplate(projectRoot, androidProjectRoot, templateName, outputPath) {
  const source = path.join(projectRoot, 'native', 'quizmate-widget', templateName);
  const destination = path.join(androidProjectRoot, outputPath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

module.exports = function withQuizMateWidget(config) {
  config = withProjectBuildGradle(config, (config) => {
    const composePlugin = "classpath('org.jetbrains.kotlin.plugin.compose:org.jetbrains.kotlin.plugin.compose.gradle.plugin:2.1.20')";
    if (!config.modResults.contents.includes(composePlugin)) {
      config.modResults.contents = config.modResults.contents.replace(
        "classpath('org.jetbrains.kotlin:kotlin-gradle-plugin')",
        "classpath('org.jetbrains.kotlin:kotlin-gradle-plugin')\n    " + composePlugin
      );
    }
    return config;
  });

  config = withAppBuildGradle(config, (config) => {
    let contents = config.modResults.contents;
    const marker = '// QuizMate Android home-screen widget';
    if (!contents.includes(marker)) {
      contents = contents.replace(
        'dependencies {',
        `${marker}\napply plugin: "org.jetbrains.kotlin.plugin.compose"\n\nandroid {\n    buildFeatures { compose true }\n}\n\ndependencies {`
      );
      contents = contents.replace(
        '    implementation("com.facebook.react:react-android")',
        `    implementation("com.facebook.react:react-android")\n    implementation("androidx.glance:glance-appwidget:1.1.1")\n    implementation("androidx.glance:glance-material3:1.1.1")\n    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")`
      );
    }
    config.modResults.contents = contents;
    return config;
  });

  config = withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    if (!application) return config;
    const receivers = application.receiver || [];
    if (!receivers.some((item) => item.$?.['android:name'] === RECEIVER)) {
      receivers.push({
        $: {
          'android:name': RECEIVER,
          'android:exported': 'true',
          'android:label': 'QuizMate',
        },
        'intent-filter': [{
          action: [{ $: { 'android:name': 'android.appwidget.action.APPWIDGET_UPDATE' } }],
        }],
        'meta-data': [{
          $: {
            'android:name': 'android.appwidget.provider',
            'android:resource': '@xml/quizmate_widget_info',
          },
        }],
      });
      application.receiver = receivers;
    }
    return config;
  });

  return withDangerousMod(config, ['android', async (config) => {
    const root = config.modRequest.projectRoot;
    const android = config.modRequest.platformProjectRoot;
    copyTemplate(root, android, 'QuizMateWidget.kt', 'app/src/main/java/com/sami/quizmate/widget/QuizMateWidget.kt');
    copyTemplate(root, android, 'WidgetBridgeModule.kt', 'app/src/main/java/com/sami/quizmate/widget/WidgetBridgeModule.kt');
    copyTemplate(root, android, 'quizmate_widget_info.xml', 'app/src/main/res/xml/quizmate_widget_info.xml');
    const applicationFile = path.join(android, 'app/src/main/java/com/sami/quizmate/MainApplication.kt');
    let application = fs.readFileSync(applicationFile, 'utf8');
    if (!application.includes('QuizMateWidgetPackage')) {
      application = application.replace(
        'import expo.modules.ApplicationLifecycleDispatcher',
        'import com.sami.quizmate.widget.QuizMateWidgetPackage\nimport expo.modules.ApplicationLifecycleDispatcher'
      ).replace(
        '// add(MyReactNativePackage())',
        '// add(MyReactNativePackage())\n          add(QuizMateWidgetPackage())'
      );
      fs.writeFileSync(applicationFile, application);
    }
    return config;
  }]);
};
