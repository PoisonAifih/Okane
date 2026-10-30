import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, RefreshControl, Text, View } from 'react-native';
import { Api, localIso, monthName, PAYMENT_METHODS, paymentLabel, money, shiftMonth, Transaction } from './api';
import { EntryModal } from './EntryModal';
import { notify } from './notify';
import { PieChart } from './PieChart';
import { colors, fonts, s } from './styles';

const cream = '#fffaee';

/** "fri 23 oct" for a YYYY-MM-DD day. */
function dayName(day: string) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).toLowerCase();
}

export function HomeScreen({ api, onSettings, onCalendar }: { api: Api; onSettings: () => void; onCalendar: () => void }) {
  const [month, setMonth] = useState(() => localIso().slice(0, 7));
  const [items, setItems] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [editing, setEditing] = useState<Transaction | 'new' | null>(null);
  const [newestFirst, setNewestFirst] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, cats] = await Promise.all([api.list(month), api.categories()]);
      setItems(list);
      setCategories(cats);
    } catch (e) {
      notify("Couldn't load", String((e as Error).message));
    } finally {
      setLoading(false);
    }
  }, [api, month]);

  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => {
    const by: Record<string, number> = {};
    for (const t of items) by[t.category] = (by[t.category] ?? 0) + t.amount;
    return Object.entries(by).sort((a, b) => b[1] - a[1]);
  }, [items]);
  const total = totals.reduce((sum, [, v]) => sum + v, 0);

  // expenses grouped under a header per day, with that day's total
  const rows = useMemo(() => {
    const sorted = [...items].sort((a, b) => (a.occurred_at === b.occurred_at ? a.id - b.id : a.occurred_at < b.occurred_at ? -1 : 1));
    if (newestFirst) sorted.reverse();
    type Day = { kind: 'day'; day: string; total: number };
    const out: (Day | { kind: 'tx'; tx: Transaction })[] = [];
    let header = null as Day | null;
    for (const tx of sorted) {
      const day = tx.occurred_at.slice(0, 10);
      if (header?.day === day) header.total += tx.amount;
      else out.push((header = { kind: 'day', day, total: tx.amount }));
      out.push({ kind: 'tx', tx });
    }
    return out;
  }, [items, newestFirst]);

  const byMethod = useMemo(
    () => PAYMENT_METHODS
      .map((p) => ({ label: p.label, sum: items.filter((t) => t.payment_method === p.id).reduce((a, t) => a + t.amount, 0) }))
      .filter((p) => p.sum > 0),
    [items],
  );

  async function scan() {
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (picked.canceled) return;
    const asset = picked.assets[0];
    setScanning(true);
    try {
      const { transactions, skipped } = await api.scan(asset);
      await load();
      const already = skipped ? ` (${skipped} already saved, skipped)` : '';
      if (transactions.length === 1 && !skipped) setEditing(transactions[0]); // show it so a wrong read can be fixed right away
      else if (transactions.length === 0) notify('Nothing new', `Every payment in this screenshot was already saved.`);
      else notify(`Added ${transactions.length} expenses${already}`, 'Tap one to check or fix it.');
    } catch (e) {
      notify("Couldn't read screenshot", String((e as Error).message));
    } finally {
      setScanning(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={rows}
        keyExtractor={(r) => (r.kind === 'day' ? r.day : String(r.tx.id))}
        contentContainerStyle={[s.page, { paddingBottom: 120 }]}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.red} colors={[colors.red]} />}
        ListHeaderComponent={
          <View style={{ gap: 10 }}>
            <View style={[s.row, { marginTop: 0, justifyContent: 'space-between' }]}>
              <Text style={[s.title, { fontSize: 44, marginBottom: 0 }]}>
                okane <Text style={{ color: colors.blue, fontSize: 26 }}>✦ ✿</Text>
              </Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {Platform.OS === 'web' && (
                  <Pressable style={[s.chip, { borderRadius: 12 }]} onPress={load}>
                    <Text style={s.chipText}>↻</Text>
                  </Pressable>
                )}
                <Pressable style={[s.chip, { borderRadius: 12 }]} onPress={onCalendar}>
                  <Text style={s.chipText}>calendar</Text>
                </Pressable>
                <Pressable style={[s.chip, { borderRadius: 12 }]} onPress={onSettings}>
                  <Text style={s.chipText}>settings</Text>
                </Pressable>
              </View>
            </View>

            <View style={s.ribbon}>
              <Pressable onPress={() => setMonth(shiftMonth(month, -1))} hitSlop={12}><Text style={s.ribbonText}>‹</Text></Pressable>
              <Text style={s.ribbonText}>{monthName(month)}</Text>
              <Pressable onPress={() => setMonth(shiftMonth(month, 1))} hitSlop={12}><Text style={s.ribbonText}>›</Text></Pressable>
            </View>

            <View style={s.blueCard}>
              <View style={s.stitch}>
                <Text style={{ fontFamily: fonts.hand, fontSize: 17, color: cream }}>spent this month</Text>
                <Text style={{ fontFamily: fonts.handBold, fontSize: 40, color: cream }}>{money(total)}</Text>
                <PieChart data={totals} />
                {byMethod.length > 0 && (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                    {byMethod.map((p) => (
                      <View key={p.label} style={[s.chip, { paddingHorizontal: 8 }]}>
                        <Text style={[s.chipText, { fontSize: 14 }]}>{p.label} · {money(p.sum)}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            </View>

            {items.length > 1 && (
              <Pressable style={[s.chip, { alignSelf: 'flex-end' }]} onPress={() => setNewestFirst(!newestFirst)}>
                <Text style={s.chipText}>{newestFirst ? 'newest first ↓' : 'oldest first ↑'}</Text>
              </Pressable>
            )}
          </View>
        }
        ListEmptyComponent={!loading ? <Text style={[s.hint, { textAlign: 'center', marginTop: 24 }]}>no expenses this month ♡</Text> : undefined}
        renderItem={({ item: row }) => row.kind === 'day' ? (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, paddingHorizontal: 4 }}>
            <Text style={s.label}>{dayName(row.day)}</Text>
            <Text style={[s.label, { color: colors.muted }]}>{money(row.total)}</Text>
          </View>
        ) : (
          <Pressable style={s.card} onPress={() => setEditing(row.tx)}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <Text style={[s.money, { flex: 1 }]} numberOfLines={1}>{row.tx.recipient || '(no recipient)'}</Text>
              <Text style={[s.money, { color: colors.red }]}>{money(row.tx.amount)}</Text>
            </View>
            <Text style={s.hint} numberOfLines={1}>
              {[row.tx.category, paymentLabel(row.tx.payment_method), row.tx.remark].filter(Boolean).join(' · ')}
            </Text>
          </Pressable>
        )}
      />

      <View style={[s.row, { position: 'absolute', left: 16, right: 16, bottom: 32, maxWidth: 528, marginHorizontal: 'auto' }]}>
        <Pressable style={[s.button, s.buttonGhost, { flex: 1 }]} onPress={() => setEditing('new')}>
          <Text style={s.buttonGhostText}>+ manual</Text>
        </Pressable>
        {api.canScan && (
          <Pressable style={[s.button, { flex: 1 }]} onPress={scan} disabled={scanning}>
            {scanning ? <ActivityIndicator color={cream} /> : <Text style={s.buttonText}>scan screenshot</Text>}
          </Pressable>
        )}
      </View>

      {editing && (
        <EntryModal
          api={api}
          categories={categories}
          tx={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </View>
  );
}
