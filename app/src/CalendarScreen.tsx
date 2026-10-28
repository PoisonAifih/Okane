import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Api, Due, localIso, monthName, paymentLabel, rupiah, shiftMonth, Subscription } from './api';
import { confirmDestructive, notify } from './notify';
import { SubscriptionModal } from './SubscriptionModal';
import { colors, fonts, s } from './styles';

const cream = '#fffaee';
const WEEKDAYS = ['s', 'm', 't', 'w', 't', 'f', 's'];

/** Subscriptions on a month grid. Each due date is a reminder until marked as spent. */
export function CalendarScreen({ api, onBack }: { api: Api; onBack: () => void }) {
  const [month, setMonth] = useState(() => localIso().slice(0, 7));
  const [dues, setDues] = useState<Due[]>([]);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [day, setDay] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [editing, setEditing] = useState<Subscription | 'new' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, all, cats] = await Promise.all([api.due(month), api.subscriptions(), api.categories()]);
      setDues(d);
      setSubs(all);
      setCategories(cats);
    } catch (e) {
      notify("Couldn't load", String((e as Error).message));
    } finally {
      setLoading(false);
    }
  }, [api, month]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => setDay(null), [month]);

  const [y, m] = month.split('-').map(Number);
  const firstWeekday = new Date(y, m - 1, 1).getDay();
  const daysInMonth = new Date(y, m, 0).getDate();
  const today = localIso().slice(0, 10);

  const byDay = useMemo(() => {
    const map: Record<number, Due[]> = {};
    for (const d of dues) (map[Number(d.due_date.slice(8, 10))] ??= []).push(d);
    return map;
  }, [dues]);

  const spent = dues.filter((d) => d.transaction_id).reduce((a, d) => a + d.subscription.amount, 0);
  const pending = dues.filter((d) => !d.transaction_id).reduce((a, d) => a + d.subscription.amount, 0);
  const shown = day ? byDay[day] ?? [] : dues;

  async function toggle(d: Due) {
    const key = `${d.subscription.id}:${d.due_date}`;
    const act = async () => {
      setBusyKey(key);
      try {
        if (d.transaction_id) await api.remove(d.transaction_id);
        else await api.markSpent(d.subscription.id, d.due_date);
        await load();
      } catch (e) {
        notify('Error', String((e as Error).message));
      } finally {
        setBusyKey(null);
      }
    };
    if (d.transaction_id) confirmDestructive(`Undo? This deletes the ${d.subscription.name} expense.`, 'Undo', act);
    else act();
  }

  const cells: (number | null)[] = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={[s.page, { paddingBottom: 120 }]}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.red} colors={[colors.red]} />}
      >
        <View style={[s.row, { marginTop: 0, justifyContent: 'space-between' }]}>
          <Text style={[s.title, { fontSize: 40, marginBottom: 0 }]}>
            calendar <Text style={{ color: colors.blue, fontSize: 24 }}>✦</Text>
          </Text>
          <Pressable style={[s.chip, { borderRadius: 12 }]} onPress={onBack}>
            <Text style={s.chipText}>‹ home</Text>
          </Pressable>
        </View>

        <View style={s.ribbon}>
          <Pressable onPress={() => setMonth(shiftMonth(month, -1))} hitSlop={12}><Text style={s.ribbonText}>‹</Text></Pressable>
          <Text style={s.ribbonText}>{monthName(month)}</Text>
          <Pressable onPress={() => setMonth(shiftMonth(month, 1))} hitSlop={12}><Text style={s.ribbonText}>›</Text></Pressable>
        </View>

        <View style={s.blueCard}>
          <View style={s.stitch}>
            <Text style={{ fontFamily: fonts.hand, fontSize: 17, color: cream }}>subscriptions this month</Text>
            <Text style={{ fontFamily: fonts.handBold, fontSize: 36, color: cream }}>{rupiah(spent + pending)}</Text>
            <Text style={{ fontFamily: fonts.hand, fontSize: 17, color: colors.ink }}>
              spent {rupiah(spent)} · still to pay {rupiah(pending)}
            </Text>
          </View>
        </View>

        <View style={[s.card, { padding: 8 }]}>
          <View style={{ flexDirection: 'row' }}>
            {WEEKDAYS.map((w, i) => (
              <Text key={i} style={[s.hint, { width: '14.2857%', textAlign: 'center' }]}>{w}</Text>
            ))}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {cells.map((n, i) => {
              if (n === null) return <View key={`x${i}`} style={{ width: '14.2857%', aspectRatio: 1 }} />;
              const items = byDay[n] ?? [];
              const allSpent = items.length > 0 && items.every((d) => d.transaction_id);
              const isToday = `${month}-${String(n).padStart(2, '0')}` === today;
              return (
                <Pressable key={n} onPress={() => setDay(day === n ? null : n)} style={{ width: '14.2857%', aspectRatio: 1, padding: 2 }}>
                  <View style={{
                    flex: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
                    backgroundColor: day === n ? colors.blueSoft : 'transparent',
                    borderWidth: isToday ? 1.5 : 0, borderColor: colors.red,
                  }}>
                    <Text style={{ fontFamily: items.length ? fonts.handBold : fonts.hand, fontSize: 17, color: colors.ink }}>{n}</Text>
                    {items.length > 0 && (
                      <View style={{ width: 7, height: 7, borderRadius: 4, marginTop: 1, backgroundColor: allSpent ? colors.blue : colors.red }} />
                    )}
                  </View>
                </Pressable>
              );
            })}
          </View>
          <Text style={[s.hint, { textAlign: 'center', marginTop: 4 }]}>
            <Text style={{ color: colors.red }}>●</Text> reminder   <Text style={{ color: colors.blue }}>●</Text> spent
          </Text>
        </View>

        <Text style={s.label}>{day ? `due on the ${day}` : 'due this month'}</Text>
        {shown.length === 0 && !loading && <Text style={s.hint}>nothing due ♡</Text>}
        {shown.map((d) => {
          const key = `${d.subscription.id}:${d.due_date}`;
          return (
            <View key={key} style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
              <Pressable style={{ flex: 1 }} onPress={() => setEditing(d.subscription)}>
                <Text style={s.money} numberOfLines={1}>{d.subscription.name}</Text>
                <Text style={s.hint} numberOfLines={1}>
                  {[d.due_date.slice(8, 10) + ' ' + monthName(month).split(' ')[0], rupiah(d.subscription.amount), paymentLabel(d.subscription.payment_method)].filter(Boolean).join(' · ')}
                </Text>
              </Pressable>
              <Pressable
                style={[s.chip, { paddingVertical: 6 }, d.transaction_id ? s.chipOn : { backgroundColor: colors.red }]}
                onPress={() => toggle(d)}
                disabled={busyKey === key}
              >
                {busyKey === key
                  ? <ActivityIndicator color={colors.ink} />
                  : <Text style={[s.chipText, d.transaction_id ? s.chipTextOn : { color: cream, fontFamily: fonts.handBold }]}>
                      {d.transaction_id ? 'spent ✓' : 'mark spent'}
                    </Text>}
              </Pressable>
            </View>
          );
        })}

        <Text style={[s.label, { marginTop: 16 }]}>all subscriptions</Text>
        {subs.length === 0 && !loading && <Text style={s.hint}>add your first one below ✿</Text>}
        {subs.map((sub) => (
          <Pressable key={sub.id} style={s.card} onPress={() => setEditing(sub)}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <Text style={[s.money, { flex: 1 }]} numberOfLines={1}>{sub.name}</Text>
              <Text style={[s.money, { color: colors.red }]}>{rupiah(sub.amount)}</Text>
            </View>
            <Text style={s.hint} numberOfLines={1}>
              {[sub.cycle === 'monthly' ? `monthly on the ${Number(sub.start_date.slice(8, 10))}` : `yearly on ${sub.start_date.slice(5)}`,
                sub.category, paymentLabel(sub.payment_method)].filter(Boolean).join(' · ')}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={[s.row, { position: 'absolute', left: 16, right: 16, bottom: 32, maxWidth: 528, marginHorizontal: 'auto' }]}>
        <Pressable style={[s.button, { flex: 1 }]} onPress={() => setEditing('new')}>
          <Text style={s.buttonText}>+ subscription</Text>
        </Pressable>
      </View>

      {editing && (
        <SubscriptionModal
          api={api}
          categories={categories}
          sub={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </View>
  );
}
