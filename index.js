import { registerRootComponent } from 'expo';
import { Platform } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import App from './App';

function QuizMateRoot() {
  return (
    <SafeAreaProvider>
      <SafeAreaView
        style={{ flex: 1 }}
        edges={Platform.OS === 'android' ? ['top', 'bottom'] : []}
      >
        <App />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(QuizMateRoot);
