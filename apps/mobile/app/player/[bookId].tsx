import { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  useAudioPlayer,
  useAudioPlayerStatus,
  setAudioModeAsync,
} from "expo-audio";
import { useThemeStore } from "../../stores/useThemeStore";
import EpubReader, { type EpubReaderHandle } from "../../lib/EpubReader";
import PlayerControls from "../../lib/PlayerControls";
import { useAuthStore } from "../../stores/useAuthStore";
import { ACCENT } from "../../lib/theme";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001";

type TocEntry = { title: string; chapterIndex: number; href?: string };

type Chapter = {
  id: string;
  index: number;
  title: string;
  text: string;
  html?: string;
  spans: unknown[];
  images: unknown[];
  timestamps: { charStart: number; timeSec: number }[] | null;
  status: "pending" | "processing" | "done" | "failed";
  audio_url: string | null;
};

export default function PlayerScreen() {
  const router = useRouter();
  const { bookId } = useLocalSearchParams<{ bookId: string }>();
  const { theme, isDark, fontSize } = useThemeStore();
  const { session } = useAuthStore();

  const [book, setBook] = useState<{
    title: string;
    author: string;
    toc: TocEntry[];
    status: string;
    epub_url: string | null;
  } | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [chapterIdx, setChapterIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [speed, setSpeed] = useState(1.0);
  const chapterDurations = useRef<Record<number, number>>({});
  const epubReaderRef = useRef<EpubReaderHandle>(null);
  const chapterIdxInitialized = useRef(false);
  const spineHrefs = useRef<string[]>([]);

  const chapter = chapters[chapterIdx] ?? null;

  const player = useAudioPlayer(chapter?.audio_url ?? null, {
    updateInterval: 250,
  });
  const status = useAudioPlayerStatus(player);

  const positionSec = status.currentTime ?? 0;
  const durationSec = status.duration ?? 0;
  const isPlaying = status.playing ?? false;

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true });
  }, []);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`${API_URL}/api/books/${bookId}`, {
          headers: { Authorization: `Bearer ${session?.access_token}` },
        });
        if (!res.ok) throw new Error("Failed to load book");
        const data = await res.json();

        setBook({
          title: data.title,
          author: data.author,
          toc: data.toc ?? [],
          status: data.status ?? "done",
          epub_url: data.epub_url ?? null,
        });
        setChapters(
          (data.chapters ?? []).filter((c: Chapter) => c.status === "done"),
        );
      } catch (e: any) {
        setFetchError(e.message);
      } finally {
        setLoading(false);
      }
    }
    if (bookId && session) load();
  }, [bookId, session]);

  useEffect(() => {
    if (chapter?.audio_url) player.replace({ uri: chapter.audio_url });
  }, [chapter?.id]);

  useEffect(() => {
    if (!chapterIdxInitialized.current) {
      chapterIdxInitialized.current = true;
      return;
    }
    const tocHref = book?.toc?.find((e) => e.chapterIndex === chapterIdx)?.href;
    if (!tocHref) return;
    // Match stored href (e.g. "ops/xhtml/ch01.html") against epub.js spine hrefs
    // which may be shorter (e.g. "xhtml/ch01.html") — match by suffix
    const epubHref = spineHrefs.current.find(
      (h) => tocHref.endsWith(h) || h.endsWith(tocHref) || h === tocHref,
    ) ?? tocHref;
    epubReaderRef.current?.navigateTo(epubHref);
  }, [chapterIdx, book]);

  useEffect(() => {
    player.setPlaybackRate(speed);
  }, [speed]);

  useEffect(() => {
    if (status.didJustFinish) {
      setChapterIdx((i) => Math.min(i + 1, chapters.length - 1));
    }
  }, [status.didJustFinish]);

  async function seek(deltaSec: number) {
    await player.seekTo(Math.max(0, Math.min(durationSec, positionSec + deltaSec)));
  }

  useEffect(() => {
    if (durationSec > 0) chapterDurations.current[chapterIdx] = durationSec;
  }, [durationSec, chapterIdx]);

  const totalChapters = chapters.length || 1;
  const bookProgress =
    (chapterIdx + (durationSec ? positionSec / durationSec : 0)) / totalChapters;

  const toc = book
    ? book.toc?.length
      ? book.toc
      : chapters.map((ch, i) => ({ title: ch.title, chapterIndex: i }))
    : [];

  if (loading) {
    return (
      <View
        style={[
          s.root,
          {
            backgroundColor: theme.bg,
            alignItems: "center",
            justifyContent: "center",
          },
        ]}
      >
        <ActivityIndicator color={ACCENT} size="large" />
      </View>
    );
  }

  if (fetchError || !book) {
    return (
      <View
        style={[
          s.root,
          {
            backgroundColor: theme.bg,
            alignItems: "center",
            justifyContent: "center",
          },
        ]}
      >
        <Text style={{ color: theme.textMuted }}>
          {fetchError ?? "Book not found"}
        </Text>
      </View>
    );
  }

  return (
    <View style={[s.root, { backgroundColor: theme.bg }]}>
      <StatusBar
        barStyle={isDark ? "light-content" : "dark-content"}
        backgroundColor={theme.bg}
      />

      <SafeAreaView style={s.safe} edges={["top"]}>
        <View style={[s.header, { borderBottomColor: theme.border }]}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={24} color={theme.icon} />
          </TouchableOpacity>
          <Text style={[s.headerTitle, { color: ACCENT }]} numberOfLines={1}>
            {book.title}
          </Text>
          <View style={{ width: 24 }} />
        </View>

        {book.epub_url ? (
          <EpubReader
            ref={epubReaderRef}
            epubUrl={book.epub_url}
            fontSize={fontSize}
            textColor={theme.text}
            bg={theme.bg}
            onSpineReady={(hrefs) => { spineHrefs.current = hrefs; }}
          />
        ) : (
          <View style={s.scroll}>
            <Text style={{ color: theme.textMuted, padding: 24 }}>
              No EPUB available.
            </Text>
          </View>
        )}
      </SafeAreaView>

      <SafeAreaView
        style={[s.playerBar, { backgroundColor: theme.playerBar, borderTopColor: theme.border }]}
        edges={["bottom"]}
      >
        <PlayerControls
          positionSec={positionSec}
          durationSec={durationSec}
          isPlaying={isPlaying}
          speed={speed}
          bookProgress={bookProgress}
          chapterIdx={chapterIdx}
          toc={toc}
          onPlay={() => player.play()}
          onPause={() => player.pause()}
          onSeek={seek}
          onSpeedChange={setSpeed}
          onChapterSelect={setChapterIdx}
        />
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 16,
    fontWeight: "700",
    marginHorizontal: 8,
  },
  scroll: { flex: 1 },
  playerBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 6,
  },
});
