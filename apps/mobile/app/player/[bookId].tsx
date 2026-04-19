import { useRef, useState, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  ScrollView,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../../stores/useThemeStore';
import { ACCENT, ACCENT_DIM } from '../../lib/theme';

const { width } = Dimensions.get('window');

// ── Types ─────────────────────────────────────────────────────────────────────

type Sentence = {
  id: string;
  text: string;
  startTime: number;
  endTime: number;
};

type ContentBlock =
  | { type: 'sentence'; sentence: Sentence }
  | { type: 'image'; uri: string };

// ── Mock data ─────────────────────────────────────────────────────────────────

const MOCK_BOOK = {
  title: 'Dune',
  author: 'Frank Herbert',
  chapterTitle: "Book Two: Muad'Dib — Part 1",
};

const MOCK_SENTENCES: Sentence[] = [
  { id: 's1',  text: 'A beginning is the time for taking the most delicate care that the balances are correct.',                        startTime: 0,   endTime: 5   },
  { id: 's2',  text: 'This every sister of the Bene Gesserit knows.',                                                                 startTime: 5,   endTime: 8   },
  { id: 's3',  text: "To begin your study of the life of Muad'Dib, then, take care that you first place him in his time.",            startTime: 8,   endTime: 14  },
  { id: 's4',  text: "Born in the 57th year of the Padishah Emperor Shaddam IV, Muad'Dib was the son of a Duke and a Bene Gesserit.", startTime: 14,  endTime: 21  },
  { id: 's5',  text: 'He came to the desert world Arrakis — which the people called Dune — as a boy.',                                startTime: 21,  endTime: 27  },
  { id: 's6',  text: 'Arrakis is a place of unrelenting heat and blinding light during the day.',                                      startTime: 27,  endTime: 33  },
  { id: 's7',  text: 'The twin suns beat down upon the endless ochre sand, baking it to a ceramic hardness that cracked and shifted.', startTime: 33,  endTime: 40  },
  { id: 's8',  text: 'Nothing moved in the open erg during the midday heat — not even the great sandworms.',                          startTime: 40,  endTime: 47  },
  { id: 's9',  text: 'Paul Atreides stood at the edge of the sietch and stared out across the sea of dunes.',                         startTime: 47,  endTime: 53  },
  { id: 's10', text: 'The desert went on forever, a burned and ancient landscape that had swallowed empires.',                         startTime: 53,  endTime: 59  },
  { id: 's11', text: '"We must go deeper," said Stilgar, his voice barely above a whisper.',                                           startTime: 59,  endTime: 64  },
  { id: 's12', text: 'Paul nodded, pulling his stillsuit hood tighter against the rising wind.',                                       startTime: 64,  endTime: 70  },
  { id: 's13', text: 'The worm sign had been spotted three kilometers to the south, a distant ripple beneath the sand.',               startTime: 70,  endTime: 77  },
  { id: 's14', text: 'To ride a worm — that was the test.',                                                                            startTime: 77,  endTime: 81  },
  { id: 's15', text: 'Every Fremen boy had done it, but Paul was no ordinary boy, and this desert was not yet his home.',              startTime: 81,  endTime: 88  },
  { id: 's16', text: 'He had been trained his whole life for something, though the shape of it remained elusive, like water in the deep desert.', startTime: 88, endTime: 96 },
  { id: 's17', text: 'The Bene Gesserit called it the Kwisatz Haderach.',                                                             startTime: 96,  endTime: 101 },
  { id: 's18', text: 'The Fremen whispered of Lisan al-Gaib.',                                                                        startTime: 101, endTime: 106 },
  { id: 's19', text: 'Paul only knew that every path forward burned with terrible purpose.',                                           startTime: 106, endTime: 112 },
  { id: 's20', text: '"It is time," said Chani, appearing at his side like a shadow given form.',                                      startTime: 112, endTime: 118 },
  { id: 's21', text: 'Her eyes — the blue within blue of a spice-changed Fremen — met his without fear.',                             startTime: 118, endTime: 125 },
  { id: 's22', text: 'Paul breathed in slowly, tasting the faint cinnamon of melange on the desert wind.',                            startTime: 125, endTime: 132 },
  { id: 's23', text: 'He stepped forward onto the sand.',                                                                              startTime: 132, endTime: 136 },
];

const IMAGE_AFTER: Record<string, string> = {
  s8:  'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3f/Sand_dunes_in_the_Sahara_near_Merzouga%2C_Morocco.jpg/800px-Sand_dunes_in_the_Sahara_near_Merzouga%2C_Morocco.jpg',
  s19: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b9/Above_Gotham.jpg/800px-Above_Gotham.jpg',
};

function buildBlocks(): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  for (const sentence of MOCK_SENTENCES) {
    blocks.push({ type: 'sentence', sentence });
    if (IMAGE_AFTER[sentence.id]) {
      blocks.push({ type: 'image', uri: IMAGE_AFTER[sentence.id] });
    }
  }
  return blocks;
}

const BLOCKS = buildBlocks();
const TOTAL_DURATION = MOCK_SENTENCES[MOCK_SENTENCES.length - 1].endTime;
const SPEEDS = [0.75, 1.0, 1.25, 1.5, 2.0];

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function activeSentenceIndex(position: number): number {
  for (let i = MOCK_SENTENCES.length - 1; i >= 0; i--) {
    if (position >= MOCK_SENTENCES[i].startTime) return i;
  }
  return 0;
}

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function PlayerScreen() {
  const router = useRouter();
  const { theme, isDark } = useThemeStore();
  const scrollRef = useRef<ScrollView>(null);
  const sentenceRefs = useRef<Record<string, number>>({});
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [position, setPosition] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1.0);

  const activeIdx = activeSentenceIndex(position);
  const activeSentence = MOCK_SENTENCES[activeIdx];
  const progress = position / TOTAL_DURATION;
  const timeLeft = TOTAL_DURATION - position;

  // Simulated playback tick
  useEffect(() => {
    if (isPlaying) {
      intervalRef.current = setInterval(() => {
        setPosition((p) => {
          const next = p + 0.25 * speed;
          if (next >= TOTAL_DURATION) { setIsPlaying(false); return TOTAL_DURATION; }
          return next;
        });
      }, 250);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isPlaying, speed]);

  // Auto-scroll to active sentence
  useEffect(() => {
    const y = sentenceRefs.current[activeSentence.id];
    if (y !== undefined && scrollRef.current) {
      scrollRef.current.scrollTo({ y: Math.max(0, y - 120), animated: true });
    }
  }, [activeSentence.id]);

  function cycleSpeed() {
    const i = SPEEDS.indexOf(speed);
    setSpeed(SPEEDS[(i + 1) % SPEEDS.length]);
  }

  return (
    <View style={[s.root, { backgroundColor: theme.bg }]}>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={theme.bg}
      />

      <SafeAreaView style={s.safe} edges={['top']}>
        {/* Header */}
        <View style={[s.header, { borderBottomColor: theme.border }]}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={24} color={theme.icon} />
          </TouchableOpacity>
          <Text style={[s.headerTitle, { color: ACCENT }]} numberOfLines={1}>
            {MOCK_BOOK.title}
          </Text>
          <TouchableOpacity hitSlop={12}>
            <Ionicons name="share-outline" size={22} color={ACCENT} />
          </TouchableOpacity>
        </View>

        {/* Chapter text + images */}
        <ScrollView
          ref={scrollRef}
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Text style={[s.chapterTitle, { color: ACCENT }]}>
            {MOCK_BOOK.chapterTitle}
          </Text>

          {BLOCKS.map((block, i) => {
            if (block.type === 'image') {
              return (
                <Image
                  key={`img-${i}`}
                  source={{ uri: block.uri }}
                  style={s.inlineImage}
                  resizeMode="contain"
                />
              );
            }

            const { sentence } = block;
            const isActive = sentence.id === activeSentence.id;

            return (
              <TouchableOpacity
                key={sentence.id}
                activeOpacity={0.6}
                onPress={() => setPosition(sentence.startTime)}
                onLayout={(e) => {
                  sentenceRefs.current[sentence.id] = e.nativeEvent.layout.y;
                }}
              >
                <Text
                  style={[
                    s.sentence,
                    { color: theme.text },
                    isActive && { backgroundColor: ACCENT_DIM, color: isDark ? '#fff' : '#000' },
                  ]}
                >
                  {sentence.text}{' '}
                </Text>
              </TouchableOpacity>
            );
          })}

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>

      {/* Bottom player bar */}
      <SafeAreaView
        style={[s.playerBar, { backgroundColor: theme.playerBar, borderTopColor: theme.border }]}
        edges={['bottom']}
      >
        {/* Segmented progress bar */}
        <View style={[s.progressTrack, { backgroundColor: theme.border }]}>
          <View style={[s.progressFill, { width: `${progress * 100}%` }]} />
          {[0.2, 0.4, 0.6, 0.8].map((tick) => (
            <View key={tick} style={[s.tick, { left: `${tick * 100}%` }]} />
          ))}
        </View>

        {/* Times */}
        <View style={s.timeRow}>
          <Text style={[s.timeText, { color: theme.textMuted }]}>{formatTime(position)}</Text>
          <Text style={[s.timeCenter, { color: theme.textMuted }]}>
            {formatTime(timeLeft)} left ({speed === 1 ? '1×' : `${speed}×`})
          </Text>
          <Text style={[s.timeText, { color: theme.textMuted }, { textAlign: 'right' }]}>
            -{formatTime(timeLeft)}
          </Text>
        </View>

        {/* Controls */}
        <View style={s.controls}>
          <TouchableOpacity hitSlop={10}>
            <Ionicons name="list" size={26} color={ACCENT} />
          </TouchableOpacity>

          <TouchableOpacity hitSlop={10} onPress={() => setPosition((p) => Math.max(0, p - 15))}>
            <Ionicons name="arrow-undo" size={30} color={theme.icon} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.playBtn, { shadowColor: ACCENT }]}
            onPress={() => setIsPlaying((p) => !p)}
          >
            <Ionicons
              name={isPlaying ? 'pause' : 'play'}
              size={34}
              color="#fff"
              style={isPlaying ? {} : { marginLeft: 3 }}
            />
          </TouchableOpacity>

          <TouchableOpacity hitSlop={10} onPress={() => setPosition((p) => Math.min(TOTAL_DURATION, p + 15))}>
            <Ionicons name="arrow-redo" size={30} color={theme.icon} />
          </TouchableOpacity>

          <TouchableOpacity hitSlop={10} onPress={cycleSpeed}>
            <Text style={[s.speedBtn, { color: theme.text }]}>
              {speed === 1 ? '1×' : `${speed}×`}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
    marginHorizontal: 8,
  },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24 },

  chapterTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 20,
    textAlign: 'center',
  },
  sentence: {
    fontSize: 19,
    lineHeight: 32,
    marginBottom: 2,
    borderRadius: 4,
  },
  inlineImage: {
    width: width - 40,
    height: (width - 40) * 0.65,
    marginVertical: 20,
    alignSelf: 'center',
  },

  playerBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 6,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    marginBottom: 6,
    overflow: 'hidden',
    position: 'relative',
  },
  progressFill: {
    height: '100%',
    backgroundColor: ACCENT,
    borderRadius: 3,
  },
  tick: {
    position: 'absolute',
    top: 0,
    width: 2,
    height: '100%',
    backgroundColor: '#fff',
    opacity: 0.5,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  timeText: { fontSize: 12, width: 52 },
  timeCenter: { fontSize: 12, textAlign: 'center' },

  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 4,
  },
  playBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  speedBtn: {
    fontSize: 15,
    fontWeight: '700',
    width: 36,
    textAlign: 'center',
  },
});
