import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useThemeStore } from '../stores/useThemeStore';
import { useAuthStore } from '../stores/useAuthStore';
import { ACCENT, ACCENT_DIM } from '../lib/theme';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001';

type Stage = 'idle' | 'uploading' | 'processing' | 'done' | 'error';

export default function UploadScreen() {
  const router = useRouter();
  const { theme, isDark } = useThemeStore();
  const { session } = useAuthStore();

  const [stage, setStage] = useState<Stage>('idle');
  const [fileName, setFileName] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [bookTitle, setBookTitle] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (stage === 'processing') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.4, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    }
  }, [stage]);

  async function pickAndUpload() {
    setErrorMsg(null);
    setUploadProgress(0);

    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/epub+zip',
      copyToCacheDirectory: true,
    });

    if (result.canceled || !result.assets?.length) return;

    const asset = result.assets[0];
    setFileName(asset.name);
    setStage('uploading');

    try {
      const token = session?.access_token;
      if (!token) throw new Error('Not authenticated');

      const uploadResult = await FileSystem.uploadAsync(
        `${API_URL}/api/books/upload`,
        asset.uri,
        {
          httpMethod: 'POST',
          uploadType: FileSystem.FileSystemUploadType.MULTIPART,
          fieldName: 'epub',
          mimeType: 'application/epub+zip',
          headers: { Authorization: `Bearer ${token}` },
          sessionType: FileSystem.FileSystemSessionType.FOREGROUND,
        }
      );

      if (uploadResult.status !== 201) {
        const body = JSON.parse(uploadResult.body);
        throw new Error(body.error ?? 'Upload failed');
      }

      const book = JSON.parse(uploadResult.body);
      setBookTitle(book.title);
      setStage('processing');
    } catch (e: any) {
      console.error('Upload error:', e);
      setErrorMsg(e.message ?? 'Something went wrong');
      setStage('error');
    }
  }

  function goToLibrary() {
    router.replace('/(tabs)/');
  }

  function retry() {
    setStage('idle');
    setFileName(null);
    setErrorMsg(null);
  }

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: theme.bg }]} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="close" size={24} color={theme.icon} />
        </TouchableOpacity>
        <Text style={[s.title, { color: theme.text }]}>Add Book</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={s.body}>
        {stage === 'idle' && (
          <>
            <TouchableOpacity
              style={[s.dropZone, { borderColor: ACCENT, backgroundColor: ACCENT_DIM }]}
              activeOpacity={0.7}
              onPress={pickAndUpload}
            >
              <Ionicons name="book-outline" size={48} color={ACCENT} />
              <Text style={[s.dropTitle, { color: theme.text }]}>Select an EPUB file</Text>
              <Text style={[s.dropSub, { color: theme.textMuted }]}>Tap to browse your files</Text>
            </TouchableOpacity>
            <Text style={[s.hint, { color: theme.textMuted }]}>
              Max file size: 50 MB
            </Text>
          </>
        )}

        {stage === 'uploading' && (
          <View style={s.stateBox}>
            <ActivityIndicator size="large" color={ACCENT} />
            <Text style={[s.stateTitle, { color: theme.text }]}>Uploading…</Text>
            <Text style={[s.stateSub, { color: theme.textMuted }]} numberOfLines={1}>
              {fileName}
            </Text>
          </View>
        )}

        {stage === 'processing' && (
          <View style={s.stateBox}>
            <Animated.View style={{ opacity: pulseAnim }}>
              <Ionicons name="musical-notes" size={56} color={ACCENT} />
            </Animated.View>
            <Text style={[s.stateTitle, { color: theme.text }]}>Generating audio…</Text>
            {bookTitle && (
              <Text style={[s.bookName, { color: ACCENT }]}>{bookTitle}</Text>
            )}
            <Text style={[s.stateSub, { color: theme.textMuted }]}>
              Chapters will appear in your library as they finish.
            </Text>
            <TouchableOpacity
              style={[s.btn, { backgroundColor: ACCENT, marginTop: 32 }]}
              onPress={goToLibrary}
              activeOpacity={0.8}
            >
              <Text style={s.btnText}>Go to Library</Text>
            </TouchableOpacity>
          </View>
        )}

        {stage === 'error' && (
          <View style={s.stateBox}>
            <Ionicons name="alert-circle-outline" size={56} color="#ef4444" />
            <Text style={[s.stateTitle, { color: theme.text }]}>Upload failed</Text>
            <Text style={[s.stateSub, { color: '#ef4444' }]}>{errorMsg}</Text>
            <TouchableOpacity
              style={[s.btn, { backgroundColor: ACCENT, marginTop: 32 }]}
              onPress={retry}
              activeOpacity={0.8}
            >
              <Text style={s.btnText}>Try again</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  title: { fontSize: 17, fontWeight: '700' },
  body: { flex: 1, paddingHorizontal: 24, justifyContent: 'center', paddingBottom: 60 },
  dropZone: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: 20,
    paddingVertical: 52,
    alignItems: 'center',
    gap: 12,
  },
  dropTitle: { fontSize: 18, fontWeight: '700', marginTop: 4 },
  dropSub: { fontSize: 14 },
  hint: { fontSize: 12, textAlign: 'center', marginTop: 16 },
  stateBox: { alignItems: 'center', gap: 12 },
  stateTitle: { fontSize: 20, fontWeight: '700', marginTop: 8 },
  bookName: { fontSize: 16, fontWeight: '600' },
  stateSub: { fontSize: 14, textAlign: 'center', lineHeight: 20, paddingHorizontal: 16 },
  btn: { borderRadius: 12, paddingVertical: 14, paddingHorizontal: 40, alignItems: 'center' },
  btnText: { fontSize: 16, fontWeight: '700', color: '#000' },
});
