import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { Excalidraw, exportToSvg } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { Icon } from '../components/Icon';

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

/** Changes whenever a drawn element changes, and not for scrolling or selecting. */
function sceneVersion(elements: readonly { version: number; isDeleted?: boolean }[]) {
  let v = elements.length;
  for (const el of elements) v += el.version * 31 + (el.isDeleted ? 1 : 0);
  return v;
}

/**
 * Excalidraw drawn right on the page. Work saves itself a moment after each
 * change (the scene, to edit again, plus an SVG picture for showing,
 * exporting and review). Full screen is a button away for bigger drawings.
 */
export default function SketchEditor({
  scene,
  height,
  onSave,
  onDone,
}: {
  scene: string;
  height: number;
  onSave: (scene: string, svg: string) => void;
  onDone: () => void;
}) {
  const api = useRef<Api | null>(null);
  const [initial] = useState(() => parseScene(scene));
  const [full, setFull] = useState(false);
  const [state, setState] = useState<'saved' | 'saving'>('saved');
  const dark = document.documentElement.dataset.mode !== 'light';
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const version = useRef<number | null>(null);
  const pending = useRef(false);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;

  const save = async () => {
    clearTimeout(timer.current);
    pending.current = false;
    const a = api.current;
    if (!a) return;
    const elements = a.getSceneElements();
    const appState = a.getAppState();
    const files = a.getFiles();
    const svg = elements.length
      ? (await exportToSvg({ elements, appState: { ...appState, exportBackground: true, exportWithDarkMode: false }, files })).outerHTML
      : '';
    const kept = JSON.stringify({ elements, appState: { viewBackgroundColor: appState.viewBackgroundColor }, files });
    saveRef.current(kept, svg);
    setState('saved');
  };

  // Anything still waiting is saved when the editor closes.
  useEffect(
    () => () => {
      if (pending.current) void save();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.excalidraw .Modal')) setFull(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full]);

  return (
    <div className={`sketch-inline ${full ? 'full' : ''}`} style={full ? undefined : { height }}>
      <div className="sketch-head">
        <strong>{full ? 'Sketch diagram' : ''}</strong>
        <span className="sketch-state">{state === 'saving' ? 'Saving…' : 'Saved'}</span>
        <span className="push" />
        <button type="button" className="ib" title={full ? 'Back into the page' : 'Full screen'} aria-label={full ? 'Exit full screen' : 'Full screen'} onClick={() => setFull((f) => !f)}>
          <Icon name={full ? 'fit' : 'expand'} small />
        </button>
        <button
          type="button"
          className="btn pri"
          onClick={async () => {
            await save();
            onDone();
          }}
        >
          Done
        </button>
      </div>
      <div className="sketch-canvas">
        <Excalidraw
          excalidrawAPI={(a) => {
            api.current = a;
          }}
          initialData={initial}
          theme={dark ? 'dark' : 'light'}
          autoFocus
          UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false } }}
          onChange={(elements) => {
            const v = sceneVersion(elements);
            if (version.current === null) {
              // The first call is the scene loading, not an edit.
              version.current = v;
              return;
            }
            if (v === version.current) return;
            version.current = v;
            setState('saving');
            pending.current = true;
            clearTimeout(timer.current);
            timer.current = setTimeout(() => void save(), 1200);
          }}
        />
      </div>
    </div>
  );
}
