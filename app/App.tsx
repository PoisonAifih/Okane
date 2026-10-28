import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Api, Config, loadConfig } from './src/api';
import { HomeScreen } from './src/HomeScreen';
import { SetupScreen } from './src/SetupScreen';

export default function App() {
  const [config, setConfig] = useState<Config | null | undefined>(undefined);
  const [editingSettings, setEditingSettings] = useState(false);
  const api = useMemo(() => (config ? new Api(config) : null), [config]);

  useEffect(() => {
    loadConfig().then(setConfig);
  }, []);

  let screen;
  if (config === undefined) {
    screen = <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator /></View>;
  } else if (!api || editingSettings) {
    screen = (
      <SetupScreen
        initial={config}
        onDone={(c) => { setConfig(c); setEditingSettings(false); }}
        onCancel={api ? () => setEditingSettings(false) : undefined}
      />
    );
  } else {
    screen = <HomeScreen api={api} onSettings={() => setEditingSettings(true)} />;
  }

  return (
    <>
      {screen}
      <StatusBar style="dark" />
    </>
  );
}
