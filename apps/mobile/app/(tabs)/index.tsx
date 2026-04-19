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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - 48) / 2;

// ── Mock data ────────────────────────────────────────────────────────────────

const RECENT_BOOKS = [
  {
    id: '1',
    title: 'Dune',
    author: 'Frank Herbert',
    cover: 'https://covers.openlibrary.org/b/id/8231432-L.jpg',
    progress: 0.62,
    currentChapter: 'Book Two: Muad\'Dib',
    totalChapters: 48,
    doneChapters: 30,
  },
  {
    id: '2',
    title: 'The Hobbit',
    author: 'J.R.R. Tolkien',
    cover: 'https://covers.openlibrary.org/b/id/8406786-L.jpg',
    progress: 0.28,
    currentChapter: 'Chapter 4: Over Hill and Under Hill',
    totalChapters: 19,
    doneChapters: 19,
  },
];

const LIBRARY_BOOKS = [
  {
    id: '1',
    title: 'Dune',
    author: 'Frank Herbert',
    cover: 'https://covers.openlibrary.org/b/id/8231432-L.jpg',
    progress: 0.62,
    totalChapters: 48,
    doneChapters: 30,
    status: 'processing',
  },
  {
    id: '2',
    title: 'The Hobbit',
    author: 'J.R.R. Tolkien',
    cover: 'https://covers.openlibrary.org/b/id/8406786-L.jpg',
    progress: 0.28,
    totalChapters: 19,
    doneChapters: 19,
    status: 'done',
  },
  {
    id: '3',
    title: 'Project Hail Mary',
    author: 'Andy Weir',
    cover: 'https://covers.openlibrary.org/b/id/10519563-L.jpg',
    progress: 0,
    totalChapters: 32,
    doneChapters: 0,
    status: 'processing',
  },
  {
    id: '4',
    title: 'Neuromancer',
    author: 'William Gibson',
    cover: 'https://covers.openlibrary.org/b/id/8771165-L.jpg',
    progress: 1,
    totalChapters: 24,
    doneChapters: 24,
    status: 'done',
  },
  {
    id: '5',
    title: 'Ender\'s Game',
    author: 'Orson Scott Card',
    cover: 'https://covers.openlibrary.org/b/id/8739161-L.jpg',
    progress: 0,
    totalChapters: 15,
    doneChapters: 0,
    status: 'pending',
  },
];

// ── Sub-components ────────────────────────────────────────────────────────────

function ProgressRing({
  progress,
  size = 36,
  stroke = 3,
}: {
  progress: number;
  size?: number;
  stroke?: number;
}) {
  const pct = Math.round(progress * 100);
  return (
    <View style={[ringStyles.wrapper, { width: size, height: size }]}>
      <View
        style={[
          ringStyles.track,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: stroke,
          },
        ]}
      />
      <View style={ringStyles.label}>
        <Text style={ringStyles.text}>{pct}%</Text>
      </View>
    </View>
  );
}

const ringStyles = StyleSheet.create({
  wrapper: { position: 'relative', alignItems: 'center', justifyContent: 'center' },
  track: {
    position: 'absolute',
    borderColor: '#f59e0b33',
  },
  label: { alignItems: 'center', justifyContent: 'center' },
  text: { fontSize: 8, color: '#f59e0b', fontWeight: '700' },
});

function StatusBadge({ status, done, total }: { status: string; done: number; total: number }) {
  if (status === 'processing') {
    return (
      <View style={[badge.pill, badge.processing]}>
        <Text style={badge.text}>⚙ {done}/{total}</Text>
      </View>
    );
  }
  if (status === 'pending') {
    return (
      <View style={[badge.pill, badge.pending]}>
        <Text style={badge.text}>Queued</Text>
      </View>
    );
  }
  return null;
}

const badge = StyleSheet.create({
  pill: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  processing: { backgroundColor: '#f59e0b22' },
  pending: { backgroundColor: '#ffffff11' },
  text: { fontSize: 10, color: '#f59e0b', fontWeight: '600' },
});

function BookCard({ book }: { book: (typeof LIBRARY_BOOKS)[0] }) {
  return (
    <TouchableOpacity style={card.wrapper} activeOpacity={0.75}>
      <View style={card.coverWrapper}>
        <Image
          source={{ uri: book.cover }}
          style={card.cover}
          resizeMode="cover"
        />
        {book.progress > 0 && book.progress < 1 && (
          <View style={card.progressBar}>
            <View style={[card.progressFill, { width: `${book.progress * 100}%` }]} />
          </View>
        )}
        {book.progress === 1 && (
          <View style={card.finishedBadge}>
            <Text style={card.finishedText}>✓</Text>
          </View>
        )}
      </View>
      <View style={card.info}>
        <Text style={card.title} numberOfLines={2}>{book.title}</Text>
        <Text style={card.author} numberOfLines={1}>{book.author}</Text>
        <StatusBadge status={book.status} done={book.doneChapters} total={book.totalChapters} />
      </View>
    </TouchableOpacity>
  );
}

const card = StyleSheet.create({
  wrapper: {
    width: CARD_WIDTH,
    marginBottom: 20,
  },
  coverWrapper: {
    width: CARD_WIDTH,
    height: CARD_WIDTH * 1.4,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#2a2a2a',
    marginBottom: 8,
  },
  cover: { width: '100%', height: '100%' },
  progressBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: '#ffffff22',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#f59e0b',
  },
  finishedBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#f59e0b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  finishedText: { fontSize: 12, color: '#000', fontWeight: '700' },
  info: { gap: 3 },
  title: { fontSize: 13, fontWeight: '600', color: '#fff' },
  author: { fontSize: 12, color: '#888', marginBottom: 4 },
});

function ContinueCard({ book }: { book: (typeof RECENT_BOOKS)[0] }) {
  return (
    <TouchableOpacity style={cont.wrapper} activeOpacity={0.75}>
      <Image source={{ uri: book.cover }} style={cont.cover} resizeMode="cover" />
      <View style={cont.body}>
        <Text style={cont.title} numberOfLines={1}>{book.title}</Text>
        <Text style={cont.chapter} numberOfLines={2}>{book.currentChapter}</Text>
        <View style={cont.progressRow}>
          <View style={cont.track}>
            <View style={[cont.fill, { width: `${book.progress * 100}%` }]} />
          </View>
          <Text style={cont.pct}>{Math.round(book.progress * 100)}%</Text>
        </View>
        <TouchableOpacity style={cont.playBtn} activeOpacity={0.8}>
          <Text style={cont.playText}>▶  Continue</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

const cont = StyleSheet.create({
  wrapper: {
    width: 260,
    backgroundColor: '#1e1e1e',
    borderRadius: 12,
    flexDirection: 'row',
    overflow: 'hidden',
    marginRight: 12,
  },
  cover: { width: 90, height: 130 },
  body: { flex: 1, padding: 12, justifyContent: 'space-between' },
  title: { fontSize: 14, fontWeight: '700', color: '#fff' },
  chapter: { fontSize: 11, color: '#888', lineHeight: 16 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  track: { flex: 1, height: 3, backgroundColor: '#333', borderRadius: 2 },
  fill: { height: '100%', backgroundColor: '#f59e0b', borderRadius: 2 },
  pct: { fontSize: 10, color: '#f59e0b', fontWeight: '600', width: 28 },
  playBtn: {
    backgroundColor: '#f59e0b',
    borderRadius: 8,
    paddingVertical: 7,
    alignItems: 'center',
  },
  playText: { fontSize: 13, fontWeight: '700', color: '#000' },
});

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function LibraryScreen() {
  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor="#111" />

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={s.greeting}>Good evening 👋</Text>
            <Text style={s.screenTitle}>My Library</Text>
          </View>
          <TouchableOpacity style={s.searchBtn}>
            <Ionicons name="search" size={18} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Continue Listening */}
        <Text style={s.sectionTitle}>Continue Listening</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.horizontal}
          style={s.horizontalScroll}
        >
          {RECENT_BOOKS.map((book) => (
            <ContinueCard key={book.id} book={book} />
          ))}
        </ScrollView>

        {/* My Books */}
        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>My Books</Text>
          <Text style={s.bookCount}>{LIBRARY_BOOKS.length} books</Text>
        </View>

        <FlatList
          data={LIBRARY_BOOKS}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={s.row}
          renderItem={({ item }) => <BookCard book={item} />}
          scrollEnabled={false}
        />
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity style={s.fab} activeOpacity={0.85}>
        <Ionicons name="add" size={32} color="#000" />
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#111' },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 100 },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 20,
  },
  greeting: { fontSize: 13, color: '#888' },
  screenTitle: { fontSize: 28, fontWeight: '800', color: '#fff', marginTop: 2 },
  searchBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#2a2a2a',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },

  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingRight: 16,
    marginTop: 24,
  },
  bookCount: { fontSize: 13, color: '#666' },

  horizontal: { paddingHorizontal: 16, paddingBottom: 4 },
  horizontalScroll: { marginBottom: 4 },

  row: { paddingHorizontal: 16, justifyContent: 'space-between' },

  fab: {
    position: 'absolute',
    bottom: 80,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#f59e0b',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#f59e0b',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
});
