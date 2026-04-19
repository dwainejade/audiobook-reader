# Frontend

The mobile app is built with Expo (SDK 54) and React Native. It handles authentication, EPUB upload, job status monitoring, and audio playback.

---

## Screen Map

```
Stack Navigator
├── AuthScreen          ← email/password + OAuth (Supabase Auth)
└── (Authenticated)
    ├── Tab Navigator
    │   ├── LibraryScreen       ← book grid with progress rings
    │   └── SettingsScreen      ← voice, speed, account
    └── Stack (from Library)
        ├── UploadScreen        ← file picker + live job progress
        └── PlayerScreen        ← audio player + chapter list
```

---

## Key Libraries

| Library | Purpose |
|---|---|
| `expo-router` | File-based navigation |
| `expo-audio` | Audio playback (replaces expo-av) |
| `expo-document-picker` | EPUB file selection |
| `expo-file-system` | Upload multipart form data |
| `@supabase/supabase-js` | Auth, DB queries, Realtime, Storage |
| `zustand` | Lightweight global state |
| `@shopify/flash-list` | Performant chapter list |
| `react-native-progress` | Progress rings on book cards |

---

## State Management (Zustand)

Three stores:

### `useAuthStore`
```ts
{
  session: Session | null
  user: User | null
  signIn: (email, password) => Promise<void>
  signOut: () => Promise<void>
}
```

### `useLibraryStore`
```ts
{
  books: Book[]
  fetchBooks: () => Promise<void>
  addBook: (book: Book) => void
  updateChapterStatus: (chapterId: string, status: string, audioUrl?: string) => void
}
```

### `usePlayerStore`
```ts
{
  currentBook: Book | null
  currentChapter: Chapter | null
  isPlaying: boolean
  position: number
  speed: number           // 0.75 | 1.0 | 1.25 | 1.5 | 2.0
  sleepTimerMinutes: number | null
  play: () => void
  pause: () => void
  seekTo: (seconds: number) => void
  nextChapter: () => void
  prevChapter: () => void
  setSpeed: (speed: number) => void
}
```

---

## Screen Details

### AuthScreen
- Supabase email/password login and registration
- Google OAuth via `supabase.auth.signInWithOAuth`
- Session persisted via `AsyncStorage` (Supabase handles this automatically)

### LibraryScreen
- Grid of book cards (2 columns) using `FlashList`
- Each card shows: cover, title, author, circular progress ring (% chapters done)
- Floating `+` button → navigates to UploadScreen
- Pull-to-refresh calls `fetchBooks()`

### UploadScreen
- `expo-document-picker` filtered to `.epub` files
- On pick: upload via `fetch` with `multipart/form-data` to `POST /api/books/upload`
- Show upload progress bar (track with `XMLHttpRequest` upload events)
- After upload: subscribe to Supabase Realtime for chapter status updates
- Display per-chapter generation progress (e.g. "12 / 135 chapters ready")
- "Start Listening" button enabled when ≥1 chapter is done

### PlayerScreen
- Full-screen player with book cover background (blurred)
- Chapter title and book title displayed
- Custom scrubber slider (position / duration)
- Playback controls: ⏮ prev chapter | ⏪ -15s | ▶/⏸ | ⏩ +15s | ⏭ next chapter
- Speed selector: `0.75× 1× 1.25× 1.5× 2×`
- Sleep timer: 15m / 30m / 45m / 60m / end of chapter
- Bottom sheet: full chapter list, tap to jump
- Chapters not yet generated shown as locked/greyed out

### SettingsScreen
- Default voice selector (Kokoro voices with preview)
- Default playback speed
- Sign out button
- App version

---

## Audio Playback (`expo-audio`)

```ts
import { useAudioPlayer } from 'expo-audio'

const player = useAudioPlayer({ uri: chapter.audio_url })

player.play()
player.pause()
player.seekTo(seconds)
player.rate = 1.5
```

Position is saved to the API every 5 seconds while playing and on pause.

---

## Supabase Realtime Setup

Subscribe once per book when entering the player or upload screen:

```ts
const channel = supabase
  .channel(`book-${bookId}`)
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'chapters',
    filter: `book_id=eq.${bookId}`,
  }, ({ new: chapter }) => {
    if (chapter.status === 'done') {
      useLibraryStore.getState().updateChapterStatus(
        chapter.id,
        'done',
        chapter.audio_url
      )
    }
  })
  .subscribe()

// Cleanup on unmount
return () => { supabase.removeChannel(channel) }
```

---

## File Structure

```
apps/mobile/
├── app/
│   ├── (auth)/
│   │   └── index.tsx       # AuthScreen
│   ├── (tabs)/
│   │   ├── index.tsx       # LibraryScreen
│   │   └── settings.tsx    # SettingsScreen
│   ├── upload.tsx          # UploadScreen
│   ├── player/
│   │   └── [bookId].tsx    # PlayerScreen
│   └── _layout.tsx
├── components/
│   ├── BookCard.tsx
│   ├── AudioScrubber.tsx
│   ├── ChapterList.tsx
│   └── SpeedSelector.tsx
├── stores/
│   ├── useAuthStore.ts
│   ├── useLibraryStore.ts
│   └── usePlayerStore.ts
├── lib/
│   └── supabase.ts         # Supabase client singleton
└── types/
    └── index.ts            # Book, Chapter, Job types
```
