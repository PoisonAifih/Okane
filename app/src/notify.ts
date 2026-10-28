import { Alert, Platform } from 'react-native';

// react-native-web's Alert is a no-op, so the browser gets window.alert/confirm instead.

export function notify(title: string, message?: string) {
  if (Platform.OS === 'web') window.alert(message ? `${title}\n\n${message}` : title);
  else Alert.alert(title, message);
}

export function confirmDestructive(title: string, action: string, onYes: () => void) {
  if (Platform.OS === 'web') {
    if (window.confirm(title)) onYes();
    return;
  }
  Alert.alert(title, undefined, [
    { text: 'Cancel', style: 'cancel' },
    { text: action, style: 'destructive', onPress: onYes },
  ]);
}
