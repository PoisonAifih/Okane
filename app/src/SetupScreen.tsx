import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Api, Config, saveConfig } from './api';
import { s } from './styles';

export function SetupScreen({ initial, onDone, onCancel }: {
  initial: Config | null;
  onDone: (c: Config) => void;
  onCancel?: () => void;
}) {
  const [serverUrl, setServerUrl] = useState(initial?.serverUrl ?? 'https://');
  const [serverToken, setServerToken] = useState(initial?.serverToken ?? '');
  const [anthropicKey, setAnthropicKey] = useState(initial?.anthropicKey ?? '');
  const [busy, setBusy] = useState(false);

  async function save() {
    const c = { serverUrl: serverUrl.trim(), serverToken: serverToken.trim(), anthropicKey: anthropicKey.trim() };
    setBusy(true);
    try {
      await new Api(c).categories(); // checks URL + token before saving
      await saveConfig(c);
      onDone(c);
    } catch (e) {
      Alert.alert("Can't reach your server", String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
      <Text style={s.title}>Okane setup</Text>

      <Text style={s.label}>Server URL</Text>
      <TextInput style={s.input} value={serverUrl} onChangeText={setServerUrl}
        autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://okane.example.com" />

      <Text style={s.label}>Server token</Text>
      <TextInput style={s.input} value={serverToken} onChangeText={setServerToken}
        autoCapitalize="none" autoCorrect={false} secureTextEntry placeholder="OKANE_TOKEN from your VPS" />

      <Text style={s.label}>Anthropic API key (optional)</Text>
      <TextInput style={s.input} value={anthropicKey} onChangeText={setAnthropicKey}
        autoCapitalize="none" autoCorrect={false} secureTextEntry placeholder="sk-ant-…" />
      <Text style={s.hint}>
        With a key you can scan payment screenshots. Without one, you add expenses by hand.
        The key stays on this phone and is sent to your server only while a screenshot is being read.
      </Text>

      <View style={s.row}>
        {onCancel && (
          <Pressable style={[s.button, s.buttonGhost]} onPress={onCancel}>
            <Text style={s.buttonGhostText}>Cancel</Text>
          </Pressable>
        )}
        <Pressable style={[s.button, { flex: 1 }]} onPress={save} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.buttonText}>Save</Text>}
        </Pressable>
      </View>
    </ScrollView>
  );
}
