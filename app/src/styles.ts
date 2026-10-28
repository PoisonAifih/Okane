import { StyleSheet } from 'react-native';

export const colors = { bg: '#f6f7f9', card: '#fff', text: '#1b1f24', muted: '#68707a', accent: '#1f7a5c', border: '#dde1e6', danger: '#c0392b' };

export const s = StyleSheet.create({
  page: { padding: 16, paddingTop: 56, gap: 8, backgroundColor: colors.bg, flexGrow: 1 },
  title: { fontSize: 24, fontWeight: '700', color: colors.text, marginBottom: 8 },
  label: { fontSize: 13, fontWeight: '600', color: colors.muted, marginTop: 8 },
  hint: { fontSize: 12, color: colors.muted },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12, fontSize: 16, color: colors.text },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 12 },
  button: { backgroundColor: colors.accent, borderRadius: 8, paddingVertical: 14, paddingHorizontal: 16, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  buttonGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
  buttonGhostText: { color: colors.text, fontWeight: '600', fontSize: 15 },
  card: { backgroundColor: colors.card, borderRadius: 10, padding: 14, borderWidth: 1, borderColor: colors.border },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontSize: 13 },
  chipTextOn: { color: '#fff', fontWeight: '600' },
});
