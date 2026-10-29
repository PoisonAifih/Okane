import { Text, View } from 'react-native';
import { money } from './api';
import { colors, fonts } from './styles';

const PALETTE = ['#b4343c', '#2f5d8a', '#e0a93b', '#6f9a6a', '#d98a9a', '#7a5c99', '#c86f3d', '#4f8f8c', '#a8a07a', '#5b6274', '#e8cfa0', '#8c3b5e'];

/**
 * A wedge from `start` to `start + sweep` degrees (clockwise from 12 o'clock), sweep <= 180.
 * A left half-disc is rotated by `sweep` and clipped to the right half, then the whole frame is rotated to `start`.
 * Plain Views only, so it renders the same on Android, iOS and web without react-native-svg.
 */
function Wedge({ r, start, sweep, color }: { r: number; start: number; sweep: number; color: string }) {
  return (
    <View style={{ position: 'absolute', width: 2 * r, height: 2 * r, transform: [{ rotate: `${start}deg` }] }}>
      <View style={{ position: 'absolute', left: r, width: r, height: 2 * r, overflow: 'hidden' }}>
        <View style={{ position: 'absolute', left: -r, width: 2 * r, height: 2 * r, transform: [{ rotate: `${sweep}deg` }] }}>
          <View style={{ width: r, height: 2 * r, overflow: 'hidden' }}>
            <View style={{ width: 2 * r, height: 2 * r, borderRadius: r, backgroundColor: color }} />
          </View>
        </View>
      </View>
    </View>
  );
}

/** Donut of spending per category with a legend. `data` is [category, amount], largest first. */
export function PieChart({ data, size = 112 }: { data: [string, number][]; size?: number }) {
  const total = data.reduce((sum, [, v]) => sum + v, 0);
  if (!total) return null;
  const r = size / 2;
  const hole = size * 0.46;

  const wedges: { start: number; sweep: number; color: string }[] = [];
  let at = 0;
  data.forEach(([, v], i) => {
    const color = PALETTE[i % PALETTE.length];
    let sweep = (v / total) * 360;
    while (sweep > 0) { // wedges over 180° are drawn in two pieces
      const part = Math.min(sweep, 180);
      // tuck each piece 1° under the previous one so no anti-aliasing seam shows between them
      const back = at > 0 ? Math.min(1, 180 - part) : 0;
      wedges.push({ start: at - back, sweep: part + back, color });
      at += part;
      sweep -= part;
    }
  });

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 8 }}>
      <View style={{ width: size, height: size, borderRadius: r, borderWidth: 1.5, borderColor: colors.ink, overflow: 'hidden', backgroundColor: colors.card }}>
        {wedges.map((w, i) => <Wedge key={i} r={r - 1.5} {...w} />)}
        <View style={{
          position: 'absolute', left: (size - 3 - hole) / 2, top: (size - 3 - hole) / 2, width: hole, height: hole,
          borderRadius: hole / 2, backgroundColor: colors.blue, borderWidth: 1.5, borderColor: colors.ink,
        }} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        {data.map(([cat, v], i) => (
          <View key={cat} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 12, height: 12, borderRadius: 6, borderWidth: 1, borderColor: colors.ink, backgroundColor: PALETTE[i % PALETTE.length] }} />
            <Text style={{ flex: 1, fontFamily: fonts.hand, fontSize: 16, color: colors.ink }} numberOfLines={1}>
              {cat} <Text style={{ color: colors.card }}>{Math.round((v / total) * 100)}%</Text>
            </Text>
            <Text style={{ fontFamily: fonts.handBold, fontSize: 16, color: colors.ink }}>{money(v)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
