import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Api, Cycle, localIso, PAYMENT_METHODS, PaymentMethod, Subscription } from './api';
import { DateField } from './DateField';
import { confirmDestructive, notify } from './notify';
import { colors, s } from './styles';

const CYCLES: { id: Cycle; label: string }[] = [{ id: 'monthly', label: 'Monthly' }, { id: 'yearly', label: 'Yearly' }];

/** Add a subscription (sub = null) or edit/delete one. */
export function SubscriptionModal({ api, categories, sub, onClose, onSaved }: {
  api: Api;
  categories: string[];
  sub: Subscription | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(sub?.name ?? '');
  const [amount, setAmount] = useState(sub ? String(sub.amount) : '');
  const [category, setCategory] = useState(sub?.category ?? '');
  const [method, setMethod] = useState<PaymentMethod>(sub?.payment_method ?? '');
  const [cycle, setCycle] = useState<Cycle>(sub?.cycle ?? 'monthly');
  const [startDate, setStartDate] = useState(sub?.start_date ?? localIso().slice(0, 10));
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      onSaved();
    } catch (e) {
      notify('Error', String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  function save() {
    const value = Number(amount.replace(/[^\d.]/g, ''));
    if (!name.trim()) return notify('Enter a name');
    if (!value) return notify('Enter an amount');
    if (!category) return notify('Pick a category');
    run(() => api.saveSubscription(
      { name: name.trim(), amount: value, category, payment_method: method, cycle, start_date: startDate },
      sub?.id,
    ));
  }

  function confirmDelete() {
    confirmDestructive(`Delete ${sub!.name}? Payments already marked as spent stay.`, 'Delete',
      () => run(() => api.removeSubscription(sub!.id)));
  }

  return (
    <Modal animationType="slide" onRequestClose={onClose}>
      <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
        <Text style={s.title}>{sub ? 'edit subscription ✎' : 'new subscription ✿'}</Text>

        <Text style={s.label}>Name</Text>
        <TextInput style={s.input} value={name} onChangeText={setName} placeholder="Netflix" />

        <Text style={s.label}>Amount (Rp)</Text>
        <TextInput style={s.input} value={amount} onChangeText={setAmount} keyboardType="numeric" placeholder="186000" />

        <Text style={s.label}>Repeats</Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {CYCLES.map((c) => (
            <Pressable key={c.id} style={[s.chip, c.id === cycle && s.chipOn]} onPress={() => setCycle(c.id)}>
              <Text style={[s.chipText, c.id === cycle && s.chipTextOn]}>{c.label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={s.label}>First payment date</Text>
        <DateField value={startDate} onChange={setStartDate} />
        <Text style={s.hint}>
          {cycle === 'monthly' ? 'Due on this day every month.' : 'Due on this date every year.'}
        </Text>

        <Text style={s.label}>Category</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {categories.map((c) => (
            <Pressable key={c} style={[s.chip, c === category && s.chipOn]} onPress={() => setCategory(c)}>
              <Text style={[s.chipText, c === category && s.chipTextOn]}>{c}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={s.label}>Paid with</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {PAYMENT_METHODS.map((p) => (
            <Pressable key={p.id} style={[s.chip, p.id === method && s.chipOn]} onPress={() => setMethod(p.id === method ? '' : p.id)}>
              <Text style={[s.chipText, p.id === method && s.chipTextOn]}>{p.label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={s.row}>
          <Pressable style={[s.button, s.buttonGhost]} onPress={onClose} disabled={busy}>
            <Text style={s.buttonGhostText}>Cancel</Text>
          </Pressable>
          {sub && (
            <Pressable style={[s.button, s.buttonGhost]} onPress={confirmDelete} disabled={busy}>
              <Text style={[s.buttonGhostText, { color: colors.danger }]}>Delete</Text>
            </Pressable>
          )}
          <Pressable style={[s.button, { flex: 1 }]} onPress={save} disabled={busy}>
            {busy ? <ActivityIndicator color={colors.card} /> : <Text style={s.buttonText}>Save</Text>}
          </Pressable>
        </View>
      </ScrollView>
    </Modal>
  );
}
