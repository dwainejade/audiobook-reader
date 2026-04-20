import { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  StatusBar,
  Image,
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useThemeStore } from '../../stores/useThemeStore';
import { ACCENT, ACCENT_DIM } from '../../lib/theme';
import { useBooks, type Book } from '../../lib/useBooks';
import { supabase } from '../../lib/supabase';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001';

const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - 48) / 2;

// ── StatusBadge ───────────────────────────────────────────────────────────────

function StatusBadge({ status, done, total }: { status: string; done: number; total: number }) {
  const { isDark } = useThemeStore();
  if (status === 'processing') {
    return (
      <View style={[badge.pill, { backgroundColor: ACCENT_DIM }]}>
        <Text style={[badge.text, { color: ACCENT }]}>⚙ {done}/{total}</Text>
      </View>
    );
  }
  if (status === 'pending') {
    return (
      <View style={[badge.pill, { backgroundColor: isDark ? '#ffffff11' : '#00000011' }]}>
        <Text style={[badge.text, { color: isDark ? '#888' : '#666' }]}>Queued</Text>
      </View>
    );
  }
  return null;
}

const badge = StyleSheet.create({
  pill: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'flex-start' },
  text: { fontSize: 10, fontWeight: '600' },
});

// ── BookMenu ──────────────────────────────────────────────────────────────────

function BookMenu({
  book,
  visible,
  onClose,
  onDelete,
}: {
  book: Book;
  visible: boolean;
  onClose: () => void;
  onDelete: () => void;
}) {
  const { theme } = useThemeStore();

  function handleDelete() {
    onClose();
    Alert.alert('Delete Book', `Remove "${book.title}" from your library?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: onDelete },
    ]);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={menu.overlay} onPress={onClose}>
        <View style={[menu.sheet, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[menu.bookTitle, { color: theme.textMuted }]} numberOfLines={1}>
            {book.title}
          </Text>
          <View style={[menu.divider, { backgroundColor: theme.border }]} />
          <TouchableOpacity style={menu.row} onPress={handleDelete}>
            <Ionicons name="trash-outline" size={18} color="#ef4444" />
            <Text style={[menu.rowText, { color: '#ef4444' }]}>Delete</Text>
          </TouchableOpacity>
        </View>
      </Pressable>
    </Modal>
  );
}

const menu = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: '#00000055', justifyContent: 'center', alignItems: 'center' },
  sheet: {
    width: 240,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    paddingVertical: 4,
  },
  bookTitle: { fontSize: 12, paddingHorizontal: 16, paddingVertical: 10 },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 14 },
  rowText: { fontSize: 15 },
});

// ── BookCard ──────────────────────────────────────────────────────────────────

function BookCard({ book, onDelete }: { book: Book; onDelete: (id: string) => void }) {
  const router = useRouter();
  const { theme } = useThemeStore();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <TouchableOpacity
        style={card.wrapper}
        activeOpacity={0.75}
        onPress={() => router.push(`/player/${book.id}`)}
      >
        <View style={[card.coverWrapper, { backgroundColor: theme.bgSecondary }]}>
          <Image source={{ uri: book.cover_url ?? undefined }} style={card.cover} resizeMode="cover" />
          {book.progress > 0 && book.progress < 1 && (
            <View style={card.progressBar}>
              <View style={[card.progressFill, { width: `${book.progress * 100}%` }]} />
            </View>
          )}
          {book.progress === 1 && (
            <View style={[card.finishedBadge, { backgroundColor: ACCENT }]}>
              <Text style={card.finishedText}>✓</Text>
            </View>
          )}
          <TouchableOpacity
            style={card.dotsBtn}
            hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
            onPress={() => setMenuOpen(true)}
          >
            <Ionicons name="ellipsis-vertical" size={16} color="#fff" />
          </TouchableOpacity>
        </View>
        <View style={card.info}>
          <Text style={[card.title, { color: theme.text }]} numberOfLines={2}>{book.title}</Text>
          <Text style={[card.author, { color: theme.textMuted }]} numberOfLines={1}>{book.author}</Text>
          <StatusBadge status={book.status} done={book.done_chapters} total={book.total_chapters} />
        </View>
      </TouchableOpacity>

      <BookMenu
        book={book}
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        onDelete={() => onDelete(book.id)}
      />
    </>
  );
}

const card = StyleSheet.create({
  wrapper: { width: CARD_WIDTH, marginBottom: 20 },
  coverWrapper: { width: CARD_WIDTH, height: CARD_WIDTH * 1.4, borderRadius: 8, overflow: 'hidden', marginBottom: 8 },
  cover: { width: '100%', height: '100%' },
  progressBar: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, backgroundColor: '#ffffff22' },
  progressFill: { height: '100%', backgroundColor: ACCENT },
  finishedBadge: { position: 'absolute', top: 8, right: 8, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  finishedText: { fontSize: 12, color: '#000', fontWeight: '700' },
  dotsBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#00000066',
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: { gap: 3 },
  title: { fontSize: 13, fontWeight: '600' },
  author: { fontSize: 12, marginBottom: 4 },
});

// ── MiniPlayer ────────────────────────────────────────────────────────────────

function MiniPlayer({ book }: { book: Book }) {
  const router = useRouter();
  const { theme } = useThemeStore();
  return (
    <View style={[mp.container, { backgroundColor: theme.surface, borderTopColor: theme.border }]}>
      <TouchableOpacity
        style={mp.wrapper}
        activeOpacity={0.9}
        onPress={() => router.push(`/player/${book.id}`)}
      >
        <Image source={{ uri: book.cover_url ?? undefined }} style={mp.cover} resizeMode="cover" />
        <View style={mp.info}>
          <Text style={[mp.title, { color: theme.text }]} numberOfLines={1}>{book.title}</Text>
          <Text style={[mp.chapter, { color: theme.textMuted }]} numberOfLines={1}>{book.current_chapter}</Text>
          <View style={[mp.track, { backgroundColor: theme.border }]}>
            <View style={[mp.fill, { width: `${book.progress * 100}%` }]} />
          </View>
        </View>
        <View style={[mp.playBtn, { backgroundColor: ACCENT }]}>
          <Ionicons name="play" size={22} color="#000" />
        </View>
      </TouchableOpacity>
    </View>
  );
}

const mp = StyleSheet.create({
  container: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingBottom: 8,
  },
  wrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 15,
  },
  cover: { width: 55, height: 55, borderRadius: 8 },
  info: { flex: 1, gap: 5 },
  title: { fontSize: 16, fontWeight: '600' },
  chapter: { fontSize: 14 },
  track: { height: 3, borderRadius: 2, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: ACCENT },
  playBtn: { width: 45, height: 45, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
});

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function LibraryScreen() {
  const router = useRouter();
  const { theme, isDark } = useThemeStore();
  const { books, loading } = useBooks();

  async function deleteBook(id: string) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const res = await fetch(`${API_URL}/api/books/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) {
      Alert.alert('Error', 'Could not delete book. Please try again.');
    }
  }

  const inProgress = books.filter((b) => b.progress > 0 && b.progress < 1);
  const miniPlayerBook = books.find((b) => b.progress > 0) ?? null;

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: theme.bg }]} edges={['top', 'bottom']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={theme.bg} />

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={s.header}>
          <TouchableOpacity
            style={[s.iconBtn, { backgroundColor: theme.bgSecondary }]}
            onPress={() => router.push('/(tabs)/settings')}
          >
            <Ionicons name="person" size={18} color={theme.icon} />
          </TouchableOpacity>
          <View style={s.headerActions}>
            <TouchableOpacity style={[s.iconBtn, { backgroundColor: theme.bgSecondary }]}>
              <Ionicons name="search" size={18} color={theme.icon} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.iconBtn, { backgroundColor: ACCENT }]}
              onPress={() => router.push('/upload')}
            >
              <Ionicons name="add" size={20} color="#000" />
            </TouchableOpacity>
          </View>
        </View>

        {loading ? (
          <ActivityIndicator color={ACCENT} style={{ marginTop: 40 }} />
        ) : (
          <>
            {/* Continue Listening */}
            {inProgress.length > 0 && (
              <>
                <Text style={[s.sectionTitle, { color: theme.text }]}>Continue Listening</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={s.horizontal}
                  style={s.horizontalScroll}
                >
                  {inProgress.map((book) => (
                    <ContinueCard key={book.id} book={book} />
                  ))}
                </ScrollView>
              </>
            )}

            {/* My Books */}
            <View style={s.sectionHeader}>
              <Text style={[s.sectionTitle, { color: theme.text }]}>My Books</Text>
              <Text style={[s.bookCount, { color: theme.textMuted }]}>{books.length} books</Text>
            </View>

            <FlatList
              data={books}
              keyExtractor={(item) => item.id}
              numColumns={2}
              columnWrapperStyle={s.row}
              renderItem={({ item }) => <BookCard book={item} onDelete={deleteBook} />}
              scrollEnabled={false}
            />
          </>
        )}
      </ScrollView>

      {/* Mini player */}
      {miniPlayerBook && <MiniPlayer book={miniPlayerBook} />}
    </SafeAreaView>
  );
}

// ── ContinueCard (unchanged) ──────────────────────────────────────────────────

function ContinueCard({ book }: { book: Book }) {
  const router = useRouter();
  const { theme } = useThemeStore();
  return (
    <TouchableOpacity
      style={[cont.wrapper, { backgroundColor: theme.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border }]}
      activeOpacity={0.75}
      onPress={() => router.push(`/player/${book.id}`)}
    >
      <Image source={{ uri: book.cover_url ?? undefined }} style={cont.cover} resizeMode="cover" />
      <View style={cont.body}>
        <Text style={[cont.title, { color: theme.text }]} numberOfLines={1}>{book.title}</Text>
        <Text style={[cont.chapter, { color: theme.textMuted }]} numberOfLines={2}>{book.current_chapter}</Text>
        <View style={cont.progressRow}>
          <View style={[cont.track, { backgroundColor: theme.border }]}>
            <View style={[cont.fill, { width: `${book.progress * 100}%` }]} />
          </View>
          <Text style={[cont.pct, { color: ACCENT }]}>{Math.round(book.progress * 100)}%</Text>
        </View>
        <View style={[cont.playBtn, { backgroundColor: ACCENT }]}>
          <Text style={cont.playText}>▶  Continue</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const cont = StyleSheet.create({
  wrapper: { width: 260, borderRadius: 12, flexDirection: 'row', overflow: 'hidden', marginRight: 12 },
  cover: { width: 90, height: 130 },
  body: { flex: 1, padding: 12, justifyContent: 'space-between' },
  title: { fontSize: 14, fontWeight: '700' },
  chapter: { fontSize: 11, lineHeight: 16 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  track: { flex: 1, height: 3, borderRadius: 2 },
  fill: { height: '100%', backgroundColor: ACCENT, borderRadius: 2 },
  pct: { fontSize: 10, fontWeight: '600', width: 28 },
  playBtn: { borderRadius: 8, paddingVertical: 7, alignItems: 'center' },
  playText: { fontSize: 13, fontWeight: '700', color: '#000' },
});

const s = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 20 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 20,
  },
  headerActions: { flexDirection: 'row', gap: 8 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { fontSize: 18, fontWeight: '700', paddingHorizontal: 16, marginBottom: 12 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingRight: 16, marginTop: 24 },
  bookCount: { fontSize: 13 },
  horizontal: { paddingHorizontal: 16, paddingBottom: 4 },
  horizontalScroll: { marginBottom: 4 },
  row: { paddingHorizontal: 16, justifyContent: 'space-between' },
});
