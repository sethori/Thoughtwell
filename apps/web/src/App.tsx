import { useCallback, useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { ApiError, api, type Directory, type Me, type Workspace } from './lib/api';
import { applyTheme } from './lib/theme';
import { Login } from './components/Login';
import { Rail, type RailView } from './components/Rail';
import { Library } from './components/Library';
import { PageView } from './components/PageView';
import { ToolsPanel } from './components/ToolsPanel';
import { SettingsDialog } from './components/SettingsDialog';
import { PeopleDialog } from './components/PeopleDialog';

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [view, setView] = useState<RailView>('notes');
  const [pageId, setPageId] = useState<string | null>(() => new URLSearchParams(location.search).get('page'));
  const [editor, setEditor] = useState<Editor | null>(null);
  const [dialog, setDialog] = useState<'settings' | 'people' | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const loadMe = useCallback(async () => {
    try {
      const m = await api.get<Me>('/api/me');
      setMe(m);
      setSignedOut(false);
      applyTheme(m.user.preferences, m.org.branding.scheme);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setSignedOut(true);
      else throw err;
    }
  }, []);

  const refresh = useCallback(async () => {
    const [w, d] = await Promise.all([api.get<Workspace>('/api/workspace'), api.get<Directory>('/api/directory')]);
    setWorkspace(w);
    setDirectory(d);
  }, []);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);
  useEffect(() => {
    if (me) void refresh();
  }, [me, refresh]);

  // Keep the open page in the address bar, so a link or refresh returns to it.
  useEffect(() => {
    const url = new URL(location.href);
    if (pageId) url.searchParams.set('page', pageId);
    else url.searchParams.delete('page');
    history.replaceState(null, '', url);
  }, [pageId]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  if (signedOut) return <Login onSignedIn={loadMe} />;
  if (!me) return null;

  const notify = (msg: string) => setToast(msg);

  return (
    <div className="app">
      <Rail
        me={me}
        view={view}
        onView={(v) => {
          if (v === 'settings') setDialog('settings');
          else if (v === 'people') setDialog('people');
          else if (v === 'ai') notify('The AI assistant is coming in a later phase.');
          else if (v === 'review' || v === 'notifications') notify('Review and notifications arrive in phase 3.');
          else setView(v);
        }}
        onSignOut={async () => {
          await api.post('/api/auth/logout');
          setMe(null);
          setSignedOut(true);
        }}
      />
      <Library
        me={me}
        view={view === 'directory' ? 'directory' : 'workspace'}
        onViewChange={(v) => setView(v === 'directory' ? 'directory' : 'notes')}
        workspace={workspace}
        directory={directory}
        selectedPageId={pageId}
        onOpenPage={setPageId}
        onChanged={refresh}
        notify={notify}
      />
      <main className="center">
        {pageId ? (
          <PageView
            key={pageId}
            pageId={pageId}
            onEditor={setEditor}
            onSaved={refresh}
            onClosed={() => {
              setPageId(null);
              void refresh();
            }}
            notify={notify}
          />
        ) : (
          <div className="stage">
            <div className="welcome">
              <h2>Welcome, {me.user.display_name}</h2>
              <p>Open a page from the library, or right-click a folder to create one.</p>
            </div>
          </div>
        )}
      </main>
      <ToolsPanel editor={pageId ? editor : null} pageId={pageId} notify={notify} />

      {dialog === 'settings' && (
        <SettingsDialog
          me={me}
          onClose={() => setDialog(null)}
          onChanged={async () => {
            await loadMe();
          }}
        />
      )}
      {dialog === 'people' && directory && (
        <PeopleDialog me={me} directory={directory} onClose={() => setDialog(null)} onChanged={refresh} />
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
