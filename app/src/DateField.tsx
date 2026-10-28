import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { createElement } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { localIso } from './api';
import { colors, fonts, s } from './styles';

/** Local date (and time) as the server stores it: YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS. */
function parse(value: string) {
  const [y, m, d, hh = 0, mm = 0, ss = 0] = value.split(/[-T:]/).map(Number);
  return new Date(y, m - 1, d, hh, mm, ss);
}

function label(date: Date, withTime: boolean) {
  const day = date.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  return withTime ? `${day} · ${localIso(date).slice(11, 16)}` : day;
}

/** Native date picker on phones, the browser's own picker on web. */
export function DateField({ value, onChange, withTime = false }: {
  value: string;
  onChange: (value: string) => void;
  withTime?: boolean;
}) {
  const date = parse(value);
  const emit = (d: Date) => onChange(withTime ? localIso(d) : localIso(d).slice(0, 10));

  if (Platform.OS === 'web') {
    return createElement('input', {
      type: withTime ? 'datetime-local' : 'date',
      value: withTime ? value.slice(0, 16) : value.slice(0, 10),
      onChange: (e: { target: { value: string } }) => {
        const v = e.target.value; // empty when the browser's clear button is used
        if (v) onChange(withTime ? `${v.slice(0, 16)}:00` : v);
      },
      style: {
        fontFamily: 'inherit', fontSize: 16, padding: 12, borderRadius: 14, color: colors.text,
        border: `1.5px solid ${colors.ink}`, backgroundColor: colors.card, colorScheme: 'light',
      },
    });
  }

  if (Platform.OS === 'ios') {
    return (
      <View style={{ alignItems: 'flex-start' }}>
        <DateTimePicker value={date} mode={withTime ? 'datetime' : 'date'} display="compact" themeVariant="light"
          onValueChange={(_, d) => emit(d)} />
      </View>
    );
  }

  // Android shows dialogs, one for the date and then one for the time.
  function open() {
    DateTimePickerAndroid.open({
      value: date,
      mode: 'date',
      onValueChange: (_, picked) => {
        if (!withTime) return emit(picked);
        DateTimePickerAndroid.open({
          value: picked,
          mode: 'time',
          is24Hour: true,
          onValueChange: (__, time) => emit(time),
          onDismiss: () => emit(picked), // keep the new day even if the time dialog is cancelled
        });
      },
    });
  }

  return (
    <Pressable style={s.input} onPress={open}>
      <Text style={{ fontFamily: fonts.hand, fontSize: 18, color: colors.text }}>{label(date, withTime)}</Text>
    </Pressable>
  );
}
