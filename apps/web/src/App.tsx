import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, type Directory, type Me, type Workspace } from './lib/api';
import { applyTheme } from './lib/theme';
import { Login } from './components/Login';
import { Rail, type RailView } from './components/Rail';
import { Library } from './components/Library';
import { PageView } from './components/PageView';
import { ToolsPanel } from './components/ToolsPanel';
import { SettingsDialog } from './components/SettingsDialog';
import { PeopleDialog } from './components/PeopleDialog';
import { ReviewInbox } from './components/ReviewInbox';
import { NotificationsPanel } from './components/NotificationsPanel';
import { OrgChart } from './components/OrgChart';

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [view, setView] = useState<RailView>('notes');
  // The library's own tab: My workspace or the org directory list.
  const [libView, setLibView] = useState<'workspace' | 'directory'>('workspace');
  const [pageId, setPageId] = useState<string | null>(() => new URLSearchParams(location.search).get('page'));
  const [openReview, setOpenReview] = useState(false);
  // Bumped whenever a page is opened from a list, so an already-open page reloads its review state.
  const [openNonce, setOpenNonce] = useState(0);
  const [rightSlot, setRightSlot] = useState<HTMLElement | null>(null);
  const [unread, setUnread] = useState(0);
  const [dialog, setDialog] = useState<'settings' | 'people' | 'reviews' | 'notifications' | null>(null);
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

  // The bell's count, refreshed every minute and when the window comes back into focus.
  const loadUnread = useCallback(() => {
    void api
      .get<{ unread: number }>('/api/notifications/unread')
      .then((r) => setUnread(r.unread))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!me) return;
    loadUnread();
    const t = setInterval(loadUnread, 60_000);
    window.addEventListener('focus', loadUnread);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', loadUnread);
    };
  }, [me, loadUnread]);

  const openPage = useCallback((id: string, review = false) => {
    setView('notes');
    setOpenReview(review);
    setOpenNonce((n) => n + 1);
    setPageId(id);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const notify = useCallback((msg: string) => setToast(msg), []);

  if (signedOut) return <Login onSignedIn={loadMe} />;
  if (!me) return null;


  return (
    <div className={`app ${view === 'orgchart' ? 'org-mode' : ''}`}>
      <Rail
        me={me}
        view={view}
        unread={unread}
        onView={(v) => {
          if (v === 'settings') setDialog('settings');
          else if (v === 'people') setDialog('people');
          else if (v === 'review') setDialog('reviews');
          else if (v === 'notifications') setDialog('notifications');
          else if (v === 'ai') notify('The AI assistant is coming in a later phase.');
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
        view={libView}
        onViewChange={setLibView}
        workspace={workspace}
        directory={directory}
        selectedPageId={pageId}
        onOpenPage={(id) => openPage(id)}
        onChanged={refresh}
        notify={notify}
      />
      <main className="center">
        {view === 'orgchart' && directory && <OrgChart directory={directory} />}
        {/* Kept mounted behind the chart, so an open page stays connected. */}
        <div className="center-notes" hidden={view === 'orgchart'}>
          {pageId ? (
            <PageView
              key={pageId}
              pageId={pageId}
              me={me}
              rightSlot={rightSlot}
              openReview={openReview}
              openNonce={openNonce}
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
        </div>
      </main>
      {/* The open page puts its own tools panel here. */}
      <div className="right-slot" ref={setRightSlot}>
        {!pageId && <ToolsPanel editor={null} pageId={null} notify={notify} />}
      </div>

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
      {dialog === 'reviews' && <ReviewInbox onOpen={(id) => openPage(id, true)} onClose={() => setDialog(null)} />}
      {dialog === 'notifications' && (
        <NotificationsPanel onOpen={(id, review) => openPage(id, review)} onRead={loadUnread} onClose={() => setDialog(null)} />
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
