import { useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Api, Draft, localIso, Transaction } from './api';
import { colors, s } from './styles';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

/** Add an expense by hand (tx = null) or view/correct an existing one. */
export function EntryModal({ api, categories, tx, onClose, onSaved }: {
  api: Api;
  categories: string[];
  tx: Transaction | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState(tx ? String(tx.amount) : '');
  const [category, setCategory] = useState(tx?.category ?? '');
  const [recipient, setRecipient] = useState(tx?.recipient ?? '');
  const [remark, setRemark] = useState(tx?.remark ?? '');
  const [occurredAt, setOccurredAt] = useState(tx?.occurred_at ?? localIso());
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      onSaved();
    } catch (e) {
      Alert.alert('Error', String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  function save() {
    const value = Number(amount.replace(/[^\d.]/g, ''));
    if (!value) return Alert.alert('Enter an amount');
    if (!category) return Alert.alert('Pick a category');
    if (!ISO.test(occurredAt)) return Alert.alert('Date must look like 2026-10-28T13:45');
    const d: Draft = { amount: value, category, recipient: recipient.trim(), remark: remark.trim(), occurred_at: occurredAt };
    run(() => (tx ? api.update(tx.id, d) : api.addManual(d)));
  }

  function confirmDelete() {
    Alert.alert('Delete this entry?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => run(() => api.remove(tx!.id)) },
    ]);
  }

  return (
    <Modal animationType="slide" onRequestClose={onClose}>
      <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
        <Text style={s.title}>{tx ? 'Edit expense' : 'New expense'}</Text>
        {tx && tx.category_by !== 'manual' && (
          <Text style={s.hint}>
            Category picked by {tx.category_by === 'ai' ? 'AI' : tx.category_by === 'keyword' ? 'keyword rule' : 'your past correction'}.
            Change it and Okane will remember this recipient.
          </Text>
        )}

        <Text style={s.label}>Amount (Rp)</Text>
        <TextInput style={s.input} value={amount} onChangeText={setAmount} keyboardType="numeric" placeholder="25000" />

        <Text style={s.label}>Category</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {categories.map((c) => (
            <Pressable key={c} style={[s.chip, c === category && s.chipOn]} onPress={() => setCategory(c)}>
              <Text style={[s.chipText, c === category && s.chipTextOn]}>{c}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={s.label}>Recipient</Text>
        <TextInput style={s.input} value={recipient} onChangeText={setRecipient} placeholder="Warung Bu Sri" />

        <Text style={s.label}>Remark</Text>
        <TextInput style={s.input} value={remark} onChangeText={setRemark} placeholder="makan siang" />

        <Text style={s.label}>Date</Text>
        <TextInput style={s.input} value={occurredAt} onChangeText={setOccurredAt} autoCapitalize="none" />

        {tx?.has_image && (
          <Image source={api.imageSource(tx.id)} style={{ width: '100%', height: 420, marginTop: 12 }} resizeMode="contain" />
        )}

        <View style={s.row}>
          <Pressable style={[s.button, s.buttonGhost]} onPress={onClose} disabled={busy}>
            <Text style={s.buttonGhostText}>Cancel</Text>
          </Pressable>
          {tx && (
            <Pressable style={[s.button, s.buttonGhost]} onPress={confirmDelete} disabled={busy}>
              <Text style={[s.buttonGhostText, { color: colors.danger }]}>Delete</Text>
            </Pressable>
          )}
          <Pressable style={[s.button, { flex: 1 }]} onPress={save} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.buttonText}>Save</Text>}
          </Pressable>
        </View>
      </ScrollView>
    </Modal>
  );
}
