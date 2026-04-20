import { View, Text, Switch, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useThemeStore } from '../../stores/useThemeStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { ACCENT } from '../../lib/theme';

function Row({
  icon,
  label,
  right,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  right: React.ReactNode;
}) {
  const { theme } = useThemeStore();
  return (
    <View style={[row.wrapper, { borderBottomColor: theme.border }]}>
      <Ionicons name={icon} size={20} color={ACCENT} style={row.icon} />
      <Text style={[row.label, { color: theme.text }]}>{label}</Text>
      <View style={row.right}>{right}</View>
    </View>
  );
}

const row = StyleSheet.create({
  wrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  icon: { marginRight: 14 },
  label: { flex: 1, fontSize: 16 },
  right: { alignItems: 'flex-end' },
});

export default function SettingsScreen() {
  const { theme, isDark, toggle } = useThemeStore();
  const { signOut } = useAuthStore();
  const router = useRouter();

  async function handleSignOut() {
    Alert.alert('Sign Out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await signOut();
          router.replace('/(auth)');
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: theme.bg }]} edges={['top']}>
      <View style={[s.header, { borderBottomColor: theme.border }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="chevron-back" size={24} color={theme.text} />
        </TouchableOpacity>
        <Text style={[s.title, { color: theme.text }]}>Settings</Text>
      </View>

      <View style={[s.section, { backgroundColor: theme.bg }]}>
        <Text style={[s.sectionLabel, { color: theme.textMuted }]}>APPEARANCE</Text>

        <Row
          icon="moon-outline"
          label="Dark Mode"
          right={
            <Switch
              value={isDark}
              onValueChange={toggle}
              trackColor={{ false: '#ccc', true: ACCENT }}
              thumbColor="#fff"
            />
          }
        />
      </View>

      <View style={[s.section, { backgroundColor: theme.bg }]}>
        <Text style={[s.sectionLabel, { color: theme.textMuted }]}>PLAYBACK</Text>

        <Row
          icon="speedometer-outline"
          label="Default Speed"
          right={<Text style={[s.value, { color: theme.textSecondary }]}>1×</Text>}
        />
        <Row
          icon="mic-outline"
          label="Default Voice"
          right={<Text style={[s.value, { color: theme.textSecondary }]}>af_heart</Text>}
        />
      </View>

      <View style={[s.section, { backgroundColor: theme.bg }]}>
        <Text style={[s.sectionLabel, { color: theme.textMuted }]}>ACCOUNT</Text>

        <TouchableOpacity onPress={handleSignOut}>
          <Row
            icon="log-out-outline"
            label="Sign Out"
            right={<Ionicons name="chevron-forward" size={16} color={theme.textMuted} />}
          />
        </TouchableOpacity>
      </View>

      <Text style={[s.version, { color: theme.textMuted }]}>AudioBook v1.0.0</Text>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 22, fontWeight: '700' },
  section: { paddingHorizontal: 20, marginTop: 24 },
  sectionLabel: { fontSize: 11, fontWeight: '600', letterSpacing: 1, marginBottom: 4 },
  value: { fontSize: 15 },
  version: { textAlign: 'center', fontSize: 12, marginTop: 'auto', paddingBottom: 16 },
});
