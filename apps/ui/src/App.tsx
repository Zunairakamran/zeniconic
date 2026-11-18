import { useEffect, useRef, useState, type ComponentType } from 'react';
import type {
  CaptionMode,
  ExportQuality,
  JobProgressEvent,
  VoiceMode,
} from '../../../packages/ipc/src/index';
import { api, toUiListing, toUiVariant, type Facts } from './api';
import { candidates, listings as demoListings, variants as demoVariants } from './demo';
import { applyTheme, getStoredTheme, type Theme } from './theme';
import { Icon } from './ui';
import type { Candidate, Listing, ScreenProps, Variant, View } from './types';
import { HomeScreen } from './screens/Home';
import { IntakeScreen } from './screens/Intake';
import { AnalysisScreen } from './screens/Analysis';
import { ShotReviewScreen } from './screens/ShotReview';
import { VariantsScreen } from './screens/Variants';
import { RefineChatScreen } from './screens/RefineChat';
import { FormatsScreen } from './screens/Formats';
import { ExportScreen } from './screens/Export';
import { RemixScreen } from './screens/Remix';
import { SettingsScreen } from './screens/Settings';

const screens: Record<View, ComponentType<ScreenProps>> = {
  home: HomeScreen,
  intake: IntakeScreen,
  analysis: AnalysisScreen,
  shots: ShotReviewScreen,
  variants: VariantsScreen,
  chat: RefineChatScreen,
  formats: FormatsScreen,
  export: ExportScreen,
  remix: RemixScreen,
  settings: SettingsScreen,
};

const nav: Array<{ id: View; label: string; icon: 'list' | 'settings' }> = [
  { id: 'home', label: 'Listings', icon: 'list' },
  { id: 'remix', label: 'Remix', icon: 'list' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

const views: View[] = ['home', 'intake', 'analysis', 'shots', 'variants', 'chat', 'formats', 'export', 'remix', 'settings'];

function initialView(): View {
  const hash = window.location.hash.replace('#', '');
  return views.includes(hash as View) ? (hash as View) : 'home';
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function candidateFromShot(row: {
  shotId: string;
  room: string;
  startSec: number;
  endSec: number;
  score?: number;
  sellingPoints?: string[];
  defects?: string[];
}): Candidate {
  const durationSec = Math.max(0.4, Math.round((row.endSec - row.startSec) * 10) / 10);
  const points = row.sellingPoints ?? [];
  const defects = row.defects ?? [];
  return {
    id: row.shotId,
    room: row.room,
    score: typeof row.score === 'number' ? Math.round(row.score * 100) : 0,
    durationSec,
    reason: points.length > 0 ? points.join(' · ') : `${row.room} shot, ${durationSec}s`,
    ...(defects.length > 0 ? { rejected: defects.join(', ') } : {}),
  };
}

export function App() {
  const [view, setView] = useState<View>(initialView());
  const [theme, setTheme] = useState<Theme>(getStoredTheme());
  // Demo data keeps the browser-only dev server useful; a real store replaces
  // it as soon as the bridge answers. An empty store keeps the demo shell.
  const [listings, setListings] = useState<Listing[]>(demoListings);
  const [selectedId, setSelectedId] = useState(demoListings[0]!.id);
  const [variantList, setVariantList] = useState<Variant[]>(demoVariants);
  const [shotCandidates, setShotCandidates] = useState<Candidate[]>(candidates);
  const [progress, setProgress] = useState<JobProgressEvent | undefined>();
  const [analysisJobId, setAnalysisJobId] = useState<string | undefined>();
  const [analysisListingId, setAnalysisListingId] = useState<string | undefined>();
  const [analysisError, setAnalysisError] = useState<string | undefined>();
  const [folders, setFolders] = useState<Record<string, string>>({});
  const [newListing, setNewListing] = useState(false);
  const [selectedProfiles, setSelectedProfiles] = useState<string[]>([
    'vertical-social',
    'landscape',
  ]);
  const [dataDir, setDataDir] = useState('');
  const [spendUsd, setSpendUsd] = useState(0);
  const demoTimer = useRef<number | undefined>(undefined);

  // Listings and the storage root live in the main process.
  useEffect(() => {
    let cancelled = false;

    api.listings
      .list()
      .then((records) => {
        if (cancelled || records.length === 0) return;
        setListings(records.map(toUiListing));
        setSelectedId((current) =>
          records.some((record) => record.id === current) ? current : records[0]!.id,
        );
      })
      .catch(() => {
        // No bridge or a failing main process: the demo shell stays usable.
      });

    api.settings
      .get()
      .then((settings) => {
        if (cancelled) return;
        setDataDir(settings.dataDir);
        setSpendUsd(settings.spendUsd);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  // One subscription for the life of the window. Screens read the latest event.
  useEffect(() => {
    const unsubscribe = api.onJobProgress((event) => setProgress(event));
    return () => {
      unsubscribe();
      if (demoTimer.current !== undefined) window.clearInterval(demoTimer.current);
    };
  }, []);

  const loadVariants = async (listingId: string): Promise<Variant[]> => {    const records = await api.variants.list(listingId);
    const mapped = records.map(toUiVariant);
    setVariantList(mapped);
    setListings((current) =>
      current.map((listing) =>
        listing.id === listingId
          ? {
              ...listing,
              variantCount: mapped.length,
              ...(mapped.length > 0 ? { status: 'ready' as const } : {}),
            }
          : listing,
      ),
    );
    return mapped;
  };

  // Re-read variants when returning to the review screen (e.g. after a remix).
  useEffect(() => {
    if (view !== 'variants') return;
    void loadVariants(selectedId).catch(() => undefined);
  }, [view, selectedId]);

  // Keep the review screen in step with the selected listing.
  useEffect(() => {
    let cancelled = false;

    api.variants
      .list(selectedId)
      .then((records) => {
        if (cancelled) return;
        const mapped = records.map(toUiVariant);
        setVariantList(mapped);
        setListings((current) =>
          current.map((listing) =>
            listing.id === selectedId
              ? {
                  ...listing,
                  variantCount: mapped.length,
                  ...(mapped.length > 0 ? { status: 'ready' as const } : {}),
                }
              : listing,
          ),
        );
      })
      .catch(() => undefined);

    api.shots
      .list(selectedId)
      .then((rows) => {
        if (cancelled || rows.length === 0) return;
        setShotCandidates(rows.map(candidateFromShot));
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // Completion: load the variants, then move to review.
  useEffect(() => {
    if (analysisJobId === undefined || analysisListingId === undefined) return;
    if (progress === undefined || progress.jobId !== analysisJobId) return;

    if (progress.status === 'failed') {
      setAnalysisError(progress.error ?? 'Analysis failed. Try the folder again.');
      return;
    }

    const finished =
      progress.status === 'complete' || (progress.stage === 'done' && progress.percent >= 100);
    if (!finished) return;

    setAnalysisError(undefined);
    void loadVariants(analysisListingId)
      .then(() => {
        if (view === 'analysis') navigate('variants');
      })
      .catch(() => undefined);
  }, [progress, analysisJobId, analysisListingId, view]);

  // Deep links: the hash is the route, so screenshots and bug reports can point
  // at a specific screen without a router dependency.
  const navigate = (next: View) => {
    setView(next);
    if (window.location.hash !== `#${next}`) window.history.replaceState(null, '', `#${next}`);
  };

  // Settings can change the theme too; keep the topbar label in step.
  useEffect(() => {
    const onTheme = (event: Event) => {
      const detail = (event as CustomEvent<Theme>).detail;
      if (detail === 'light' || detail === 'dark') setTheme(detail);
    };
    window.addEventListener('zeniconic-theme', onTheme);
    return () => window.removeEventListener('zeniconic-theme', onTheme);
  }, []);

  const listing = listings.find((l) => l.id === selectedId) ?? listings[0]!;
  const Screen = screens[view];

  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    applyTheme(next);
  };

  const chooseFolder = async (): Promise<string | null> => {
    const picked = await api.analysis.chooseFolder();
    if (picked !== null && picked.trim().length > 0) {
      setFolders((current) => ({ ...current, [selectedId]: picked }));
      return picked;
    }
    return null;
  };

  const analyse = async (input: {
    folder: string;
    address?: string;
    facts?: Partial<Facts>;
  }): Promise<void> => {
    const folder = input.folder.trim();
    if (folder.length === 0) throw new Error('Choose a folder with your footage.');

    let listingId = selectedId;
    let started = false;
    try {
      if (newListing) {
        const address = input.address?.trim() ?? '';
        if (address.length === 0) throw new Error('Add the property address first.');
        const record = await api.listings.create({
          address,
          ...(input.facts === undefined ? {} : { facts: input.facts }),
        });
        listingId = record.id;
        setListings((current) => [toUiListing(record), ...current]);
        setSelectedId(record.id);
        setNewListing(false);
      } else if (input.facts !== undefined) {
        // Facts gate the export overlays: persist and confirm them before a
        // single frame is indexed. A failed save leaves the user on Intake.
        const record = await api.listings.updateFacts({
          listingId,
          facts: input.facts,
        });
        setListings((current) =>
          current.map((item) => (item.id === listingId ? toUiListing(record) : item)),
        );
      }

      setFolders((current) => ({ ...current, [listingId]: folder }));
      setProgress(undefined);
      setAnalysisError(undefined);
      setAnalysisJobId(undefined);
      setAnalysisListingId(listingId);

      // Start first, then route: the analysis screen always has a job id and
      // therefore renders the live state rather than the idle one.
      const { jobId } = await api.analysis.start({ listingId, folder });
      started = true;
      setAnalysisJobId(jobId);
      navigate('analysis');

      // The browser has no main process to emit progress; this keeps the demo
      // honest without inventing a different screen.
      if (!api.isDesktop) {
        if (demoTimer.current !== undefined) window.clearInterval(demoTimer.current);
        let percent = 0;
        demoTimer.current = window.setInterval(() => {
          percent = Math.min(100, percent + 8);
          setProgress({
            jobId,
            stage: percent < 55 ? 'index' : percent < 80 ? 'plan' : 'render',
            percent,
            status: percent >= 100 ? 'complete' : 'running',
            detail: percent >= 100 ? 'Variants ready' : 'Reading clips on this machine',
          });
          if (percent >= 100 && demoTimer.current !== undefined) {
            window.clearInterval(demoTimer.current);
            demoTimer.current = undefined;
          }
        }, 220);
      }
    } catch (error) {
      // Before the job starts the error belongs on Intake, next to the form the
      // user can fix. After it starts, the analysis screen owns the message.
      if (!started) throw error;
      setAnalysisError(messageOf(error));
      navigate('analysis');
    }
  };

  const approveVariant = async (id: string, approved: boolean): Promise<void> => {
    const updated = await api.variants.approve({
      listingId: selectedId,
      variantId: id,
      approved,
    });
    setVariantList((current) =>
      current.map((variant) =>
        variant.id === id ? { ...variant, approved: updated.approved } : variant,
      ),
    );
  };

  const previewVariant = async (id: string): Promise<string | undefined> => {
    try {
      const { stillPath, stillUrl } = await api.variants.preview({
        listingId: selectedId,
        variantId: id,
      });
      return stillUrl ?? stillPath;
    } catch {
      return undefined;
    }
  };

  const exportVideos = async (input: {
    quality: ExportQuality;
    captions: CaptionMode;
    voice: VoiceMode;
  }): Promise<{ files: string[]; exportDir: string; warnings?: string[] }> => {
    const result = await api.export.start({
      listingId: selectedId,
      profiles: selectedProfiles,
      quality: input.quality,
      captions: input.captions,
      voice: input.voice,
    });
    setListings((current) =>
      current.map((item) =>
        item.id === selectedId ? { ...item, status: 'exported' as const } : item,
      ),
    );
    return result;
  };

  const selectListing = (id: string) => {
    const record = listings.find((item) => item.id === id);
    setSelectedId(id);
    if (record?.status === 'draft') {
      setNewListing(false);
      navigate('intake');
      return;
    }
    navigate('variants');
  };

  const refreshShots = async (): Promise<void> => {
    const rows = await api.shots.list(selectedId);
    if (rows.length > 0) setShotCandidates(rows.map(candidateFromShot));
  };

  const props: ScreenProps = {
    listing,
    listings,
    variants: variantList,
    candidates: shotCandidates,
    onNavigate: navigate,
    onSelectListing: selectListing,
    progress,
    ...(analysisJobId === undefined ? {} : { analysisJobId }),
    ...(analysisError === undefined ? {} : { analysisError }),
    ...(folders[selectedId] === undefined ? {} : { folder: folders[selectedId] }),
    newListing,
    dataDir,
    spendUsd,
    selectedProfiles,
    onProfilesChange: setSelectedProfiles,
    onNewListing: () => {
      setNewListing(true);
      navigate('intake');
    },
    onChooseFolder: chooseFolder,
    onAnalyse: analyse,
    onApproveVariant: approveVariant,
    onPreviewVariant: previewVariant,
    onExport: exportVideos,
    onChatSend: (input) => api.chat.send(input),
    onChatApply: (input) => api.chat.apply(input),
    onChatVersions: (listingId, variantId) => api.chat.versions(listingId, variantId),
    onRefreshShots: refreshShots,
    onAgentRun: (input) => api.agent.run(input),
  };

  return (
    <div className="app">
      <aside className="rail">
        <div className="rail__brand">
          <svg className="rail__mark" viewBox="0 0 64 64" aria-hidden="true">
            <path fill="currentColor" d="M10 10h44v13L24 44h30v13H10V44l30-21H10z" />
            <path fill="#B08A4A" d="M24 20v24l26-12z" />
          </svg>
          <span className="rail__wordmark">Zeniconic</span>
        </div>

        <nav className="rail__nav" aria-label="Main">
          {nav.map((item) => (
            <button
              key={item.label}
              type="button"
              className={`navitem ${view === item.id ? 'is-on' : ''}`}
              onClick={() => navigate(item.id)}
            >
              <Icon name={item.icon} size={16} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="rail__spacer" />

        <div className="rail__note">
          <Icon name="check" size={14} />
          <div>
            <b>Local only</b>
            <span>Media never leaves this machine unless analysis needs a frame.</span>
          </div>
        </div>

        <div className="rail__account">
          <span className="avatar">Z</span>
          <div>
            <b>Local workspace</b>
            <span>Zeniconic</span>
          </div>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="crumb">
            <span>Listings</span>
            <span className="crumb__sep">/</span>
            <b>{listing.address}</b>
          </div>
          <div className="topbar__right">
            <span className="meter" title="Model spend on this machine">
              ${spendUsd.toFixed(2)} spent
            </span>
            <button type="button" className="themebtn" onClick={toggleTheme} aria-label="Toggle theme">
              {theme === 'dark' ? 'Light' : 'Dark'}
            </button>
          </div>
        </header>

        <main className="main">
          <Screen {...props} />
        </main>
      </div>
    </div>
  );
}
