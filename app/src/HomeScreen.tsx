import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { Api, localIso, rupiah, Transaction } from './api';
import { EntryModal } from './EntryModal';
import { colors, s } from './styles';

function shiftMonth(month: string, by: number) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function HomeScreen({ api, onSettings }: { api: Api; onSettings: () => void }) {
  const [month, setMonth] = useState(() => localIso().slice(0, 7));
  const [items, setItems] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [editing, setEditing] = useState<Transaction | 'new' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, cats] = await Promise.all([api.list(month), api.categories()]);
      setItems(list);
      setCategories(cats);
    } catch (e) {
      Alert.alert("Couldn't load", String((e as Error).message));
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

  async function scan() {
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (picked.canceled) return;
    const asset = picked.assets[0];
    setScanning(true);
    try {
      const tx = await api.scan(asset.uri, asset.mimeType ?? 'image/jpeg');
      await load();
      setEditing(tx); // show the result so a wrong read can be fixed right away
    } catch (e) {
      Alert.alert("Couldn't read screenshot", String((e as Error).message));
    } finally {
      setScanning(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={items}
        keyExtractor={(t) => String(t.id)}
        contentContainerStyle={[s.page, { paddingBottom: 120 }]}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListHeaderComponent={
          <View style={{ gap: 8 }}>
            <View style={[s.row, { marginTop: 0, justifyContent: 'space-between' }]}>
              <Text style={s.title}>Okane</Text>
              <Pressable onPress={onSettings}><Text style={{ color: colors.accent, fontWeight: '600' }}>Settings</Text></Pressable>
            </View>
            <View style={[s.row, { marginTop: 0, justifyContent: 'space-between' }]}>
              <Pressable onPress={() => setMonth(shiftMonth(month, -1))}><Text style={{ fontSize: 22, color: colors.accent }}>‹</Text></Pressable>
              <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text }}>{month}</Text>
              <Pressable onPress={() => setMonth(shiftMonth(month, 1))}><Text style={{ fontSize: 22, color: colors.accent }}>›</Text></Pressable>
            </View>
            <View style={s.card}>
              <Text style={s.hint}>Spent this month</Text>
              <Text style={{ fontSize: 28, fontWeight: '700', color: colors.text }}>{rupiah(total)}</Text>
              {totals.map(([cat, v]) => (
                <View key={cat} style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                  <Text style={{ color: colors.text }}>{cat}</Text>
                  <Text style={{ color: colors.muted }}>{rupiah(v)}</Text>
                </View>
              ))}
            </View>
          </View>
        }
        ListEmptyComponent={!loading ? <Text style={[s.hint, { textAlign: 'center', marginTop: 24 }]}>No expenses this month.</Text> : undefined}
        renderItem={({ item }) => (
          <Pressable style={s.card} onPress={() => setEditing(item)}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontWeight: '600', color: colors.text, flex: 1 }} numberOfLines={1}>{item.recipient || '(no recipient)'}</Text>
              <Text style={{ fontWeight: '600', color: colors.text }}>{rupiah(item.amount)}</Text>
            </View>
            <Text style={s.hint} numberOfLines={1}>
              {item.category} · {item.occurred_at.slice(0, 10)}{item.remark ? ` · ${item.remark}` : ''}
            </Text>
          </Pressable>
        )}
      />

      <View style={[s.row, { position: 'absolute', left: 16, right: 16, bottom: 32 }]}>
        <Pressable style={[s.button, s.buttonGhost, { flex: 1, backgroundColor: colors.card }]} onPress={() => setEditing('new')}>
          <Text style={s.buttonGhostText}>+ Manual</Text>
        </Pressable>
        {api.canScan && (
          <Pressable style={[s.button, { flex: 1 }]} onPress={scan} disabled={scanning}>
            {scanning ? <ActivityIndicator color="#fff" /> : <Text style={s.buttonText}>Scan screenshot</Text>}
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
