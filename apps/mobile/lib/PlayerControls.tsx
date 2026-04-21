import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useThemeStore, FONT_SIZES } from "../stores/useThemeStore";
import { ACCENT } from "./theme";

const SPEEDS = [0.75, 1.0, 1.25, 1.5, 2.0];

export type TocEntry = { title: string; chapterIndex: number; href?: string };

type Props = {
  positionSec: number;
  durationSec: number;
  isPlaying: boolean;
  speed: number;
  bookProgress: number;
  chapterIdx: number;
  toc: TocEntry[];
  onPlay: () => void;
  onPause: () => void;
  onSeek: (deltaSec: number) => void;
  onSpeedChange: (speed: number) => void;
  onChapterSelect: (index: number) => void;
};

function formatTime(seconds: number) {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export default function PlayerControls({
  positionSec,
  durationSec,
  isPlaying,
  speed,
  bookProgress,
  chapterIdx,
  toc,
  onPlay,
  onPause,
  onSeek,
  onSpeedChange,
  onChapterSelect,
}: Props) {
  const { theme, fontSize, setFontSize } = useThemeStore();
  const [tocOpen, setTocOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  function cycleSpeed() {
    const i = SPEEDS.indexOf(speed);
    onSpeedChange(SPEEDS[(i + 1) % SPEEDS.length]);
  }

  return (
    <>
      {/* Progress bar */}
      <View style={[s.progressTrack, { backgroundColor: theme.border }]}>
        <View style={[s.progressFill, { width: `${bookProgress * 100}%` }]} />
      </View>

      {/* Times */}
      <View style={s.timeRow}>
        <Text style={[s.timeText, { color: theme.textMuted }]}>
          {formatTime(positionSec)}
        </Text>
        <Text style={[s.timeCenter, { color: theme.textMuted }]}>
          {durationSec ? formatTime(durationSec - positionSec) + " left" : "—"}
        </Text>
        <Text style={[s.timeText, s.timeRight, { color: theme.textMuted }]}>
          {durationSec ? formatTime(durationSec) : "—"}
        </Text>
      </View>

      {/* Controls row: TOC | skip-back | play | skip-fwd | ⋯ */}
      <View style={s.controls}>
        {/* Left: TOC */}
        <TouchableOpacity hitSlop={10} onPress={() => setTocOpen(true)}>
          <Ionicons name="list" size={26} color={ACCENT} />
        </TouchableOpacity>

        {/* Center: skip + play */}
        <View style={s.center}>
          <TouchableOpacity hitSlop={10} onPress={() => onSeek(-15)}>
            <Ionicons name="arrow-undo" size={30} color={theme.icon} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.playBtn, { shadowColor: ACCENT }]}
            onPress={() => (isPlaying ? onPause() : onPlay())}
          >
            <Ionicons
              name={isPlaying ? "pause" : "play"}
              size={34}
              color="#fff"
              style={isPlaying ? {} : { marginLeft: 3 }}
            />
          </TouchableOpacity>

          <TouchableOpacity hitSlop={10} onPress={() => onSeek(15)}>
            <Ionicons name="arrow-redo" size={30} color={theme.icon} />
          </TouchableOpacity>
        </View>

        {/* Right: ⋯ menu */}
        <TouchableOpacity hitSlop={10} onPress={() => setMenuOpen(true)}>
          <Ionicons name="ellipsis-horizontal" size={24} color={theme.icon} />
        </TouchableOpacity>
      </View>

      {/* TOC modal */}
      <Modal
        visible={tocOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setTocOpen(false)}
      >
        <Pressable style={m.overlay} onPress={() => setTocOpen(false)} />
        <View style={[m.sheet, { backgroundColor: theme.surface }]}>
          <View style={[m.handle, { backgroundColor: theme.border }]} />
          <Text style={[m.heading, { color: theme.text }]}>
            Table of Contents
          </Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            {toc.map((entry, i) => (
              <TouchableOpacity
                key={i}
                style={[m.row, { borderBottomColor: theme.border }]}
                onPress={() => {
                  onChapterSelect(entry.chapterIndex);
                  setTocOpen(false);
                }}
              >
                <Text style={[m.rowNum, { color: theme.textMuted }]}>
                  {i + 1}
                </Text>
                <Text
                  style={[
                    m.rowTitle,
                    {
                      color:
                        entry.chapterIndex === chapterIdx ? ACCENT : theme.text,
                    },
                  ]}
                  numberOfLines={2}
                >
                  {entry.title}
                </Text>
                {entry.chapterIndex === chapterIdx && (
                  <Ionicons name="volume-medium" size={16} color={ACCENT} />
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </Modal>

      {/* ⋯ options modal */}
      <Modal
        visible={menuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuOpen(false)}
      >
        <Pressable style={m.overlay} onPress={() => setMenuOpen(false)} />
        <View style={[m.sheet, m.optionsSheet, { backgroundColor: theme.surface }]}>
          <View style={[m.handle, { backgroundColor: theme.border }]} />

          {/* Speed */}
          <Text style={[m.optionLabel, { color: theme.textMuted }]}>
            Playback Speed
          </Text>
          <View style={m.speedRow}>
            {SPEEDS.map((sp) => (
              <TouchableOpacity
                key={sp}
                style={[
                  m.speedChip,
                  {
                    backgroundColor:
                      speed === sp ? ACCENT : theme.bgSecondary,
                    borderColor: speed === sp ? ACCENT : theme.border,
                  },
                ]}
                onPress={() => {
                  onSpeedChange(sp);
                  setMenuOpen(false);
                }}
              >
                <Text
                  style={[
                    m.speedChipText,
                    { color: speed === sp ? "#000" : theme.text },
                  ]}
                >
                  {sp === 1 ? "1×" : `${sp}×`}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Font size */}
          <Text style={[m.optionLabel, { color: theme.textMuted }]}>
            Text Size
          </Text>
          <View style={m.fontRow}>
            <TouchableOpacity
              hitSlop={10}
              disabled={fontSize === FONT_SIZES[0]}
              onPress={() => {
                const i = FONT_SIZES.indexOf(fontSize);
                if (i > 0) setFontSize(FONT_SIZES[i - 1]);
              }}
            >
              <Ionicons
                name="remove-circle-outline"
                size={28}
                color={fontSize === FONT_SIZES[0] ? theme.textMuted : theme.icon}
              />
            </TouchableOpacity>
            <Text style={[m.fontSizeLabel, { color: theme.text }]}>
              {fontSize}
            </Text>
            <TouchableOpacity
              hitSlop={10}
              disabled={fontSize === FONT_SIZES[FONT_SIZES.length - 1]}
              onPress={() => {
                const i = FONT_SIZES.indexOf(fontSize);
                if (i < FONT_SIZES.length - 1) setFontSize(FONT_SIZES[i + 1]);
              }}
            >
              <Ionicons
                name="add-circle-outline"
                size={28}
                color={
                  fontSize === FONT_SIZES[FONT_SIZES.length - 1]
                    ? theme.textMuted
                    : theme.icon
                }
              />
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  progressTrack: {
    height: 6,
    borderRadius: 3,
    marginBottom: 6,
    overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: ACCENT, borderRadius: 3 },
  timeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  timeText: { fontSize: 12, width: 52 },
  timeRight: { textAlign: "right" },
  timeCenter: { fontSize: 12, textAlign: "center" },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 4,
  },
  center: {
    flexDirection: "row",
    alignItems: "center",
    gap: 20,
  },
  playBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: ACCENT,
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
});

const m = StyleSheet.create({
  overlay: { flex: 1 },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: 40,
    maxHeight: "70%",
  },
  optionsSheet: {
    maxHeight: "50%",
    paddingTop: 4,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginTop: 10,
    marginBottom: 16,
  },
  heading: { fontSize: 18, fontWeight: "700", marginBottom: 12 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowNum: { fontSize: 13, width: 24, textAlign: "right" },
  rowTitle: { flex: 1, fontSize: 15 },
  optionLabel: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  speedRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 20,
  },
  speedChip: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
  },
  speedChipText: { fontSize: 13, fontWeight: "600" },
  fontRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginBottom: 8,
  },
  fontSizeLabel: { fontSize: 20, fontWeight: "600", minWidth: 30, textAlign: "center" },
});
