import { Gaegu_400Regular, Gaegu_700Bold, useFonts } from '@expo-google-fonts/gaegu';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Api, Config, loadConfig, setHomeCurrency } from './src/api';
import { CalendarScreen } from './src/CalendarScreen';
import { HomeScreen } from './src/HomeScreen';
import { SetupScreen } from './src/SetupScreen';
import { colors } from './src/styles';

export default function App() {
  const [config, setConfig] = useState<Config | null | undefined>(undefined);
  const [editingSettings, setEditingSettings] = useState(false);
  const [view, setView] = useState<'home' | 'calendar'>('home');
  const [fontsLoaded] = useFonts({ Gaegu_400Regular, Gaegu_700Bold });
  const api = useMemo(() => (config ? new Api(config) : null), [config]);
  // bumped once the server's home currency is known, so amounts render in it
  const [currencyReady, setCurrencyReady] = useState<Api | null>(null);

  useEffect(() => {
    loadConfig().then(setConfig);
  }, []);

  useEffect(() => {
    if (!api) return;
    api.settings().then((st) => { setHomeCurrency(st.currency); setCurrencyReady(api); });
  }, [api]);

  let screen;
  if (config === undefined || !fontsLoaded || (api && currencyReady !== api && !editingSettings)) {
    screen = <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.bg }}><ActivityIndicator color={colors.red} /></View>;
  } else if (!api || editingSettings) {
    screen = (
      <SetupScreen
        initial={config}
        onDone={(c) => { setConfig(c); setEditingSettings(false); }}
        onCancel={api ? () => setEditingSettings(false) : undefined}
      />
    );
  } else if (view === 'calendar') {
    screen = <CalendarScreen api={api} onBack={() => setView('home')} />;
  } else {
    screen = <HomeScreen api={api} onSettings={() => setEditingSettings(true)} onCalendar={() => setView('calendar')} />;
  }

  return (
    <>
      {screen}
      <StatusBar style="dark" />
    </>
  );
}
