import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { AI_PROVIDERS, AiProvider, Api, Config, CURRENCIES, homeCurrency, saveConfig, setHomeCurrency } from './api';
import { notify } from './notify';
import { colors, s } from './styles';

export function SetupScreen({ initial, onDone, onCancel }: {
  initial: Config | null;
  onDone: (c: Config) => void;
  onCancel?: () => void;
}) {
  const [serverUrl, setServerUrl] = useState(initial?.serverUrl ?? (Platform.OS === 'web' ? window.location.origin : 'https://'));
  const [serverToken, setServerToken] = useState(initial?.serverToken ?? '');
  const [aiProvider, setAiProvider] = useState<AiProvider>(initial?.aiProvider ?? '');
  const [aiKey, setAiKey] = useState(initial?.aiKey ?? '');
  const [aiModel, setAiModel] = useState(initial?.aiModel ?? '');
  const provider = AI_PROVIDERS.find((p) => p.id === aiProvider)!;
  const [currency, setCurrency] = useState(homeCurrency());
  const [pickedCurrency, setPickedCurrency] = useState(false); // on a new device, keep the server's unless changed
  const [busy, setBusy] = useState(false);

  async function save() {
    const c: Config = {
      serverUrl: serverUrl.trim(), serverToken: serverToken.trim(), aiProvider,
      aiKey: provider.needsKey ? aiKey.trim() : '',
      aiModel: provider.modelHint ? aiModel.trim() : '',
    };
    if (provider.needsKey && !c.aiKey) return notify(`Enter your ${provider.label} API key`);
    if (provider.modelHint && !c.aiModel) return notify(`Enter a ${provider.label} model`, provider.modelHint);
    setBusy(true);
    try {
      const api = new Api(c);
      await api.categories(); // checks URL + token before saving
      if (aiProvider === 'server' && !(await api.capabilities()).server_scan) {
        throw new Error('Your server has no Claude Code set up (OKANE_CLAUDE_CLI). Pick another option.');
      }
      // the currency lives on the server so the phone and the web app agree
      const current = (await api.settings()).currency;
      if (pickedCurrency && currency !== current) await api.saveSettings(currency);
      setHomeCurrency(pickedCurrency ? currency : current);
      await saveConfig(c);
      onDone(c);
    } catch (e) {
      notify("Can't reach your server", String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
      <Text style={s.title}>okane setup ✿</Text>

      <Text style={s.label}>Server URL</Text>
      <TextInput style={s.input} value={serverUrl} onChangeText={setServerUrl}
        autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://okane.example.com" />

      <Text style={s.label}>Server token</Text>
      <TextInput style={s.input} value={serverToken} onChangeText={setServerToken}
        autoCapitalize="none" autoCorrect={false} secureTextEntry placeholder="OKANE_TOKEN from your VPS" />

      <Text style={s.label}>Your currency</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {CURRENCIES.map((c) => (
          <Pressable key={c} style={[s.chip, c === currency && s.chipOn]} onPress={() => { setCurrency(c); setPickedCurrency(true); }}>
            <Text style={[s.chipText, c === currency && s.chipTextOn]}>{c}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={s.hint}>
        Totals and the pie chart are in this currency; anything you enter or scan in another one is converted at
        today's rate.{initial && currency !== homeCurrency() ? ' Amounts you already saved are not converted.' : ''}
      </Text>

      <Text style={s.label}>Read screenshots with (optional)</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {AI_PROVIDERS.map((p) => (
          <Pressable key={p.id} style={[s.chip, p.id === aiProvider && s.chipOn]} onPress={() => setAiProvider(p.id)}>
            <Text style={[s.chipText, p.id === aiProvider && s.chipTextOn]}>{p.label}</Text>
          </Pressable>
        ))}
      </View>

      {provider.needsKey && (
        <>
          <Text style={s.label}>{provider.label} API key</Text>
          <TextInput style={s.input} value={aiKey} onChangeText={setAiKey}
            autoCapitalize="none" autoCorrect={false} secureTextEntry placeholder="paste your key" />
        </>
      )}
      {provider.modelHint && (
        <>
          <Text style={s.label}>Model (must read images)</Text>
          <TextInput style={s.input} value={aiModel} onChangeText={setAiModel}
            autoCapitalize="none" autoCorrect={false} placeholder={provider.modelHint} />
        </>
      )}
      <Text style={s.hint}>
        {aiProvider === ''
          ? 'Without one, you add expenses by hand.'
          : aiProvider === 'server'
            ? 'Your server reads screenshots with its own Claude Code login. No key needed here.'
            : 'The key stays on this device and is sent to your server only while a screenshot is being read.'}
      </Text>

      <View style={s.row}>
        {onCancel && (
          <Pressable style={[s.button, s.buttonGhost]} onPress={onCancel}>
            <Text style={s.buttonGhostText}>Cancel</Text>
          </Pressable>
        )}
        <Pressable style={[s.button, { flex: 1 }]} onPress={save} disabled={busy}>
          {busy ? <ActivityIndicator color={colors.card} /> : <Text style={s.buttonText}>Save</Text>}
        </Pressable>
      </View>
    </ScrollView>
  );
}
