import { useRef, useState, type ComponentProps } from 'react';
import { createPortal } from 'react-dom';
import { Excalidraw, exportToSvg } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';

type Api = Parameters<NonNullable<ComponentProps<typeof Excalidraw>['excalidrawAPI']>>[0];
type InitialData = NonNullable<ComponentProps<typeof Excalidraw>['initialData']>;

function parseScene(scene: string): InitialData | null {
  if (!scene) return null;
  try {
    const s = JSON.parse(scene) as { elements?: unknown[]; appState?: { viewBackgroundColor?: string }; files?: Record<string, unknown> };
    return {
      elements: (s.elements ?? []) as never,
      appState: { viewBackgroundColor: s.appState?.viewBackgroundColor ?? '#ffffff' },
      files: (s.files ?? {}) as never,
      scrollToContent: true,
    };
  } catch {
    return null;
  }
}

/** Full-screen Excalidraw. Saving keeps the scene (to edit again) and an SVG picture of it. */
export default function SketchEditor({ scene, onSave, onClose }: { scene: string; onSave: (scene: string, svg: string) => void; onClose: () => void }) {
  const api = useRef<Api | null>(null);
  const [saving, setSaving] = useState(false);
  const [initial] = useState(() => parseScene(scene));
  const dark = document.documentElement.dataset.mode !== 'light';

  const save = async () => {
    const a = api.current;
    if (!a) return;
    setSaving(true);
    try {
      const elements = a.getSceneElements();
      const appState = a.getAppState();
      const files = a.getFiles();
      const svg = elements.length
        ? (await exportToSvg({ elements, appState: { ...appState, exportBackground: true, exportWithDarkMode: false }, files })).outerHTML
        : '';
      const kept = JSON.stringify({ elements, appState: { viewBackgroundColor: appState.viewBackgroundColor }, files });
      onSave(kept, svg);
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="sketch-modal" role="dialog" aria-modal="true" aria-label="Sketch diagram">
      <div className="sketch-head">
        <strong>Sketch diagram</strong>
        <span className="push" />
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn pri" onClick={() => void save()} disabled={saving}>
          {saving ? 'Saving…' : 'Save sketch'}
        </button>
      </div>
      <div className="sketch-canvas">
        <Excalidraw
          excalidrawAPI={(a) => {
            api.current = a;
          }}
          initialData={initial}
          theme={dark ? 'dark' : 'light'}
          UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false } }}
        />
      </div>
    </div>,
    document.body,
  );
}
