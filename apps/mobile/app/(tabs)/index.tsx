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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useThemeStore } from '../../stores/useThemeStore';
import { ACCENT, ACCENT_DIM } from '../../lib/theme';
import { useBooks, type Book } from '../../lib/useBooks';

const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - 48) / 2;


// ── Sub-components ────────────────────────────────────────────────────────────

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

function BookCard({ book }: { book: Book }) {
  const router = useRouter();
  const { theme } = useThemeStore();
  return (
    <TouchableOpacity
      style={[card.wrapper]}
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
      </View>
      <View style={card.info}>
        <Text style={[card.title, { color: theme.text }]} numberOfLines={2}>{book.title}</Text>
        <Text style={[card.author, { color: theme.textMuted }]} numberOfLines={1}>{book.author}</Text>
        <StatusBadge status={book.status} done={book.done_chapters} total={book.total_chapters} />
      </View>
    </TouchableOpacity>
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
  info: { gap: 3 },
  title: { fontSize: 13, fontWeight: '600' },
  author: { fontSize: 12, marginBottom: 4 },
});

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

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function LibraryScreen() {
  const { theme, isDark } = useThemeStore();
  const { books, loading } = useBooks();

  const inProgress = books.filter((b) => b.progress > 0 && b.progress < 1);

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: theme.bg }]} edges={['top']}>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={theme.bg}
      />

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={[s.greeting, { color: theme.textMuted }]}>Good evening 👋</Text>
            <Text style={[s.screenTitle, { color: theme.text }]}>My Library</Text>
          </View>
          <TouchableOpacity style={[s.searchBtn, { backgroundColor: theme.bgSecondary }]}>
            <Ionicons name="search" size={18} color={theme.icon} />
          </TouchableOpacity>
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
              renderItem={({ item }) => <BookCard book={item} />}
              scrollEnabled={false}
            />
          </>
        )}
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity style={s.fab} activeOpacity={0.85}>
        <Ionicons name="add" size={32} color="#000" />
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 100 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 20 },
  greeting: { fontSize: 13 },
  screenTitle: { fontSize: 28, fontWeight: '800', marginTop: 2 },
  searchBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  sectionTitle: { fontSize: 18, fontWeight: '700', paddingHorizontal: 16, marginBottom: 12 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingRight: 16, marginTop: 24 },
  bookCount: { fontSize: 13 },
  horizontal: { paddingHorizontal: 16, paddingBottom: 4 },
  horizontalScroll: { marginBottom: 4 },
  row: { paddingHorizontal: 16, justifyContent: 'space-between' },
  fab: {
    position: 'absolute', bottom: 80, right: 20,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: ACCENT,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: ACCENT, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 8, elevation: 8,
  },
});
