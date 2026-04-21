import React, {
  useRef,
  useCallback,
  useEffect,
  useState,
  useImperativeHandle,
  forwardRef,
} from "react";
import { View, StyleSheet, Text } from "react-native";
import { WebView } from "react-native-webview";
import { cacheDirectory, getInfoAsync, readAsStringAsync } from "expo-file-system/legacy";

export type EpubReaderHandle = {
  navigateTo: (href: string) => void;
};

type Props = {
  epubUrl: string;
  fontSize: number;
  textColor: string;
  bg: string;
  onLocationChange?: (cfi: string, progress: number) => void;
  onSpineReady?: (hrefs: string[]) => void;
  initialCfi?: string;
};

function buildHtml(
  epubUrl: string,
  fontSize: number,
  textColor: string,
  bg: string,
  initialCfi?: string,
): string {
  const cfiParam = initialCfi ? JSON.stringify(initialCfi) : "null";
  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; background: ${bg}; overflow: hidden; }
    #viewer { width: 100%; height: 100%; }
  </style>
</head>
<body>
  <div id="viewer"></div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/epubjs@0.3.88/dist/epub.min.js"></script>
  <script>
    (function() {
      function sendMessage(payload) {
        try { window.ReactNativeWebView.postMessage(JSON.stringify(payload)); } catch (e) {}
      }

      try {
        const epubSource = ${JSON.stringify(epubUrl)};
        let epubInput = epubSource;

        if (epubSource.startsWith('data:')) {
          const base64Data = epubSource.split(',')[1];
          const binaryString = atob(base64Data);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          epubInput = bytes.buffer;
        }

        const book = ePub(epubInput);
        const rendition = book.renderTo('viewer', {
          manager: 'continuous',
          flow: 'scrolled',
          width: '100%',
          height: '100%',
        });

        rendition.themes.default({
          body: {
            'font-size': '${fontSize}px !important',
            'color': '${textColor} !important',
            'background': '${bg} !important',
            'line-height': '1.65 !important',
            'padding': '0 16px !important',
          }
        });

        book.ready.then(function() {
          var spineHrefs = [];
          book.spine.each(function(item) { spineHrefs.push(item.href); });
          sendMessage({ type: 'spine', hrefs: spineHrefs });
        });

        rendition.display(${cfiParam} || undefined)
          .catch(function(err) {
            sendMessage({ type: 'error', message: 'display: ' + err });
          });

        rendition.on('relocated', function(location) {
          sendMessage({ type: 'location', cfi: location.start.cfi, progress: 0 });
        });

        rendition.on('rendered', function(section, view) {
          var doc = view.document || (view.iframe && view.iframe.contentDocument);
          if (!doc) return;
          doc.addEventListener('click', function(e) {
            var a = e.target.closest('a[href]');
            if (!a) return;
            e.preventDefault();
            e.stopPropagation();
            var href = a.getAttribute('href');
            if (href) rendition.display(href).catch(function() {});
          }, true);
        });

        window.__epubRendition = rendition;

        window.__setFontSize = function(size) {
          rendition.themes.default({
            body: {
              'font-size': size + 'px !important',
              'color': '${textColor} !important',
              'background': '${bg} !important',
              'line-height': '1.65 !important',
              'padding': '0 16px !important',
            }
          });
        };


      } catch (err) {
        sendMessage({ type: 'error', message: String(err) });
      }

      window.onerror = function(message, source, lineno) {
        sendMessage({ type: 'error', message: String(message) + ' @ ' + lineno });
      };
    })();
  </script>
</body>
</html>`;
}

const EpubReader = forwardRef<EpubReaderHandle, Props>(function EpubReader(
  { epubUrl, fontSize, textColor, bg, onLocationChange, onSpineReady, initialCfi },
  ref,
) {
  const webViewRef = useRef<WebView>(null);
  const [error, setError] = useState<string | null>(null);
  const [localEpubUri, setLocalEpubUri] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({
    navigateTo(href: string) {
      webViewRef.current?.injectJavaScript(
        `if (window.__epubRendition) { window.__epubRendition.display(${JSON.stringify(href)}).catch(function(){}); } true;`,
      );
    },
  }));

  useEffect(() => {
    if (!epubUrl) return;

    async function cacheEpub() {
      const fileName = `epub-${encodeURIComponent(epubUrl).slice(0, 120)}.epub`;
      const localPath = `${cacheDirectory}${fileName}`;
      try {
        const info = await getInfoAsync(localPath);
        if (!info.exists) return;
        const base64Data = await readAsStringAsync(localPath, { encoding: "base64" });
        setLocalEpubUri(`data:application/epub+zip;base64,${base64Data}`);
      } catch {
        // fall through to use remote URL
      }
    }

    cacheEpub();
  }, [epubUrl]);

  const onMessage = useCallback(
    (e: any) => {
      try {
        const msg = JSON.parse(e.nativeEvent.data);
        if (msg.type === "location" && onLocationChange) {
          onLocationChange(msg.cfi, msg.progress);
        } else if (msg.type === "spine" && onSpineReady) {
          onSpineReady(msg.hrefs);
        } else if (msg.type === "error") {
          setError(msg.message);
        }
      } catch (err) {
        console.warn("EpubReader message parse failed", err);
      }
    },
    [onLocationChange, onSpineReady],
  );

  const prevFontSize = useRef(fontSize);
  useEffect(() => {
    if (prevFontSize.current !== fontSize) {
      prevFontSize.current = fontSize;
      webViewRef.current?.injectJavaScript(
        `if (window.__setFontSize) { window.__setFontSize(${fontSize}); } true;`,
      );
    }
  }, [fontSize]);

  if (error) {
    return (
      <View
        style={[
          styles.container,
          {
            backgroundColor: bg,
            justifyContent: "center",
            alignItems: "center",
            padding: 20,
          },
        ]}
      >
        <Text style={{ color: textColor, textAlign: "center" }}>
          EPUB Reader Error: {error}
        </Text>
      </View>
    );
  }

  const sourceUrl = localEpubUri ?? epubUrl;
  // fontSize intentionally excluded — changes are applied via injectJavaScript
  const html = React.useMemo(
    () => (sourceUrl ? buildHtml(sourceUrl, fontSize, textColor, bg, initialCfi) : ""),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sourceUrl, textColor, bg, initialCfi],
  );

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        originWhitelist={["*"]}
        source={{ html }}
        style={[styles.webview, { backgroundColor: bg }]}
        scrollEnabled={true}
        showsVerticalScrollIndicator={false}
        onMessage={onMessage}
        onError={(event) =>
          setError(event.nativeEvent.description ?? "WebView error")
        }
        onHttpError={(event) =>
          setError(`HTTP error ${event.nativeEvent.statusCode}`)
        }
        allowUniversalAccessFromFileURLs={true}
        allowFileAccessFromFileURLs={true}
        allowFileAccess={true}
        mixedContentMode="always"
        javaScriptEnabled={true}
      />
    </View>
  );
});

export default EpubReader;

const styles = StyleSheet.create({
  container: { flex: 1 },
  webview: { flex: 1 },
});
