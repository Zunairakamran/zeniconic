import type {
  CaptionMode,
  ChatApplyRequest,
  ChatApplyResult,
  ChatResult,
  ChatSendRequest,
  ChatVersion,
  ExportQuality,
  JobProgressEvent,
  VoiceMode,
} from '../../../packages/ipc/src/index';
import type { Facts } from '../../../packages/store/src/index';

export type View =
  | 'home'
  | 'intake'
  | 'analysis'
  | 'shots'
  | 'variants'
  | 'chat'
  | 'formats'
  | 'export'
  | 'settings';

export type ListingStatus = 'draft' | 'analysing' | 'ready' | 'exported' | 'failed';

export interface Listing {
  id: string;
  address: string;
  community: string;
  price: string;
  beds: number;
  baths: number;
  sqft: number;
  currency: Facts['currency'];
  status: ListingStatus;
  updatedAt: string;
  variantCount: number;
  progress?: number;
  tone: string;
}

export interface Variant {
  id: string;
  name: string;
  look: 'calm' | 'social' | 'walkthrough' | 'editorial';
  durationSec: number;
  clipCount: number;
  score: number;
  approved: boolean;
  tone: string;
  hook: string;
}

export interface Candidate {
  id: string;
  room: string;
  score: number;
  durationSec: number;
  reason: string;
  rejected?: string;
}

export interface ScreenProps {
  listing: Listing;
  listings: Listing[];
  variants: Variant[];
  candidates: Candidate[];
  onNavigate: (view: View) => void;
  onSelectListing: (id: string) => void;

  /** Latest `job:progress` event; screens decide whether it is theirs. */
  progress?: JobProgressEvent;
  /** Id of the job started for this listing, while it is active. */
  analysisJobId?: string;
  analysisError?: string;
  /** Folder chosen for the current analysis. */
  folder?: string;
  /** True when Intake is creating a brand-new listing. */
  newListing: boolean;
  dataDir: string;
  /** Render profiles selected in Formats, in selection order. */
  selectedProfiles: string[];
  onProfilesChange: (profiles: string[]) => void;
  onNewListing: () => void;
  onChooseFolder: () => Promise<string | null>;
  onAnalyse: (input: {
    folder: string;
    address?: string;
    facts?: Partial<Facts>;
  }) => Promise<void>;
  onApproveVariant: (id: string, approved: boolean) => Promise<void>;
  onPreviewVariant: (id: string) => Promise<string | undefined>;
  onExport: (input: {
    quality: ExportQuality;
    captions: CaptionMode;
    voice: VoiceMode;
  }) => Promise<{ files: string[]; exportDir: string; warnings?: string[] }>;

  /** Ask the assistant for a typed edit; returns a diff, not a current version. */
  onChatSend: (input: ChatSendRequest) => Promise<ChatResult>;
  /** Make a saved version current for export. */
  onChatApply: (input: ChatApplyRequest) => Promise<ChatApplyResult>;
  /** Saved chat versions, newest first. */
  onChatVersions: (listingId: string, variantId: string) => Promise<ChatVersion[]>;
}
