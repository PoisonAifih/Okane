import { StyleSheet } from 'react-native';

// Bakery-sticker look: cream paper, ink outlines, dusty blue + brick red.
export const colors = {
  bg: '#f4ecd8', card: '#fffaee', text: '#2f3445', muted: '#8a8170', ink: '#2f3445',
  blue: '#8fb2d3', blueSoft: '#dce8f3', red: '#b4343c', accent: '#b4343c', border: '#2f3445', danger: '#b4343c',
};

export const fonts = { hand: 'Gaegu_400Regular', handBold: 'Gaegu_700Bold' };

const outline = { borderWidth: 1.5, borderColor: colors.ink };

export const s = StyleSheet.create({
  page: { padding: 16, paddingTop: 56, gap: 8, backgroundColor: colors.bg, flexGrow: 1, width: '100%', maxWidth: 560, alignSelf: 'center' },
  title: { fontSize: 34, fontFamily: fonts.handBold, color: colors.red, marginBottom: 4 },
  label: { fontSize: 18, fontFamily: fonts.handBold, color: colors.ink, marginTop: 8 },
  hint: { fontSize: 15, fontFamily: fonts.hand, color: colors.muted },
  input: { ...outline, backgroundColor: colors.card, borderRadius: 14, padding: 12, fontSize: 16, color: colors.text },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 12 },
  button: { ...outline, backgroundColor: colors.red, borderRadius: 18, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center' },
  buttonText: { color: '#fffaee', fontFamily: fonts.handBold, fontSize: 20 },
  buttonGhost: { backgroundColor: colors.card },
  buttonGhostText: { color: colors.ink, fontFamily: fonts.handBold, fontSize: 20 },
  card: { ...outline, backgroundColor: colors.card, borderRadius: 18, padding: 14 },
  // Blue sticker with a stitched inner border, like the banner cards.
  blueCard: { ...outline, backgroundColor: colors.blue, borderRadius: 18, padding: 6 },
  stitch: { borderWidth: 1.5, borderColor: '#fffaee', borderStyle: 'dashed', borderRadius: 13, padding: 12 },
  ribbon: { backgroundColor: colors.red, borderRadius: 10, paddingVertical: 6, paddingHorizontal: 12, flexDirection: 'row', justifyContent: 'space-between' },
  ribbonText: { color: '#fffaee', fontFamily: fonts.handBold, fontSize: 17 },
  money: { fontFamily: fonts.handBold, color: colors.ink, fontSize: 19 },
  chip: { ...outline, paddingVertical: 4, paddingHorizontal: 12, borderRadius: 16, backgroundColor: colors.card },
  chipOn: { backgroundColor: colors.blue },
  chipText: { color: colors.ink, fontSize: 16, fontFamily: fonts.hand },
  chipTextOn: { fontFamily: fonts.handBold },
});
