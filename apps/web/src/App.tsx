import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { areaOf, BRAIN_DIRS, dirname, ME, type Area, type Entry, type Preferences } from '@notes/shared';
import { hasBridge, tw, type UpdateStatus, type VaultInfo } from './lib/vault';
import { applyTheme, keep, loadPreferences, remember, savePreferences } from './lib/theme';
import { Rail } from './components/Rail';
import { Sidebar } from './components/Sidebar';
import { NoteView } from './components/NoteView';
import { FileView } from './components/FileView';
import { Home } from './components/Home';
import { SearchDialog } from './components/SearchDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { PromptDialog } from './components/Dialog';

export function App() {
  const [prefs, setPrefs] = useState<Preferences>(loadPreferences);
  const [info, setInfo] = useState<VaultInfo | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [area, setArea] = useState<Area>(() => remember<Area>('area', 'me'));
  const [path, setPath] = useState<string | null>(() => remember<string | null>('openPath', null));
  const [changed, setChanged] = useState<{ paths: string[]; n: number }>({ paths: [], n: 0 });
  const [rightSlot, setRightSlot] = useState<HTMLElement | null>(null);
  const [dialog, setDialog] = useState<'search' | 'settings' | 'new-note' | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  // The "restart to update" notice was closed for this version.
  const [laterFor, setLaterFor] = useState<string | null>(null);

  useEffect(() => applyTheme(prefs), [prefs]);

  const refresh = useCallback(async () => setEntries(await tw.list()), []);

  useEffect(() => {
    if (!hasBridge) return;
    void tw.info().then(setInfo);
    void tw.updateStatus().then(setUpdate);
    const offUpdate = tw.onUpdate(setUpdate);
    void refresh();
    // Anything that changes the folder (you, an agent, a sync tool) refreshes the tree.
    let t: number | undefined;
    const offChange = tw.onChange((paths) => {
      setChanged((c) => ({ paths, n: c.n + 1 }));
      window.clearTimeout(t);
      t = window.setTimeout(() => void refresh(), 100);
    });
    return () => {
      offUpdate();
      offChange();
    };
  }, [refresh]);

  const notify = useCallback((msg: string) => setToast(msg), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const open = useCallback((p: string | null) => {
    setPath(p);
    keep('openPath', p);
    const a = p ? areaOf(p) : null;
    if (a) {
      setArea(a);
      keep('area', a);
    }
  }, []);

  const entry = useMemo(() => entries.find((e) => e.path === path) ?? null, [entries, path]);
  const inbox = useMemo(() => entries.filter((e) => dirname(e.path) === BRAIN_DIRS.inbox).length, [entries]);

  // A path not in the tree yet (just created) or any more (deleted): list again once before giving up on it.
  const recheck = useRef<string | null>(null);
  useEffect(() => {
    if (!path || entry || !entries.length) return;
    if (recheck.current === path) {
      recheck.current = null;
      open(null);
    } else {
      recheck.current = path;
      void refresh();
    }
  }, [path, entries, entry, open, refresh]);

  useEffect(() => {
    if (!hasBridge) return;
    return tw.onCommand((cmd) => {
      if (cmd === 'search') setDialog('search');
      else if (cmd === 'new-note') setDialog('new-note');
      else if (cmd === 'check-updates') {
        setDialog('settings');
        void tw.checkForUpdates();
      }
      else if (cmd === 'import') void tw.pickAndImport(BRAIN_DIRS.inbox).then((a) => a.length && notify(`Added ${a.length} to the inbox`));
    });
  }, [notify]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setDialog('search');
      }
    };
    window.addEventListener('keydown', onKey);
    // Files dropped outside a drop zone must not replace the app.
    const stop = (e: DragEvent) => e.preventDefault();
    window.addEventListener('dragover', stop);
    window.addEventListener('drop', stop);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('dragover', stop);
      window.removeEventListener('drop', stop);
    };
  }, []);

  if (!hasBridge) {
    return (
      <div className="stage">
        <div className="welcome">
          <h2>Thoughtwell runs as a desktop app</h2>
          <p>Start it with pnpm dev (which opens the desktop window), or install the AppImage.</p>
        </div>
      </div>
    );
  }
  if (!info) return null;

  const isNote = entry?.kind === 'note';
  return (
    <div className="app" data-app-ready>
      <Rail
        area={area}
        inbox={inbox}
        onArea={(a) => {
          setArea(a);
          keep('area', a);
          if (path && areaOf(path) !== a) open(null);
        }}
        onSearch={() => setDialog('search')}
        onSettings={() => setDialog('settings')}
      />
      <Sidebar
        area={area}
        entries={entries}
        selected={path}
        onOpen={open}
        onMoved={(from, to) => {
          if (path === from) open(to);
          else if (path?.startsWith(from + '/')) open(to + path.slice(from.length));
          void refresh();
        }}
        onSearch={() => setDialog('search')}
        notify={notify}
      />
      <main className="center">
        {entry && isNote ? (
          <NoteView
            key={entry.path}
            path={entry.path}
            changed={changed}
            rightSlot={rightSlot}
            onOpen={open}
            onRenamed={(p) => {
              open(p);
              void refresh();
            }}
            onClosed={() => {
              open(null);
              void refresh();
            }}
            notify={notify}
          />
        ) : entry && entry.kind !== 'dir' ? (
          <FileView
            key={entry.path}
            entry={entry}
            rightSlot={rightSlot}
            onOpen={open}
            onClosed={() => {
              open(null);
              void refresh();
            }}
            notify={notify}
          />
        ) : (
          <Home area={area} entries={entries} info={info} onOpen={open} notify={notify} />
        )}
      </main>
      {/* The open note or file puts its own panel here. */}
      <div className="right-slot" ref={setRightSlot} />

      {dialog === 'search' && <SearchDialog onOpen={open} onClose={() => setDialog(null)} />}
      {dialog === 'settings' && (
        <SettingsDialog
          prefs={prefs}
          info={info}
          update={update}
          onChange={(p) => {
            setPrefs(p);
            savePreferences(p);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'new-note' && (
        <PromptDialog
          title="New note"
          label="Name"
          sub={`In ${area === 'brain' ? BRAIN_DIRS.topics : ME}`}
          confirm="Create"
          onClose={() => setDialog(null)}
          onSubmit={async (title) => open(await tw.createNote(area === 'brain' ? BRAIN_DIRS.topics : ME, title, `# ${title}\n\n`))}
        />
      )}
      {update?.state === 'ready' && laterFor !== update.latest && dialog !== 'settings' && (
        <div className="update-notice" role="status">
          <span>Thoughtwell {update.latest} is installed and starts next time you open it.</span>
          <button type="button" className="btn pri" onClick={() => void tw.restartToUpdate()}>
            Restart now
          </button>
          <button type="button" className="btn" onClick={() => setLaterFor(update.latest ?? null)}>
            Later
          </button>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
