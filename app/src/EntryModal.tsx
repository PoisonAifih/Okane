import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Api, CURRENCIES, Cycle, Draft, exchangeRate, homeCurrency, localIso, money, parseAmount, PAYMENT_METHODS, PaymentMethod, Transaction } from './api';
import { DateField } from './DateField';
import { confirmDestructive, notify } from './notify';
import { colors, s } from './styles';

/** Native Image can send the auth header; on web we fetch it ourselves and show a blob URL. */
function ReceiptImage({ api, id }: { api: Api; id: number }) {
  const [webUri, setWebUri] = useState<string | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let url: string | null = null;
    const { uri, headers } = api.imageSource(id);
    fetch(uri, { headers })
      .then((r) => (r.ok ? r.blob() : Promise.reject()))
      .then((b) => setWebUri((url = URL.createObjectURL(b))))
      .catch(() => {});
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [api, id]);

  const source = Platform.OS === 'web' ? (webUri ? { uri: webUri } : null) : api.imageSource(id);
  if (!source) return null;
  return <Image source={source} style={[s.card, { width: '100%', height: 420, padding: 0 }]} resizeMode="contain" />;
}

/** Add an expense by hand (tx = null) or view/correct an existing one. */
export function EntryModal({ api, categories, tx, onClose, onSaved }: {
  api: Api;
  categories: string[];
  tx: Transaction | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState(tx ? String(tx.amount) : '');
  // A foreign amount is converted to your home currency on save; the original goes into the remark.
  const home = homeCurrency();
  const [currency, setCurrency] = useState(home);
  const [rate, setRate] = useState<number | null>(1);
  const latestCurrency = useRef(home);
  const [category, setCategory] = useState(tx?.category ?? '');
  const [recipient, setRecipient] = useState(tx?.recipient ?? '');
  const [remark, setRemark] = useState(tx?.remark ?? '');
  const [method, setMethod] = useState<PaymentMethod>(tx?.payment_method ?? '');
  const [occurredAt, setOccurredAt] = useState(tx?.occurred_at ?? localIso());
  // '' = one-time; otherwise saving also starts a subscription with this expense as its first payment
  const [repeat, setRepeat] = useState<'' | Cycle>('');
  // 'keep' leaves the stored screenshot alone; a picked asset is uploaded on save.
  const [image, setImage] = useState<'keep' | 'remove' | ImagePicker.ImagePickerAsset>('keep');
  const [busy, setBusy] = useState(false);

  async function pickCurrency(c: string) {
    latestCurrency.current = c;
    setCurrency(c);
    setRate(c === home ? 1 : null);
    try {
      const r = await exchangeRate(c, home);
      if (latestCurrency.current === c) setRate(r); // ignore a slow reply for a currency you switched away from
    } catch (e) {
      notify("Couldn't convert", String((e as Error).message));
    }
  }

  async function pickImage() {
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (!picked.canceled) setImage(picked.assets[0]);
  }

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
    const typed = parseAmount(amount, currency);
    if (!rate) return notify("No exchange rate yet", 'Wait a moment or pick another currency.');
    const value = Math.round(typed * rate * 100) / 100;
    const original = currency === home ? '' : `${currency} ${typed}`;
    if (!value) return notify('Enter an amount');
    if (!category) return notify('Pick a category');
    const d: Draft = { amount: value, category, recipient: recipient.trim(), remark: original ? [remark.trim(), `(${original})`].filter(Boolean).join(' ') : remark.trim(), occurred_at: occurredAt, payment_method: method };
    run(async () => {
      const saved = tx ? await api.update(tx.id, d) : await api.addManual(d);
      if (repeat) {
        try {
          const start = occurredAt.slice(0, 10);
          const sub = await api.saveSubscription({
            name: d.recipient || d.remark || category, amount: value, category,
            payment_method: method, cycle: repeat, start_date: start,
          });
          await api.markSpent(sub.id, start, saved.id);
        } catch (e) {
          notify('Saved, but the subscription was not', String((e as Error).message));
        }
      }
      try {
        if (typeof image === 'object') await api.attachImage(saved.id, image);
        else if (image === 'remove' && tx?.has_image) await api.removeImage(saved.id);
      } catch (e) {
        // the expense itself is saved; don't leave the form open or a retry would add it twice
        notify('Saved, but the screenshot was not', String((e as Error).message));
      }
    });
  }

  function confirmDelete() {
    confirmDestructive('Delete this entry?', 'Delete', () => run(() => api.remove(tx!.id)));
  }

  return (
    <Modal animationType="slide" onRequestClose={onClose}>
      <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
        <Text style={s.title}>{tx ? 'edit expense ✎' : 'new expense ✿'}</Text>
        {tx && tx.category_by !== 'manual' && (
          <Text style={s.hint}>
            Category picked by {tx.category_by === 'ai' ? 'AI' : tx.category_by === 'keyword' ? 'keyword rule' : 'your past correction'}.
            Change it and Okane will remember this recipient.
          </Text>
        )}

        <Text style={s.label}>Amount ({currency})</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {[home, ...CURRENCIES.filter((c) => c !== home)].map((c) => (
            <Pressable key={c} style={[s.chip, c === currency && s.chipOn]} onPress={() => pickCurrency(c)}>
              <Text style={[s.chipText, c === currency && s.chipTextOn]}>{c}</Text>
            </Pressable>
          ))}
        </View>
        <TextInput style={s.input} value={amount} onChangeText={setAmount}
          keyboardType="decimal-pad" placeholder={currency === 'IDR' ? '25000' : '12.99'} />
        {currency !== home && (
          <Text style={s.hint}>
            {rate
              ? `= ${money((parseAmount(amount, currency) || 0) * rate)}  ·  1 ${currency} = ${money(rate)} today`
              : "getting today's rate…"}
          </Text>
        )}

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

        <Text style={s.label}>Recipient</Text>
        <TextInput style={s.input} value={recipient} onChangeText={setRecipient} placeholder="Nitnet" />

        <Text style={s.label}>Remark</Text>
        <TextInput style={s.input} value={remark} onChangeText={setRemark} placeholder="Lunch" />

        <Text style={s.label}>Date</Text>
        <DateField value={occurredAt} onChange={setOccurredAt} withTime />

        {!tx?.subscription_id && (
          <>
            <Text style={s.label}>Repeats</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {([['', 'one-time'], ['monthly', 'monthly'], ['yearly', 'yearly']] as const).map(([id, text]) => (
                <Pressable key={id} style={[s.chip, id === repeat && s.chipOn]} onPress={() => setRepeat(id)}>
                  <Text style={[s.chipText, id === repeat && s.chipTextOn]}>{text}</Text>
                </Pressable>
              ))}
            </View>
            {repeat && <Text style={s.hint}>Adds a subscription named after the recipient, due every {repeat === 'monthly' ? 'month' : 'year'} from this date. It shows on the calendar.</Text>}
          </>
        )}

        <Text style={s.label}>Screenshot</Text>
        {typeof image === 'object'
          ? <Image source={{ uri: image.uri }} style={[s.card, { width: '100%', height: 420, padding: 0 }]} resizeMode="contain" />
          : image === 'keep' && tx?.has_image && <ReceiptImage api={api} id={tx.id} />}
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <Pressable style={s.chip} onPress={pickImage}>
            <Text style={s.chipText}>{typeof image === 'object' || (image === 'keep' && tx?.has_image) ? 'replace' : '+ attach screenshot'}</Text>
          </Pressable>
          {(typeof image === 'object' || (image === 'keep' && tx?.has_image)) && (
            <Pressable style={s.chip} onPress={() => setImage(tx?.has_image ? 'remove' : 'keep')}>
              <Text style={[s.chipText, { color: colors.danger }]}>remove</Text>
            </Pressable>
          )}
        </View>
        {image === 'remove' && <Text style={s.hint}>The screenshot will be deleted when you save.</Text>}

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
            {busy ? <ActivityIndicator color={colors.card} /> : <Text style={s.buttonText}>Save</Text>}
          </Pressable>
        </View>
      </ScrollView>
    </Modal>
  );
}
