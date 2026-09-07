"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Bookmark,
  BookOpen,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleCheck,
  Clock,
  Copy,
  Database,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileSearch,
  FileText,
  Folder,
  Gavel,
  Globe,
  History,
  Home,
  KeyRound,
  Lightbulb,
  Loader2,
  Lock,
  Mail,
  Menu,
  Monitor,
  Moon,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  Share2,
  Shield,
  Sun,
  Trash2,
  TriangleAlert,
  User,
  X,
  type LucideIcon,
} from "lucide-react";

/* ================================================================== */
/* Utilities                                                           */
/* ================================================================== */

function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ================================================================== */
/* Domain models                                                       */
/* ================================================================== */

type ChatRole = "user" | "assistant";

interface UserProfile {
  id: string;
  name: string;
  email: string;
  initials: string;
}

type ActivityAction = "resume" | "view" | "open";
type ActivityKind = "inquiry" | "code" | "research";

interface RecentActivity {
  id: string;
  title: string;
  timestamp: string;
  tag: string;
  action: ActivityAction;
  kind: ActivityKind;
}

interface Citation {
  heading: string;
  body: string;
}

interface RetrievedSource {
  id: string;
  title: string;
  category: SourceCategory;
  chunk: string;
  score: number;
  highlight?: string;
}

interface RetrieverState {
  method: string;
  index: string;
  sources: RetrievedSource[];
}

interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  reasoning?: string | null;
  suggestions?: string[];
  citation?: Citation | null;
  timestamp?: string;
  retriever?: RetrieverState | null;
}

type SourceCategory = "statutory" | "jurisprudence";

interface CaseSummary {
  id: string;
  title: string;
  referenceId: string;
  lastActive: string;
  tags: string[];
}

interface CaseDetail {
  summary: CaseSummary;
  messages: ChatMessage[];
}

interface CodeChapter {
  id: string;
  name: string;
  articleRange: string;
}

interface CodeTitle {
  id: string;
  name: string;
  chapters: CodeChapter[];
}

interface CodeBook {
  id: string;
  name: string;
  subtitle: string;
  titles: CodeTitle[];
}

interface Article {
  id: string;
  number: string;
  heading: string;
  body: string;
  annotations: number;
  crossReferences: string[];
  breadcrumb: string[];
}

interface JurisprudenceCase {
  id: string;
  name: string;
  grNumber: string;
  year: string;
  summary: string;
}

interface DocumentSection {
  text: string;
  flagged?: boolean;
  flagNote?: string | null;
}

interface ResearchDocument {
  id: string;
  title: string;
  ocrComplete: boolean;
  sections: DocumentSection[];
}

interface FlaggedIssue {
  title: string;
  description: string;
}

type ThemeMode = "light" | "dark" | "system";

interface UserSettings {
  name: string;
  email: string;
  theme: ThemeMode;
  emailNotifications: boolean;
  region: string;
  twoFactorEnabled: boolean;
}

type AppScreen =
  | "signin"
  | "signup"
  | "home"
  | "chat"
  | "history"
  | "codes"
  | "research"
  | "settings";

/* ================================================================== */
/* Mock data (mirrors MockData.kt)                                     */
/* ================================================================== */

const NETWORK_DELAY_MS = 350;

const mockUser: UserProfile = {
  id: "u-001",
  name: "Raiven Dela Cruz",
  email: "raiven@civil-lex.ph",
  initials: "RD",
};

const recentActivity: RecentActivity[] = [
  {
    id: "act-1",
    title: "Unpaid personal loan inquiry",
    timestamp: "2 hours ago",
    tag: "Obligations",
    action: "resume",
    kind: "inquiry",
  },
  {
    id: "act-2",
    title: "Art. 1484 — Remedies in sale of personal property",
    timestamp: "Yesterday",
    tag: "Civil Code",
    action: "view",
    kind: "code",
  },
  {
    id: "act-3",
    title: "Lease Agreement Review — Reyes Property",
    timestamp: "2 days ago",
    tag: "Research",
    action: "open",
    kind: "research",
  },
];

const retrievedSources: RetrievedSource[] = [
  {
    id: "rs-1",
    category: "statutory",
    title: "Article 1159, Civil Code",
    chunk:
      "Obligations arising from contracts have the force of law between the contracting parties and should be complied with in good faith.",
    score: 0.94,
    highlight: "force of law",
  },
  {
    id: "rs-2",
    category: "statutory",
    title: "Article 1169, Civil Code",
    chunk:
      "Those obliged to deliver or to do something incur in delay from the time the obligee judicially or extrajudicially demands from them the fulfillment of their obligation.",
    score: 0.87,
    highlight: "extrajudicially demands",
  },
  {
    id: "rs-3",
    category: "jurisprudence",
    title: "Nacar v. Gallery Frames",
    chunk:
      "In the absence of an express stipulation, the rate of interest for the loan or forbearance of any money shall be 6% per annum.",
    score: 0.81,
    highlight: "6% per annum",
  },
];

const retrieverState: RetrieverState = {
  method: "BM25 + XLM-RoBERTa",
  index: "FAISS Index (3 Chunks)",
  sources: retrievedSources,
};

const chatMessages: ChatMessage[] = [
  {
    id: "m-1",
    role: "user",
    text: "My friend borrowed ₱50,000 from me eight months ago and refuses to pay despite repeated verbal demands. What are my legal options?",
    timestamp: "10:42 AM",
  },
  {
    id: "m-2",
    role: "assistant",
    text: "Based on the Civil Code of the Philippines, your friend has a clear obligation to repay the loan. Under Article 1159, obligations arising from contracts have the force of law between the contracting parties and must be complied with in good faith.\n\nSince repeated verbal demands were made, the debtor may already be in delay (mora solvendi) under Article 1169. I recommend sending a formal written demand letter before escalating to legal action — it strengthens your evidence of extrajudicial demand and may entitle you to legal interest.",
    reasoning:
      "1. Identified the transaction as a simple loan (mutuum) under Art. 1953.\n2. Established that the obligation is demandable — no stipulated period was mentioned.\n3. Verified requisites of delay under Art. 1169: demand is generally required.\n4. Applied Nacar v. Gallery Frames for the applicable legal interest rate of 6% per annum.",
    suggestions: [
      "Draft a demand letter",
      "Compute legal interest",
      "What if he still refuses to pay?",
    ],
    timestamp: "10:42 AM",
    retriever: retrieverState,
  },
];

const caseSummaries: CaseSummary[] = [
  {
    id: "case-1",
    title: "Motorcycle Purchase Default",
    referenceId: "CVX-2025-0114",
    lastActive: "Jan 14, 2025 · 4:20 PM",
    tags: ["Sales", "Chattel Mortgage"],
  },
  {
    id: "case-2",
    title: "Unpaid Personal Loan",
    referenceId: "CVX-2025-0102",
    lastActive: "Jan 2, 2025 · 9:12 AM",
    tags: ["Obligations", "Interest"],
  },
  {
    id: "case-3",
    title: "Boundary Dispute — Lot 5-B",
    referenceId: "CVX-2024-1220",
    lastActive: "Dec 20, 2024 · 2:45 PM",
    tags: ["Property", "Easements"],
  },
];

const caseOneMessages: ChatMessage[] = [
  {
    id: "cm-1",
    role: "user",
    text: "I bought a motorcycle on installment and missed three payments. The seller wants to repossess the unit AND collect the remaining balance. Can they do both?",
    timestamp: "Jan 14 · 4:02 PM",
  },
  {
    id: "cm-2",
    role: "assistant",
    text: "No — the seller must choose only one remedy. In a sale of personal property payable in installments secured by a chattel mortgage, Article 1484 of the Civil Code (the Recto Law) gives the vendor three alternative, not cumulative, remedies:",
    citation: {
      heading: "Article 1484, Civil Code (Recto Law)",
      body: "In a contract of sale of personal property the price of which is payable in installments, the vendor may exercise any of the following remedies: (1) Exact fulfillment of the obligation, should the vendee fail to pay; (2) Cancel the sale, should the vendee's failure to pay cover two or more installments; (3) Foreclose the chattel mortgage on the thing sold, if one has been constituted, should the vendee's failure to pay cover two or more installments. In this case, he shall have no further action against the purchaser to recover any unpaid balance of the price. Any agreement to the contrary shall be void.",
    },
    timestamp: "Jan 14 · 4:03 PM",
  },
  {
    id: "cm-3",
    role: "user",
    text: "So if they foreclose the mortgage, they can no longer run after me for the deficiency?",
    timestamp: "Jan 14 · 4:10 PM",
  },
  {
    id: "cm-4",
    role: "assistant",
    text: "Correct. Once the vendor elects foreclosure of the chattel mortgage and actually sells the unit at a foreclosure sale, the law bars any further action to recover the unpaid balance. Any stipulation allowing deficiency recovery is void. Keep every receipt and the mortgage contract — those documents will control the analysis.",
    suggestions: ["Draft a reply to the seller", "Explain voluntary surrender effects"],
    timestamp: "Jan 14 · 4:11 PM",
  },
];

const caseDetails: Record<string, CaseDetail> = {
  "case-1": { summary: caseSummaries[0], messages: caseOneMessages },
  "case-2": { summary: caseSummaries[1], messages: chatMessages },
  "case-3": {
    summary: caseSummaries[2],
    messages: [
      {
        id: "bm-1",
        role: "user",
        text: "My neighbor built a fence two meters into what I believe is my titled lot. What should I do first?",
        timestamp: "Dec 20 · 2:30 PM",
      },
      {
        id: "bm-2",
        role: "assistant",
        text: "Start with a relocation survey by a licensed geodetic engineer to establish the true boundaries, then attempt barangay conciliation as required by the Katarungang Pambarangay Law before any court action.",
        timestamp: "Dec 20 · 2:31 PM",
      },
    ],
  },
};

const codeBooks: CodeBook[] = [
  {
    id: "prelim",
    name: "Preliminary Title",
    subtitle: "Arts. 1–36",
    titles: [
      {
        id: "prelim-t1",
        name: "Effect and Application of Laws",
        chapters: [
          { id: "prelim-t1-c1", name: "Chapter 1 — Effectivity", articleRange: "Arts. 1–18" },
        ],
      },
      {
        id: "prelim-t2",
        name: "Human Relations",
        chapters: [
          { id: "prelim-t2-c1", name: "Chapter 2 — Abuse of Rights", articleRange: "Arts. 19–36" },
        ],
      },
    ],
  },
  {
    id: "book1",
    name: "Book I — Persons",
    subtitle: "Arts. 37–413",
    titles: [
      {
        id: "b1-t1",
        name: "Title I — Civil Personality",
        chapters: [
          { id: "b1-t1-c1", name: "Chapter 1 — General Provisions", articleRange: "Arts. 37–39" },
          { id: "b1-t1-c2", name: "Chapter 2 — Natural Persons", articleRange: "Arts. 40–43" },
          { id: "b1-t1-c3", name: "Chapter 3 — Juridical Persons", articleRange: "Arts. 44–47" },
        ],
      },
      {
        id: "b1-t2",
        name: "Title II — Citizenship and Domicile",
        chapters: [
          { id: "b1-t2-c1", name: "Chapter 1 — Citizenship", articleRange: "Arts. 48–51" },
        ],
      },
    ],
  },
  {
    id: "book4",
    name: "Book IV — Obligations and Contracts",
    subtitle: "Arts. 1156–2270",
    titles: [
      {
        id: "b4-t1",
        name: "Title I — Obligations",
        chapters: [
          { id: "b4-t1-c1", name: "Chapter 1 — General Provisions", articleRange: "Arts. 1156–1162" },
          { id: "b4-t1-c2", name: "Chapter 2 — Nature and Effect", articleRange: "Arts. 1163–1178" },
        ],
      },
      {
        id: "b4-t2",
        name: "Title VI — Sales",
        chapters: [
          { id: "b4-t2-c1", name: "Chapter 1 — Nature and Form", articleRange: "Arts. 1458–1488" },
        ],
      },
    ],
  },
];

const articles: Record<string, Article> = {
  "b1-t1-c1": {
    id: "art-37",
    number: "Article 37",
    heading: "Juridical capacity and capacity to act",
    body: "Juridical capacity, which is the fitness to be the subject of legal relations, is inherent in every natural person and is lost only through death. Capacity to act, which is the power to do acts with legal effect, is acquired and may be lost.",
    annotations: 12,
    crossReferences: ["Art. 38", "Art. 39", "Art. 40"],
    breadcrumb: ["Book I", "Title I", "Chapter 1"],
  },
  "b4-t1-c1": {
    id: "art-1156",
    number: "Article 1156",
    heading: "Definition of obligation",
    body: "An obligation is a juridical necessity to give, to do or not to do. Obligations arise from: (1) Law; (2) Contracts; (3) Quasi-contracts; (4) Acts or omissions punished by law; and (5) Quasi-delicts.",
    annotations: 27,
    crossReferences: ["Art. 1157", "Art. 1159", "Art. 1305"],
    breadcrumb: ["Book IV", "Title I", "Chapter 1"],
  },
  "prelim-t1-c1": {
    id: "art-2",
    number: "Article 2",
    heading: "Effectivity of laws",
    body: "Laws shall take effect after fifteen days following the completion of their publication either in the Official Gazette, or in a newspaper of general circulation in the Philippines, unless it is otherwise provided.",
    annotations: 9,
    crossReferences: ["Art. 3", "Art. 4"],
    breadcrumb: ["Preliminary Title", "Title I", "Chapter 1"],
  },
};

const jurisprudence: Record<string, JurisprudenceCase[]> = {
  "art-37": [
    {
      id: "j-1",
      name: "Geluz v. Court of Appeals",
      grNumber: "G.R. No. L-16439",
      year: "1961",
      summary:
        "An unborn fetus is not endowed with personality; an action for damages on its behalf requires that it be born alive, even briefly, under the conditions of Article 41.",
    },
    {
      id: "j-2",
      name: "Limjoco v. Intestate Estate of Fragrante",
      grNumber: "G.R. No. L-770",
      year: "1948",
      summary:
        "The estate of a deceased person is considered a 'person' that continues the juridical personality of the decedent for purposes of pending certificate applications.",
    },
  ],
  "art-1156": [
    {
      id: "j-3",
      name: "Nacar v. Gallery Frames",
      grNumber: "G.R. No. 189871",
      year: "2013",
      summary:
        "Restated the guidelines on the imposition of legal interest on monetary obligations, fixing the rate at 6% per annum in the absence of stipulation.",
    },
    {
      id: "j-4",
      name: "Metropolitan Bank v. Rosales",
      grNumber: "G.R. No. 183204",
      year: "2014",
      summary:
        "Obligations arising from contracts have the force of law; a bank's unilateral freezing of an account breached its contractual obligation to its depositor.",
    },
  ],
  "art-2": [
    {
      id: "j-5",
      name: "Tañada v. Tuvera",
      grNumber: "G.R. No. L-63915",
      year: "1986",
      summary:
        "Publication is an indispensable requisite for the effectivity of laws; 'unless it is otherwise provided' refers only to the fifteen-day period, not to the requirement of publication itself.",
    },
  ],
};

const researchDocument: ResearchDocument = {
  id: "doc-1",
  title: "Contract of Lease — Reyes Property.pdf",
  ocrComplete: true,
  sections: [
    {
      text: 'CONTRACT OF LEASE\n\nThis Contract of Lease is entered into by and between Maria S. Reyes (the "LESSOR") and Juan P. Santos (the "LESSEE"), covering the residential unit located at 12 Sampaguita St., Quezon City.',
    },
    {
      text: "1. TERM. The lease shall be for a period of one (1) year commencing on 01 February 2025 and expiring on 31 January 2026, renewable upon mutual written agreement of the parties.",
    },
    {
      text: "2. DEPOSIT. The LESSEE shall pay a security deposit equivalent to two (2) months rent. Said deposit shall be automatically forfeited in favor of the LESSOR upon any delay in the payment of rent, regardless of cause.",
      flagged: true,
      flagNote:
        "Automatic forfeiture regardless of cause may be void as an iniquitous penal clause under Arts. 1226 and 1229.",
    },
    {
      text: "3. REPAIRS. The LESSEE waives all rights to demand repairs of any kind and accepts the premises 'as is', including structural defects discovered during the lease term.",
      flagged: true,
      flagNote:
        "Blanket waiver of repairs conflicts with the lessor's obligations under Art. 1654 (2) of the Civil Code.",
    },
    {
      text: "4. RENT. Monthly rent of ₱18,000.00 payable within the first five (5) days of each month. A penalty of 3% per month applies to late payments.",
    },
  ],
};

const flaggedIssues: FlaggedIssue[] = [
  {
    title: "Automatic deposit forfeiture (Sec. 2)",
    description:
      "Conflicts with Arts. 1226 & 1229 — courts may equitably reduce iniquitous or unconscionable penal clauses.",
  },
  {
    title: "Blanket repair waiver (Sec. 3)",
    description:
      "Contradicts Art. 1654 (2) which obliges the lessor to make necessary repairs; likely unenforceable.",
  },
];

const researchSuggestions = [
  "Summarize document",
  "Identify key risks",
  "Check deposit clause validity",
  "Draft revision notes",
];

const defaultSettings: UserSettings = {
  name: mockUser.name,
  email: mockUser.email,
  theme: "light",
  emailNotifications: true,
  region: "Philippines (English)",
  twoFactorEnabled: false,
};

/* ================================================================== */
/* Mock repositories (async, swap for real HTTP later)                 */
/* ================================================================== */

const mockRepos = {
  async signIn(email: string, password: string): Promise<UserProfile> {
    await delay(NETWORK_DELAY_MS);
    if (!email.trim() || !password) {
      throw new Error("Email and password are required.");
    }
    return mockUser;
  },
  async signUp(email: string, username: string, password: string): Promise<UserProfile> {
    await delay(NETWORK_DELAY_MS);
    if (!email.trim() || !username.trim() || !password) {
      throw new Error("All fields are required.");
    }
    return { ...mockUser, name: username.trim() };
  },
  async signInWithGoogle(): Promise<UserProfile> {
    await delay(NETWORK_DELAY_MS);
    return mockUser;
  },
  async requestPasswordReset(): Promise<void> {
    await delay(NETWORK_DELAY_MS);
  },
  async recentActivity(): Promise<RecentActivity[]> {
    await delay(NETWORK_DELAY_MS);
    return recentActivity;
  },
  async openingMessages(): Promise<ChatMessage[]> {
    await delay(NETWORK_DELAY_MS);
    return chatMessages;
  },
  async sendMessage(_conversationId: string | null, text: string): Promise<ChatMessage> {
    await delay(900);
    return {
      id: `reply-${text.length}-${Date.now()}`,
      role: "assistant",
      text: "Thank you for the additional detail. Once the backend is connected, this assistant will analyze your question against the Civil Code and relevant jurisprudence, then respond with cited legal reasoning.",
      reasoning:
        "1. Parse the user's question.\n2. Retrieve candidate provisions and jurisprudence.\n3. Rank sources by relevance.\n4. Compose a grounded answer with citations.",
      suggestions: ["Draft a demand letter", "Show related jurisprudence"],
      timestamp: "Just now",
      retriever: retrieverState,
    };
  },
  async cases(): Promise<CaseSummary[]> {
    await delay(NETWORK_DELAY_MS);
    return caseSummaries;
  },
  async caseDetail(caseId: string): Promise<CaseDetail | undefined> {
    await delay(NETWORK_DELAY_MS);
    return caseDetails[caseId];
  },
  async tableOfContents(): Promise<CodeBook[]> {
    await delay(NETWORK_DELAY_MS);
    return codeBooks;
  },
  async article(chapterId: string): Promise<Article | undefined> {
    await delay(NETWORK_DELAY_MS);
    return articles[chapterId];
  },
  async relatedJurisprudence(articleId: string): Promise<JurisprudenceCase[]> {
    await delay(NETWORK_DELAY_MS);
    return jurisprudence[articleId] ?? [];
  },
  async activeDocument(): Promise<ResearchDocument> {
    await delay(NETWORK_DELAY_MS);
    return researchDocument;
  },
  async flaggedIssues(): Promise<FlaggedIssue[]> {
    await delay(NETWORK_DELAY_MS);
    return flaggedIssues;
  },
  async askAssistant(_documentId: string, prompt: string): Promise<ChatMessage> {
    await delay(900);
    return {
      id: `doc-reply-${Date.now()}`,
      role: "assistant",
      text: `Once connected to the analysis endpoint, I will answer "${prompt}" using the parsed contents of this document, citing the exact sections and any conflicting Civil Code provisions.`,
      timestamp: "Just now",
    };
  },
  async settings(): Promise<UserSettings> {
    await delay(NETWORK_DELAY_MS);
    return defaultSettings;
  },
  async updateProfile(name: string, email: string): Promise<UserSettings> {
    await delay(NETWORK_DELAY_MS);
    if (!name.trim() || !email.trim()) {
      throw new Error("Name and email are required.");
    }
    defaultSettings.name = name.trim();
    defaultSettings.email = email.trim();
    return { ...defaultSettings };
  },
  async updatePreferences(settings: UserSettings): Promise<UserSettings> {
    Object.assign(defaultSettings, settings);
    return { ...defaultSettings };
  },
};

/* ================================================================== */
/* App state hook                                                      */
/* ================================================================== */

interface AppState {
  screen: AppScreen;
  user: UserProfile | null;
  selectedCaseId: string | null;
  historyExpanded: boolean;
  navigate: (target: AppScreen) => void;
  openCase: (caseId: string) => void;
  closeCase: () => void;
  onAuthenticated: (profile: UserProfile) => void;
  signOut: () => void;
  setHistoryExpanded: (expanded: boolean) => void;
}

function useAppState(): AppState {
  const [screen, setScreen] = useState<AppScreen>("signin");
  const [user, setUser] = useState<UserProfile | null>(null);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [historyExpanded, setHistoryExpanded] = useState(false);

  const navigate = useCallback((target: AppScreen) => {
    setScreen(target);
    if (target === "history") {
      setSelectedCaseId((prev) => {
        if (prev === null) setHistoryExpanded(true);
        return prev;
      });
    }
  }, []);

  const openCase = useCallback((caseId: string) => {
    setSelectedCaseId(caseId);
    setHistoryExpanded(true);
    setScreen("history");
  }, []);

  const closeCase = useCallback(() => setSelectedCaseId(null), []);

  const onAuthenticated = useCallback((profile: UserProfile) => {
    setUser(profile);
    setScreen("home");
  }, []);

  const signOut = useCallback(() => {
    setUser(null);
    setSelectedCaseId(null);
    setScreen("signin");
  }, []);

  return {
    screen,
    user,
    selectedCaseId,
    historyExpanded,
    navigate,
    openCase,
    closeCase,
    onAuthenticated,
    signOut,
    setHistoryExpanded,
  };
}

/* ================================================================== */
/* Theme hook (Light / Dark / System)                                  */
/* ================================================================== */

function applyTheme(mode: ThemeMode) {
  const root = document.documentElement;
  const prefersDark =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = mode === "dark" || (mode === "system" && prefersDark);
  root.classList.toggle("dark", dark);
}

function useTheme(preference: ThemeMode) {
  useEffect(() => {
    applyTheme(preference);
    if (preference !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [preference]);
}

/* ================================================================== */
/* Branding                                                            */
/* ================================================================== */

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 12.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </svg>
  );
}

function BrandLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex size-[34px] items-center justify-center rounded-lg bg-primary">
        <Gavel className="size-[18px] text-primary-foreground" aria-hidden="true" />
      </span>
      {!compact && (
        <span className="text-[17px] font-bold leading-none tracking-tight">
          <span className="text-primary">CIVIL</span>
          <span className="text-purple">-LEX</span>
        </span>
      )}
    </div>
  );
}

/* ================================================================== */
/* UI primitives                                                       */
/* ================================================================== */

function PillTag({
  text,
  tone = "lavender",
  className,
}: {
  text: string;
  tone?: "lavender" | "gold" | "blue";
  className?: string;
}) {
  const toneClasses: Record<string, string> = {
    lavender: "bg-lavender text-primary",
    gold: "bg-gold-soft text-gold",
    blue: "bg-blue-soft text-blue-text",
  };
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center truncate rounded-full px-2.5 py-1 text-xs font-medium leading-none",
        toneClasses[tone],
        className,
      )}
    >
      {text}
    </span>
  );
}

interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "outline";
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
}

function CxButton({
  children,
  onClick,
  variant = "primary",
  disabled = false,
  className,
  type = "button",
}: ButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-11 items-center justify-center gap-2 rounded-[10px] px-[18px] text-sm font-semibold",
        "transition-all duration-200 ease-in-out",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "active:scale-[0.98] disabled:pointer-events-none disabled:opacity-55",
        variant === "primary"
          ? "bg-primary text-primary-foreground hover:bg-navy-dark hover:shadow-md"
          : "border border-border-strong bg-transparent text-foreground hover:bg-muted/60",
        className,
      )}
    >
      {children}
    </button>
  );
}

function IconActionButton({
  icon: Icon,
  onClick,
  label,
  bordered = true,
  size = 36,
  className,
}: {
  icon: LucideIcon;
  onClick?: () => void;
  label: string;
  bordered?: boolean;
  size?: number;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{ width: size, height: size }}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[9px]",
        "text-muted-foreground transition-all duration-200 ease-in-out hover:bg-muted hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "active:scale-[0.95]",
        bordered && "border border-border",
        className,
      )}
    >
      <Icon className="h-[45%] w-[45%]" aria-hidden="true" />
    </button>
  );
}

function Avatar({
  initials,
  size = 36,
  onClick,
}: {
  initials: string;
  size?: number;
  onClick?: () => void;
}) {
  const Comp = onClick ? "button" : "span";
  return (
    <Comp
      {...(onClick
        ? {
            type: "button" as const,
            onClick,
            "aria-label": "Open settings",
          }
        : {})}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      className={cn(
        "inline-flex items-center justify-center rounded-full bg-primary font-bold text-primary-foreground",
        onClick &&
          "transition-all duration-200 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95",
      )}
    >
      {initials}
    </Comp>
  );
}

interface TextFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  leadingIcon?: LucideIcon;
  trailingIcon?: LucideIcon;
  onTrailingClick?: () => void;
  type?: string;
  height?: number;
  onSubmit?: () => void;
  ariaLabel?: string;
  autoComplete?: string;
  name?: string;
}

function CxTextField({
  value,
  onChange,
  placeholder = "",
  leadingIcon: LeadingIcon,
  trailingIcon: TrailingIcon,
  onTrailingClick,
  type = "text",
  height = 46,
  onSubmit,
  ariaLabel,
  autoComplete,
  name,
}: TextFieldProps) {
  const [focused, setFocused] = useState(false);

  return (
    <div
      style={{ height }}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-[10px] border bg-card px-3 transition-all duration-200",
        focused ? "border-primary ring-1 ring-primary/30" : "border-border-strong",
      )}
    >
      {LeadingIcon && (
        <LeadingIcon className="size-[18px] shrink-0 text-text-tertiary" aria-hidden="true" />
      )}
      <div className="relative flex min-w-0 flex-1 items-center">
        {!value && (
          <span className="pointer-events-none absolute truncate text-sm text-text-tertiary">
            {placeholder}
          </span>
        )}
        <input
          name={name}
          type={type}
          value={value}
          autoComplete={autoComplete}
          aria-label={ariaLabel ?? placeholder}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && onSubmit) onSubmit();
          }}
          className="w-full bg-transparent text-sm text-foreground outline-none"
        />
      </div>
      {TrailingIcon && (
        <button
          type="button"
          onClick={onTrailingClick}
          aria-label={onTrailingClick ? "Toggle password visibility" : undefined}
          className={cn(
            "shrink-0 text-text-tertiary transition-colors hover:text-foreground",
            !onTrailingClick && "pointer-events-none",
          )}
        >
          <TrailingIcon className="size-[19px]" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function PasswordField({
  value,
  onChange,
  placeholder = "Password",
  onSubmit,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onSubmit?: () => void;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <CxTextField
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      leadingIcon={Lock}
      trailingIcon={visible ? EyeOff : Eye}
      onTrailingClick={() => setVisible((v) => !v)}
      type={visible ? "text" : "password"}
      onSubmit={onSubmit}
      ariaLabel={placeholder}
    />
  );
}

function SuggestionChip({
  text,
  onClick,
}: {
  text: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex max-w-full items-center rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-medium text-primary transition-all duration-200 hover:border-primary hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
    >
      <span className="truncate">{text}</span>
    </button>
  );
}

function CxSwitch({
  checked,
  onCheckedChange,
  label,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        checked ? "bg-primary" : "bg-border-strong",
      )}
    >
      <span
        className={cn(
          "inline-block size-5 transform rounded-full bg-white shadow transition-transform duration-200",
          checked ? "translate-x-[22px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

function SegmentedControl({
  options,
  selectedIndex,
  onSelect,
}: {
  options: { label: string; icon: LucideIcon }[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Theme selection"
      className="inline-flex items-center gap-0.5 rounded-[10px] border border-border bg-background p-[3px]"
    >
      {options.map((opt, index) => {
        const selected = index === selectedIndex;
        const Icon = opt.icon;
        return (
          <button
            key={opt.label}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(index)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-[7px] text-xs transition-all duration-200",
              selected
                ? "border border-border bg-card font-semibold text-primary shadow-sm"
                : "font-medium text-muted-foreground hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <Icon className="size-[15px]" aria-hidden="true" />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function FieldLabel({ text, htmlFor }: { text: string; htmlFor?: string }) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-[7px] block text-sm font-semibold text-foreground"
    >
      {text}
    </label>
  );
}

function FieldLabelSmall({ text }: { text: string }) {
  return (
    <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">
      {text}
    </span>
  );
}

/* ================================================================== */
/* Chat components                                                     */
/* ================================================================== */

function CitationBox({ citation }: { citation: Citation }) {
  return (
    <section
      aria-label="Legal citation"
      className="w-full rounded-[10px] border border-border bg-citation p-3.5"
    >
      <div className="flex items-center gap-2">
        <BookOpen className="size-[15px] text-primary" aria-hidden="true" />
        <h4 className="text-[13px] font-semibold text-primary">{citation.heading}</h4>
      </div>
      <p className="mt-2 text-xs leading-[18px] text-muted-foreground">
        “{citation.body}”
      </p>
    </section>
  );
}

function ReasoningAccordion({ reasoning }: { reasoning: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="w-full rounded-[10px] border border-lavender-strong bg-lavender/55">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 rounded-[10px] px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Lightbulb className="size-[15px] shrink-0 text-purple" aria-hidden="true" />
        <span className="flex-1 text-xs font-semibold text-primary">
          Legal Reasoning Process
        </span>
        {expanded ? (
          <ChevronUp className="size-[17px] text-muted-foreground" aria-hidden="true" />
        ) : (
          <ChevronDown className="size-[17px] text-muted-foreground" aria-hidden="true" />
        )}
      </button>
      {expanded && (
        <p className="whitespace-pre-line px-3 pb-3 text-xs leading-[18px] text-muted-foreground">
          {reasoning}
        </p>
      )}
    </div>
  );
}

function AssistantAvatar({ size = 30 }: { size?: number }) {
  return (
    <span
      style={{ width: size, height: size }}
      className="inline-flex shrink-0 items-center justify-center rounded-lg bg-primary"
    >
      <Gavel className="text-primary-foreground" style={{ width: size * 0.46, height: size * 0.46 }} aria-hidden="true" />
    </span>
  );
}

function MicroAction({
  icon: Icon,
  label,
  onClick,
  active = false,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-md transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "text-green" : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <Icon className="size-[13px]" aria-hidden="true" />
    </button>
  );
}

function MessageActions({
  copied,
  onCopy,
  onRerun,
  onViewSource,
}: {
  copied: boolean;
  onCopy: () => void;
  onRerun?: () => void;
  onViewSource?: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-0.5">
      <MicroAction
        label={copied ? "Copied" : "Copy response"}
        onClick={onCopy}
        icon={copied ? CircleCheck : Copy}
        active={copied}
      />
      {onRerun && <MicroAction label="Re-run query" onClick={onRerun} icon={RefreshCw} />}
      {onViewSource && <MicroAction label="View source statute" onClick={onViewSource} icon={BookOpen} />}
    </span>
  );
}

function RetrieverStateCard({ retriever }: { retriever: RetrieverState }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="w-full rounded-[10px] border border-border bg-muted/50">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-[10px] px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Database className="size-[14px] shrink-0 text-primary" aria-hidden="true" />
        <span className="text-[11px] font-semibold text-foreground">Retrieved context</span>
        <span className="inline-flex items-center rounded-full bg-lavender px-2 py-0.5 text-[10px] font-medium text-primary">
          {retriever.method}
        </span>
        <span className="hidden items-center rounded-full bg-gold-soft px-2 py-0.5 text-[10px] font-medium text-gold sm:inline-flex">
          {retriever.index}
        </span>
        {open ? (
          <ChevronUp className="ml-auto size-[15px] shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : (
          <ChevronDown className="ml-auto size-[15px] shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
      </button>
      {open && (
        <ul className="flex flex-col gap-1.5 border-t border-border px-3 py-2.5">
          {retriever.sources.map((s) => (
            <li key={s.id} className="flex items-center gap-2">
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  s.category === "statutory" ? "bg-purple" : "bg-gold",
                )}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                {s.title}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-text-tertiary">
                {Math.round(s.score * 100)}%
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function HighlightedText({ text, highlight }: { text: string; highlight?: string }) {
  if (!highlight) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(highlight.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded-[3px] bg-gold-soft px-0.5 text-inherit">
        {text.slice(idx, idx + highlight.length)}
      </mark>
      {text.slice(idx + highlight.length)}
    </>
  );
}

function UserBubble({ message }: { message: ChatMessage }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(message.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  }, [message.text]);
  return (
    <div className="group flex w-full justify-end">
      <div className="flex max-w-[560px] flex-col items-end">
        <div className="rounded-[14px] rounded-br-[4px] bg-primary px-4 py-3 text-sm leading-[21px] text-primary-foreground">
          {message.text}
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          <span className="opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
            <MicroAction
              label={copied ? "Copied" : "Copy"}
              onClick={copy}
              icon={copied ? CircleCheck : Copy}
              active={copied}
            />
          </span>
          {message.timestamp && (
            <span className="text-[11px] text-text-tertiary">{message.timestamp}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function AssistantBubble({
  message,
  onSuggestion,
  showSuggestions,
  streaming = false,
  onRerun,
  onViewSource,
}: {
  message: ChatMessage;
  onSuggestion: (text: string) => void;
  showSuggestions: boolean;
  streaming?: boolean;
  onRerun?: () => void;
  onViewSource?: (sourceId: string) => void;
}) {
  const suggestions = message.suggestions ?? [];
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(message.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  }, [message.text]);
  const firstSourceId = message.retriever?.sources[0]?.id;

  return (
    <div className="group flex w-full justify-start">
      <AssistantAvatar />
      <div className="ml-2.5 flex min-w-0 max-w-[680px] flex-1 flex-col">
        {message.retriever && (
          <div className="mb-2">
            <RetrieverStateCard retriever={message.retriever} />
          </div>
        )}
        <div className="rounded-[14px] rounded-tl-[4px] border border-border bg-card px-4 py-[13px]">
          <div className="prose prose-sm dark:prose-invert max-w-none [&_p]:my-0">
            <p className="whitespace-pre-line text-sm leading-[21px]">
              {message.text}
              {streaming && (
                <span
                  className="ml-0.5 inline-block h-[14px] w-[6px] animate-pulse rounded-[1px] bg-primary align-middle"
                  aria-hidden="true"
                />
              )}
            </p>
          </div>
          {message.citation && (
            <div className="mt-3">
              <CitationBox citation={message.citation} />
            </div>
          )}
          {message.reasoning && (
            <div className="mt-3">
              <ReasoningAccordion reasoning={message.reasoning} />
            </div>
          )}
        </div>
        <div className="mt-1 flex min-h-[20px] items-center gap-1.5">
          <span className="opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
            <MessageActions
              copied={copied}
              onCopy={copy}
              onRerun={onRerun}
              onViewSource={firstSourceId && onViewSource ? () => onViewSource(firstSourceId) : undefined}
            />
          </span>
          {message.timestamp && (
            <span className="text-[11px] text-text-tertiary">{message.timestamp}</span>
          )}
        </div>
        {showSuggestions && suggestions.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <SuggestionChip key={s} text={s} onClick={() => onSuggestion(s)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ChatMessageItem({
  message,
  onSuggestion = () => {},
  showSuggestions = true,
  onRerun,
  onViewSource,
}: {
  message: ChatMessage;
  onSuggestion?: (text: string) => void;
  showSuggestions?: boolean;
  onRerun?: () => void;
  onViewSource?: (sourceId: string) => void;
}) {
  if (message.role === "user") {
    return <UserBubble message={message} />;
  }
  return (
    <AssistantBubble
      message={message}
      onSuggestion={onSuggestion}
      showSuggestions={showSuggestions}
      onRerun={onRerun}
      onViewSource={onViewSource}
    />
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-center" role="status" aria-live="polite">
      <AssistantAvatar />
      <div className="ml-2.5 flex items-center gap-1.5 rounded-[12px] border border-border bg-card px-4 py-2.5">
        <span className="text-xs text-text-tertiary">Analyzing your question</span>
        <span className="flex gap-0.5">
          <span className="typing-dot size-1 animate-bounce rounded-full bg-text-tertiary [animation-delay:0ms]" />
          <span className="typing-dot size-1 animate-bounce rounded-full bg-text-tertiary [animation-delay:150ms]" />
          <span className="typing-dot size-1 animate-bounce rounded-full bg-text-tertiary [animation-delay:300ms]" />
        </span>
      </div>
    </div>
  );
}

const GLOW_GRADIENT =
  "conic-gradient(from 0deg, #4285f4, #6c5ce7, #06b6d4, #ec4899, #f59e0b, #4285f4)";

function ChatInputBar({
  value,
  onValueChange,
  onSend,
  placeholder = "Type your legal question...",
  enabled = true,
}: {
  value: string;
  onValueChange: (value: string) => void;
  onSend: () => void;
  placeholder?: string;
  enabled?: boolean;
}) {
  const isLoading = !enabled;
  const canSend = !isLoading && value.trim().length > 0;

  return (
    <div className="group relative">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-[3px] rounded-[20px] opacity-0 blur-xl transition-opacity duration-500 ease-out group-hover:opacity-60"
        style={{ background: GLOW_GRADIENT }}
      />

      <div
        className={cn(
          "relative overflow-hidden rounded-[14px] p-[2px]",
          "transition-shadow duration-300 focus-within:ring-2 focus-within:ring-primary/50",
          isLoading && "animate-civ-glow-pulse",
        )}
      >
        <div
          aria-hidden="true"
          className={cn(
            "absolute inset-[-1000%]",
            isLoading ? "animate-civ-spin-slow" : "group-hover:animate-civ-spin-slow",
          )}
          style={{ background: GLOW_GRADIENT }}
        />

        <div className="relative flex items-center gap-1 rounded-[12px] bg-card px-2 py-[7px]">
          <IconActionButton
            icon={Paperclip}
            onClick={() => {}}
            label="Attach a file"
            bordered={false}
            size={34}
          />

          <div className="flex-1 px-1">
            <input
              value={value}
              onChange={(e) => onValueChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSend) onSend();
              }}
              disabled={isLoading}
              aria-label={placeholder}
              placeholder={placeholder}
              className="h-[42px] w-full bg-transparent text-sm text-foreground outline-none placeholder:text-text-tertiary disabled:cursor-not-allowed"
            />
          </div>

          <button
            type="button"
            onClick={canSend ? onSend : undefined}
            disabled={!canSend}
            aria-label="Send message"
            className={cn(
              "inline-flex size-[38px] shrink-0 items-center justify-center rounded-[10px] transition-all duration-200",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              canSend
                ? "bg-primary text-primary-foreground hover:bg-navy-dark active:scale-95"
                : isLoading
                  ? "bg-primary/20 text-primary"
                  : "cursor-not-allowed bg-primary/40 text-primary-foreground",
            )}
          >
            {isLoading ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="size-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/* App shell                                                           */
/* ================================================================== */

function NotificationBell({
  unread,
  onClick,
}: {
  unread: boolean;
  onClick: () => void;
}) {
  return (
    <span className="relative inline-flex">
      <IconActionButton
        icon={Bell}
        onClick={onClick}
        label="Notifications"
        bordered={false}
      />
      {unread && (
        <span className="absolute right-[6px] top-[6px] size-2 rounded-full bg-destructive ring-2 ring-card" />
      )}
    </span>
  );
}

function TopNavigationBar({
  state,
  onMenuClick,
}: {
  state: AppState;
  onMenuClick: () => void;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-card/80 backdrop-blur-md">
      <div className="flex h-[60px] items-center gap-2 px-4 sm:px-5">
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Open navigation menu"
          className="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
        >
          <Menu className="size-5" aria-hidden="true" />
        </button>
        <BrandLogo />
        <div className="flex-1" />
        <IconActionButton
          icon={Globe}
          onClick={() => {}}
          label="Language and region"
          bordered={false}
          className="hidden sm:inline-flex"
        />
        <NotificationBell unread onClick={() => {}} />
        <div className="ml-2">
          <Avatar
            initials={state.user?.initials ?? "?"}
            size={36}
            onClick={() => state.navigate("settings")}
          />
        </div>
      </div>
    </header>
  );
}

interface SidebarItemProps {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
  trailing?: ReactNode;
}

function SidebarItem({ icon: Icon, label, active, onClick, trailing }: SidebarItemProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex h-[42px] w-full items-center rounded-[9px] text-left transition-all duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "bg-lavender" : "hover:bg-muted/70",
      )}
    >
      <span
        className={cn(
          "h-[22px] w-[3.5px] rounded-r-[3px]",
          active ? "bg-primary" : "bg-transparent",
        )}
      />
      <span className="ml-2.5">
        <Icon
          className={cn("size-[19px]", active ? "text-primary" : "text-muted-foreground")}
          aria-hidden="true"
        />
      </span>
      <span
        className={cn(
          "ml-[11px] flex-1 truncate text-sm",
          active ? "font-bold text-primary" : "font-medium text-foreground",
        )}
      >
        {label}
      </span>
      {trailing}
    </div>
  );
}

function HistoryChildItem({
  title,
  active,
  onClick,
}: {
  title: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex w-full items-center gap-2 rounded-[7px] px-2.5 py-[7px] text-left transition-all duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "bg-lavender-strong" : "hover:bg-muted/70",
      )}
    >
      <FileText
        className={cn("size-[14px] shrink-0", active ? "text-primary" : "text-text-tertiary")}
        aria-hidden="true"
      />
      <span
        className={cn(
          "truncate text-xs",
          active ? "font-semibold text-primary" : "font-normal text-muted-foreground",
        )}
      >
        {title}
      </span>
    </button>
  );
}

function SidebarNavigation({
  state,
  onNavigate,
}: {
  state: AppState;
  onNavigate: (target: AppScreen) => void;
}) {
  const [cases, setCases] = useState<CaseSummary[]>([]);

  useEffect(() => {
    let mounted = true;
    mockRepos.cases().then((c) => {
      if (mounted) setCases(c);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const historyExpanded = state.historyExpanded;

  return (
    <nav
      aria-label="Primary"
      className="flex h-full w-64 shrink-0 flex-col gap-1 overflow-y-auto custom-scrollbar bg-sidebar px-3.5 py-4"
    >
      <CxButton
        className="mb-3 w-full"
        onClick={() => onNavigate("chat")}
      >
        <Plus className="size-[17px]" aria-hidden="true" />
        New Inquiry
      </CxButton>

      <SidebarItem
        icon={Home}
        label="Home"
        active={state.screen === "home"}
        onClick={() => onNavigate("home")}
      />
      <SidebarItem
        icon={Gavel}
        label="Legal Chat"
        active={state.screen === "chat"}
        onClick={() => onNavigate("chat")}
      />
      <SidebarItem
        icon={History}
        label="Case History"
        active={state.screen === "history"}
        onClick={() => onNavigate("history")}
        trailing={
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              state.setHistoryExpanded(!state.historyExpanded);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                state.setHistoryExpanded(!state.historyExpanded);
              }
            }}
            aria-label={state.historyExpanded ? "Collapse cases" : "Expand cases"}
            className="mr-2 rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {state.historyExpanded ? (
              <ChevronUp className="size-[18px]" aria-hidden="true" />
            ) : (
              <ChevronDown className="size-[18px]" aria-hidden="true" />
            )}
          </span>
        }
      />
      {historyExpanded && (
        <div className="ml-[22px] flex flex-col gap-0.5 py-0.5">
          {cases.map((c) => (
            <HistoryChildItem
              key={c.id}
              title={c.title}
              active={state.selectedCaseId === c.id && state.screen === "history"}
              onClick={() => state.openCase(c.id)}
            />
          ))}
        </div>
      )}
      <SidebarItem
        icon={BookOpen}
        label="Civil Codes"
        active={state.screen === "codes"}
        onClick={() => onNavigate("codes")}
      />
      <SidebarItem
        icon={FileSearch}
        label="Research"
        active={state.screen === "research"}
        onClick={() => onNavigate("research")}
      />
      <SidebarItem
        icon={Settings}
        label="Settings"
        active={state.screen === "settings"}
        onClick={() => onNavigate("settings")}
      />
    </nav>
  );
}

function AppShell({
  state,
  children,
}: {
  state: AppState;
  children: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const navigateAndClose = useCallback(
    (target: AppScreen) => {
      state.navigate(target);
      setMobileOpen(false);
    },
    [state],
  );

  return (
    <div className="flex h-screen flex-col bg-background">
      <TopNavigationBar state={state} onMenuClick={() => setMobileOpen(true)} />

      <div className="flex min-h-0 flex-1">
        <aside className="hidden shrink-0 border-r border-border lg:block">
          <SidebarNavigation state={state} onNavigate={navigateAndClose} />
        </aside>

        {mobileOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => setMobileOpen(false)}
              aria-hidden="true"
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Navigation menu"
              className="absolute left-0 top-0 h-full w-72 shadow-xl"
            >
              <SidebarNavigation state={state} onNavigate={navigateAndClose} />
            </div>
          </div>
        )}

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

/* ================================================================== */
/* Auth screens                                                        */
/* ================================================================== */

function AuthScaffold({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center overflow-y-auto custom-scrollbar bg-background px-4 py-10">
      <div className="w-full max-w-[430px] rounded-2xl border border-border bg-card px-6 py-9 sm:px-9">
        {children}
      </div>
    </div>
  );
}

function OrDivider() {
  return (
    <div className="my-[22px] flex items-center gap-3.5">
      <span className="h-px flex-1 bg-border" />
      <span className="text-xs text-text-tertiary">or continue with</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

function AuthErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-2.5 text-xs text-destructive">
      {message}
    </p>
  );
}

function SignInScreen({ state }: { state: AppState }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const profile = await mockRepos.signIn(email.trim(), password);
      state.onAuthenticated(profile);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign in.");
    } finally {
      setLoading(false);
    }
  }, [email, password, loading, state]);

  const googleSignIn = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const profile = await mockRepos.signInWithGoogle();
      state.onAuthenticated(profile);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign in.");
    } finally {
      setLoading(false);
    }
  }, [loading, state]);

  return (
    <AuthScaffold>
      <div className="flex flex-col items-center">
        <BrandLogo />
        <h1 className="mt-[22px] text-center text-[22px] font-bold tracking-tight text-primary">
          Welcome back
        </h1>
        <p className="mt-1.5 text-center text-sm text-muted-foreground">
          Sign in to continue to your legal workspace.
        </p>

        <div className="mt-7 w-full">
          <FieldLabel htmlFor="signin-email" text="Email Address" />
          <CxTextField
            value={email}
            onChange={setEmail}
            placeholder="you@example.com"
            leadingIcon={Mail}
            ariaLabel="Email Address"
            autoComplete="email"
            name="signin-email"
          />
          <div className="h-4" />
          <div className="flex items-center">
            <FieldLabel text="Password" />
            <button
              type="button"
              onClick={() => mockRepos.requestPasswordReset()}
              className="mb-[7px] ml-auto text-xs font-semibold text-purple transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Forgot Password?
            </button>
          </div>
          <CxTextField
            value={password}
            onChange={setPassword}
            placeholder="Enter your password"
            leadingIcon={Lock}
            type="password"
            onSubmit={submit}
            ariaLabel="Password"
            autoComplete="current-password"
            name="signin-password"
          />
          <AuthErrorText message={error} />
          <div className="mt-[22px]">
            <CxButton className="h-[46px] w-full" onClick={submit} disabled={loading}>
              {loading ? "Signing In..." : "Sign In"}
              <ArrowRight className="size-[17px]" aria-hidden="true" />
            </CxButton>
          </div>
          <OrDivider />
          <CxButton variant="outline" className="h-[46px] w-full" onClick={googleSignIn} disabled={loading}>
            <GoogleIcon className="size-4" />
            Sign in with Google
          </CxButton>
          <div className="mt-[26px] flex justify-center gap-1.5 text-sm">
            <span className="text-muted-foreground">Don&apos;t have an account?</span>
            <button
              type="button"
              onClick={() => state.navigate("signup")}
              className="font-bold text-purple transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Sign up
            </button>
          </div>
        </div>
      </div>
    </AuthScaffold>
  );
}

function SignUpScreen({ state }: { state: AppState }) {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    if (loading) return;
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const profile = await mockRepos.signUp(email.trim(), username.trim(), password);
      state.onAuthenticated(profile);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create your account.");
    } finally {
      setLoading(false);
    }
  }, [email, username, password, confirmPassword, loading, state]);

  return (
    <AuthScaffold>
      <div className="flex flex-col items-center">
        <BrandLogo />
        <h1 className="mt-[22px] text-center text-[22px] font-bold tracking-tight text-primary">
          Create your account
        </h1>
        <p className="mt-1.5 text-center text-sm text-muted-foreground">
          Start exploring the Civil Code with an AI legal assistant.
        </p>

        <div className="mt-7 w-full">
          <FieldLabel htmlFor="signup-email" text="Email Address" />
          <CxTextField
            value={email}
            onChange={setEmail}
            placeholder="you@example.com"
            leadingIcon={Mail}
            ariaLabel="Email Address"
            autoComplete="email"
            name="signup-email"
          />
          <div className="h-4" />
          <FieldLabel htmlFor="signup-username" text="Username" />
          <CxTextField
            value={username}
            onChange={setUsername}
            placeholder="Choose a username"
            leadingIcon={User}
            ariaLabel="Username"
            name="signup-username"
          />
          <div className="h-4" />
          <FieldLabel text="Password" />
          <PasswordField value={password} onChange={setPassword} placeholder="Create a password" />
          <div className="h-4" />
          <FieldLabel text="Confirm Password" />
          <CxTextField
            value={confirmPassword}
            onChange={setConfirmPassword}
            placeholder="Re-enter your password"
            leadingIcon={RefreshCw}
            type="password"
            onSubmit={submit}
            ariaLabel="Confirm Password"
            name="signup-confirm"
          />
          <AuthErrorText message={error} />
          <div className="mt-[22px]">
            <CxButton className="h-[46px] w-full" onClick={submit} disabled={loading}>
              {loading ? "Creating Account..." : "Sign Up"}
            </CxButton>
          </div>
          <OrDivider />
          <CxButton
            variant="outline"
            className="h-[46px] w-full"
            onClick={async () => {
              if (loading) return;
              setLoading(true);
              setError(null);
              try {
                const profile = await mockRepos.signInWithGoogle();
                state.onAuthenticated(profile);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Unable to sign up.");
              } finally {
                setLoading(false);
              }
            }}
            disabled={loading}
          >
            <GoogleIcon className="size-4" />
            Sign up with Google
          </CxButton>
          <div className="mt-[26px] flex justify-center gap-1.5 text-sm">
            <span className="text-muted-foreground">Already have an account?</span>
            <button
              type="button"
              onClick={() => state.navigate("signin")}
              className="font-bold text-purple transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Sign in
            </button>
          </div>
        </div>
      </div>
    </AuthScaffold>
  );
}

/* ================================================================== */
/* Home screen                                                         */
/* ================================================================== */

function ActionCard({
  icon: Icon,
  title,
  description,
  inverted = false,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  inverted?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex w-full flex-col items-start rounded-[14px] border p-5 text-left transition-all duration-200",
        "hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]",
        inverted
          ? "border-primary bg-primary"
          : "border-border bg-card hover:border-border-strong",
      )}
    >
      <span
        className={cn(
          "flex size-[42px] items-center justify-center rounded-[10px]",
          inverted ? "bg-white/15" : "bg-lavender",
        )}
      >
        <Icon
          className={cn("size-[21px]", inverted ? "text-white" : "text-primary")}
          aria-hidden="true"
        />
      </span>
      <span
        className={cn(
          "mt-3.5 text-[15px] font-semibold",
          inverted ? "text-white" : "text-foreground",
        )}
      >
        {title}
      </span>
      <span
        className={cn(
          "mt-1.5 text-xs leading-[18px]",
          inverted ? "text-white/75" : "text-muted-foreground",
        )}
      >
        {description}
      </span>
      <ArrowRight
        className={cn(
          "mt-3 size-[18px] transition-transform duration-200 group-hover:translate-x-0.5",
          inverted ? "text-white" : "text-purple",
        )}
        aria-hidden="true"
      />
    </button>
  );
}

function ActivityActionButton({ action, onClick }: { action: ActivityAction; onClick: () => void }) {
  const label = { resume: "Resume", view: "View", open: "Open" }[action];
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-border-strong px-4 py-2 text-xs font-semibold text-primary transition-all duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
    >
      {label}
    </button>
  );
}

function RecentActivityRow({
  activity,
  onAction,
}: {
  activity: RecentActivity;
  onAction: () => void;
}) {
  const config: Record<ActivityKind, { icon: LucideIcon; bg: string; tint: string }> = {
    inquiry: { icon: Gavel, bg: "bg-lavender", tint: "text-primary" },
    code: { icon: BookOpen, bg: "bg-blue-soft", tint: "text-blue-text" },
    research: { icon: FileText, bg: "bg-gold-soft", tint: "text-gold" },
  };
  const { icon: Icon, bg, tint } = config[activity.kind];

  return (
    <div className="flex w-full items-center gap-3.5 rounded-xl border border-border bg-card px-4.5 py-3.5 transition-all duration-200 hover:shadow-sm sm:px-[18px] sm:py-3.5">
      <span className={cn("flex size-[38px] shrink-0 items-center justify-center rounded-[9px]", bg)}>
        <Icon className={cn("size-[18px]", tint)} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-foreground">{activity.title}</p>
        <div className="mt-[3px] flex items-center gap-1.5">
          <Clock className="size-3 text-text-tertiary" aria-hidden="true" />
          <span className="text-xs text-text-tertiary">{activity.timestamp}</span>
        </div>
      </div>
      <PillTag text={activity.tag} className="hidden sm:inline-flex" />
      <ActivityActionButton action={activity.action} onClick={onAction} />
    </div>
  );
}

function HomeScreen({ state }: { state: AppState }) {
  const [query, setQuery] = useState("");
  const [activities, setActivities] = useState<RecentActivity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    mockRepos.recentActivity().then((a) => {
      if (mounted) {
        setActivities(a);
        setLoading(false);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const firstName = state.user?.name.split(" ")[0] ?? "Counsel";

  return (
    <div className="h-full overflow-y-auto custom-scrollbar bg-background px-4 py-6 sm:px-9 sm:py-8">
      <div className="mx-auto w-full max-w-[1080px]">
        <h1 className="text-[26px] font-bold tracking-tight text-primary">
          Good morning, {firstName}.
        </h1>
        <p className="mt-1.5 text-[15px] leading-[23px] text-muted-foreground">
          What legal question can we help you with today?
        </p>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex-1">
            <CxTextField
              value={query}
              onChange={setQuery}
              placeholder="Search civil codes, past inquiries, or ask a question..."
              leadingIcon={Search}
              height={50}
              onSubmit={() => state.navigate("chat")}
              ariaLabel="Search"
            />
          </div>
          <CxButton className="h-[50px] w-full sm:w-auto" onClick={() => state.navigate("chat")}>
            Search
          </CxButton>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-[18px]">
          <ActionCard
            icon={Gavel}
            title="Start Legal Inquiry"
            description="Chat with the AI assistant about any civil law question."
            onClick={() => state.navigate("chat")}
          />
          <ActionCard
            icon={BookOpen}
            title="Browse Civil Code"
            description="Read provisions, annotations, and cross-references."
            inverted
            onClick={() => state.navigate("codes")}
          />
          <ActionCard
            icon={FileSearch}
            title="Analyze a Document"
            description="Upload a contract and let the assistant flag issues."
            onClick={() => state.navigate("research")}
          />
        </div>

        <div className="mt-9 flex items-center">
          <h2 className="text-[19px] font-semibold text-foreground">Recent Activity</h2>
          <button
            type="button"
            onClick={() => state.navigate("history")}
            className="ml-auto text-sm font-semibold text-purple transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            View all
          </button>
        </div>

        <div className="mt-3.5 flex flex-col gap-3">
          {loading ? (
            <p aria-live="polite" className="text-sm text-text-tertiary">
              Loading recent activity...
            </p>
          ) : (
            activities.map((activity) => {
              const target: AppScreen =
                activity.kind === "inquiry"
                  ? "chat"
                  : activity.kind === "code"
                    ? "codes"
                    : "research";
              return (
                <RecentActivityRow
                  key={activity.id}
                  activity={activity}
                  onAction={() => state.navigate(target)}
                />
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/* Legal chat screen                                                   */
/* ================================================================== */

function RetrievedSourceCard({
  source,
  active,
  onFocus,
}: {
  source: RetrievedSource;
  active: boolean;
  onFocus: () => void;
}) {
  const isJurisprudence = source.category === "jurisprudence";
  return (
    <article
      id={`source-${source.id}`}
      role="button"
      tabIndex={0}
      onClick={onFocus}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onFocus();
        }
      }}
      aria-current={active ? "true" : undefined}
      className={cn(
        "w-full cursor-pointer rounded-xl border bg-card p-3.5 transition-all duration-300",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "border-primary shadow-sm ring-1 ring-primary/30"
          : "border-border hover:border-border-strong hover:shadow-sm",
      )}
    >
      <div className="flex items-center gap-2">
        <PillTag
          text={isJurisprudence ? "JURISPRUDENCE" : "STATUTORY"}
          tone={isJurisprudence ? "gold" : "lavender"}
        />
        <span className="ml-auto font-mono text-[11px] font-semibold text-green">
          {Math.round(source.score * 100)}%
        </span>
      </div>
      <h4 className="mt-2.5 text-[13px] font-semibold text-foreground">{source.title}</h4>
      <p className="mt-1.5 text-xs leading-[18px] text-muted-foreground">
        “<HighlightedText text={source.chunk} highlight={source.highlight} />”
      </p>
    </article>
  );
}

function RetrievedSourcesPanel({
  sources,
  activeId,
  onFocus,
  onClose,
}: {
  sources: RetrievedSource[];
  activeId: string | null;
  onFocus: (id: string) => void;
  onClose?: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="flex items-center gap-2 border-b border-border bg-card px-4 py-3.5">
        <BookOpen className="size-[17px] shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold text-foreground">Retrieved Sources</h3>
          <p className="truncate text-[11px] text-muted-foreground">
            BM25 + XLM-RoBERTa · FAISS Index
          </p>
        </div>
        <span className="rounded-full bg-lavender px-2 py-0.5 text-[11px] font-semibold text-primary">
          {sources.length}
        </span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sources panel"
            className="ml-1 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
          >
            <X className="size-[15px]" aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto custom-scrollbar p-4">
        {sources.map((s) => (
          <RetrievedSourceCard
            key={s.id}
            source={s}
            active={activeId === s.id}
            onFocus={() => onFocus(s.id)}
          />
        ))}
      </div>
    </div>
  );
}

function LegalChatScreen() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState<ChatMessage | null>(null);
  const [streamedText, setStreamedText] = useState("");
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mounted = true;
    mockRepos.openingMessages().then((msgs) => {
      if (mounted) setMessages(msgs);
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Reveal the pending assistant reply word-by-word, then commit it.
  useEffect(() => {
    if (!streaming) return;
    let i = 0;
    const id = window.setInterval(() => {
      i += 3;
      const next = streaming.text.slice(0, i);
      setStreamedText(next);
      if (i >= streaming.text.length) {
        window.clearInterval(id);
        setMessages((prev) => [...prev, streaming]);
        setStreaming(null);
      }
    }, 12);
    return () => window.clearInterval(id);
  }, [streaming]);

  // Pin the log to the bottom as content streams in, unless the user scrolled up.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !autoScroll) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, streamedText, sending, autoScroll]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAutoScroll(distanceFromBottom < 96);
  }, []);

  const retriever =
    streaming?.retriever ??
    [...messages].reverse().find((m) => m.role === "assistant" && m.retriever)?.retriever ??
    retrieverState;
  const sources = retriever.sources;

  const focusSource = useCallback((id: string) => {
    setActiveSourceId(id);
    setDrawerOpen(true);
    window.requestAnimationFrame(() => {
      document
        .getElementById(`source-${id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;
      setInput("");
      setMessages((prev) => [
        ...prev,
        { id: `user-${prev.length}`, role: "user", text: trimmed, timestamp: "Just now" },
      ]);
      setSending(true);
      try {
        const reply = await mockRepos.sendMessage(null, trimmed);
        setStreaming(reply);
        setStreamedText("");
      } finally {
        setSending(false);
      }
    },
    [sending],
  );

  const rerunLast = useCallback(() => {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser) void send(lastUser.text);
  }, [messages, send]);

  return (
    <div className="flex h-full">
      <section className="flex h-full min-w-0 flex-1 flex-col bg-background">
        <div className="border-b border-border bg-card">
          <div className="flex items-center gap-3 px-5 py-3.5 sm:px-7">
            <div className="min-w-0 flex-1">
              <h2 className="text-[17px] font-semibold text-foreground">Legal Chat</h2>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                AI-assisted guidance grounded in the Civil Code of the Philippines
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
            >
              <BookOpen className="size-[15px] text-primary" aria-hidden="true" />
              Sources
              <span className="rounded-full bg-lavender px-1.5 text-[10px] font-semibold text-primary">
                {sources.length}
              </span>
            </button>
            <span className="ml-1 inline-flex items-center gap-1.5 rounded-full bg-green-soft px-2.5 py-1">
              <span className="size-[7px] rounded-full bg-green" />
              <span className="text-[11px] font-semibold text-green">Assistant online</span>
            </span>
          </div>
        </div>

        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto custom-scrollbar"
          aria-live="polite"
        >
          <div className="space-y-[18px] px-5 py-5 sm:px-7">
            {messages.map((m, i) => (
              <ChatMessageItem
                key={m.id}
                message={m}
                onSuggestion={(t) => send(t)}
                showSuggestions={i === messages.length - 1 && !sending && !streaming}
                onRerun={rerunLast}
                onViewSource={focusSource}
              />
            ))}
            {streaming && (
              <AssistantBubble
                message={{ ...streaming, text: streamedText }}
                onSuggestion={() => {}}
                showSuggestions={false}
                streaming={streamedText.length < streaming.text.length}
                onRerun={rerunLast}
                onViewSource={focusSource}
              />
            )}
            {sending && <TypingIndicator />}
          </div>
        </div>

        <div className="border-t border-border bg-background px-5 pb-5 pt-3 sm:px-7">
          <ChatInputBar
            value={input}
            onValueChange={setInput}
            onSend={() => send(input)}
            enabled={!sending}
          />
        </div>
      </section>

      <div className="hidden w-[340px] shrink-0 border-l border-border bg-sidebar transition-all duration-300 lg:flex xl:w-[360px]">
        <RetrievedSourcesPanel
          sources={sources}
          activeId={activeSourceId}
          onFocus={focusSource}
        />
      </div>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/40 transition-opacity duration-300"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute inset-y-0 right-0 flex w-[320px] max-w-[85vw] bg-sidebar shadow-xl">
            <RetrievedSourcesPanel
              sources={sources}
              activeId={activeSourceId}
              onFocus={focusSource}
              onClose={() => setDrawerOpen(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/* Case history screen                                                 */
/* ================================================================== */

function CaseListRow({ kase, onOpen }: { kase: CaseSummary; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3.5 rounded-xl border border-border bg-card px-4.5 py-[15px] text-left transition-all duration-200 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.995] sm:px-[18px]"
    >
      <span className="flex size-[38px] shrink-0 items-center justify-center rounded-[9px] bg-lavender">
        <Folder className="size-[18px] text-primary" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-foreground">
          {kase.title}
        </span>
        <span className="mt-[3px] block truncate text-xs text-text-tertiary">
          {kase.referenceId} · {kase.lastActive}
        </span>
      </span>
      <span className="hidden items-center gap-1.5 md:flex">
        {kase.tags.map((tag) => (
          <PillTag key={tag} text={tag} />
        ))}
      </span>
      <ChevronRight className="size-[18px] shrink-0 text-text-tertiary" aria-hidden="true" />
    </button>
  );
}

function CaseListView({ state }: { state: AppState }) {
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    mockRepos.cases().then((c) => {
      if (mounted) {
        setCases(c);
        setLoading(false);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="h-full overflow-y-auto custom-scrollbar bg-background px-4 py-7 sm:px-9">
      <div className="mx-auto w-full max-w-[980px]">
        <h1 className="text-[22px] font-bold tracking-tight text-primary">Case History</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review, resume, or export your past legal inquiries.
        </p>
        <div className="mt-5 flex flex-col gap-3">
          {loading ? (
            <p aria-live="polite" className="text-sm text-text-tertiary">
              Loading cases...
            </p>
          ) : (
            cases.map((kase) => (
              <CaseListRow key={kase.id} kase={kase} onOpen={() => state.openCase(kase.id)} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function CaseDetailView({ state, caseId }: { state: AppState; caseId: string }) {
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    mockRepos.caseDetail(caseId).then((d) => {
      if (mounted) {
        setDetail(d ?? null);
        setLoading(false);
      }
    });
    return () => {
      mounted = false;
    };
  }, [caseId]);

  if (loading || !detail) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <p className="text-sm text-text-tertiary">
          {loading ? "Loading case..." : "Case not found."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="border-b border-border bg-card">
        <div className="px-5 py-4 sm:px-7">
          <button
            type="button"
            onClick={state.closeCase}
            className="inline-flex items-center gap-[7px] text-xs font-semibold text-purple transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="size-[15px]" aria-hidden="true" />
            Back to History
          </button>
          <div className="mt-2.5 flex items-center gap-2">
            <h2 className="min-w-0 flex-1 truncate text-[19px] font-semibold text-foreground">
              {detail.summary.title}
            </h2>
            <IconActionButton icon={Download} onClick={() => {}} label="Download transcript" />
            <IconActionButton icon={Share2} onClick={() => {}} label="Share transcript" />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <PillTag text={detail.summary.referenceId} tone="blue" />
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="size-[13px] text-text-tertiary" aria-hidden="true" />
              Last active: {detail.summary.lastActive}
            </span>
            {detail.summary.tags.map((tag) => (
              <PillTag key={tag} text={tag} />
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-[18px] overflow-y-auto custom-scrollbar px-5 py-[22px] sm:px-7">
        {detail.messages.map((m) => (
          <ChatMessageItem key={m.id} message={m} showSuggestions={false} />
        ))}
      </div>

      <footer className="flex flex-col gap-3 border-t border-border bg-card px-5 py-3.5 sm:flex-row sm:items-center sm:px-7">
        <div className="flex items-center gap-2">
          <History className="size-[15px] shrink-0 text-text-tertiary" aria-hidden="true" />
          <p className="text-xs text-muted-foreground">
            This is a saved transcript. Continue the inquiry to ask follow-up questions.
          </p>
        </div>
        <CxButton className="h-[38px] sm:ml-auto" onClick={() => state.navigate("chat")}>
          Continue this inquiry
        </CxButton>
      </footer>
    </div>
  );
}

function CaseHistoryScreen({ state }: { state: AppState }) {
  const caseId = state.selectedCaseId;
  return caseId ? (
    <CaseDetailView key={caseId} state={state} caseId={caseId} />
  ) : (
    <CaseListView state={state} />
  );
}

/* ================================================================== */
/* Civil codes screen                                                  */
/* ================================================================== */

function BookNode({
  book,
  expanded,
  onToggle,
  selectedChapterId,
  onSelectChapter,
  filter,
}: {
  book: CodeBook;
  expanded: boolean;
  onToggle: () => void;
  selectedChapterId: string;
  onSelectChapter: (id: string) => void;
  filter: string;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-[7px] rounded-md px-2 py-2 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {expanded ? (
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-foreground">{book.name}</span>
          <span className="block truncate text-[11px] text-text-tertiary">{book.subtitle}</span>
        </span>
      </button>

      {expanded &&
        book.titles.map((title) => {
          const q = filter.trim().toLowerCase();
          const visibleChapters = title.chapters.filter(
            (ch) =>
              !q ||
              ch.name.toLowerCase().includes(q) ||
              title.name.toLowerCase().includes(q) ||
              ch.articleRange.toLowerCase().includes(q),
          );
          if (visibleChapters.length === 0) return null;
          return (
            <div key={title.id}>
              <p className="px-[30px] pb-[3px] pt-1.5 text-[11px] font-semibold text-muted-foreground">
                {title.name}
              </p>
              {visibleChapters.map((chapter) => {
                const active = chapter.id === selectedChapterId;
                return (
                  <button
                    key={chapter.id}
                    type="button"
                    onClick={() => onSelectChapter(chapter.id)}
                    aria-current={active ? "true" : undefined}
                    className={cn(
                      "ml-[26px] flex w-[calc(100%-26px)] items-start rounded-[7px] px-2 py-[7px] text-left transition-all duration-200",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active ? "bg-lavender" : "hover:bg-muted/60",
                    )}
                  >
                    <span className="min-w-0">
                      <span
                        className={cn(
                          "block truncate text-xs",
                          active ? "font-semibold text-primary" : "font-normal text-muted-foreground",
                        )}
                      >
                        {chapter.name}
                      </span>
                      <span className="block text-[11px] text-text-tertiary">
                        {chapter.articleRange}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
    </div>
  );
}

function TableOfContents({
  books,
  query,
  onQueryChange,
  expandedBooks,
  onToggleBook,
  selectedChapterId,
  onSelectChapter,
}: {
  books: CodeBook[];
  query: string;
  onQueryChange: (q: string) => void;
  expandedBooks: Record<string, boolean>;
  onToggleBook: (id: string) => void;
  selectedChapterId: string;
  onSelectChapter: (id: string) => void;
}) {
  return (
    <aside className="flex h-full w-[288px] shrink-0 flex-col gap-3.5 border-r border-border bg-sidebar p-3.5">
      <h2 className="text-[15px] font-semibold text-foreground">Table of Contents</h2>
      <CxTextField
        value={query}
        onChange={onQueryChange}
        placeholder="Search provisions..."
        leadingIcon={Search}
        height={40}
        ariaLabel="Search provisions"
      />
      <nav aria-label="Civil code contents" className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
        <div className="flex flex-col gap-1">
          {books.map((book) => (
            <BookNode
              key={book.id}
              book={book}
              expanded={!!expandedBooks[book.id]}
              onToggle={() => onToggleBook(book.id)}
              selectedChapterId={selectedChapterId}
              onSelectChapter={onSelectChapter}
              filter={query}
            />
          ))}
        </div>
      </nav>
    </aside>
  );
}

function JurisprudenceCard({ kase }: { kase: JurisprudenceCase }) {
  return (
    <article className="w-full rounded-xl border border-border bg-card p-[18px]">
      <div className="flex items-center gap-2">
        <h4 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">
          {kase.name}
        </h4>
        <PillTag text={kase.year} tone="gold" />
      </div>
      <p className="mt-[3px] text-[11px] text-text-tertiary">{kase.grNumber}</p>
      <p className="mt-2 text-xs leading-[18px] text-muted-foreground">{kase.summary}</p>
      <div className="mt-3 flex items-center gap-4">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-purple transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <FileSearch className="size-[14px]" aria-hidden="true" />
          Read Analysis
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ExternalLink className="size-[14px]" aria-hidden="true" />
          Source Document
        </button>
      </div>
    </article>
  );
}

function ArticleContent({
  article,
  jurisprudenceList,
}: {
  article: Article | null;
  jurisprudenceList: JurisprudenceCase[];
}) {
  if (!article) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <p className="text-sm text-text-tertiary">Select a chapter to read its provisions.</p>
      </div>
    );
  }

  return (
    <section className="h-full overflow-y-auto custom-scrollbar bg-background px-4 py-6 sm:px-8">
      <div className="mx-auto w-full max-w-[900px]">
        <div className="flex items-center gap-1">
          <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1">
            {article.breadcrumb.map((crumb, index) => {
              const isLast = index === article.breadcrumb.length - 1;
              return (
                <span key={crumb} className="flex items-center">
                  {index > 0 && (
                    <ChevronRight className="mx-1 size-[14px] text-text-tertiary" aria-hidden="true" />
                  )}
                  <span
                    className={cn(
                      "text-xs",
                      isLast ? "font-semibold text-primary" : "font-normal text-muted-foreground",
                    )}
                  >
                    {crumb}
                  </span>
                </span>
              );
            })}
          </nav>
          <div className="ml-auto flex gap-2">
            <IconActionButton icon={Bookmark} onClick={() => {}} label="Bookmark article" />
            <IconActionButton icon={Share2} onClick={() => {}} label="Share article" />
          </div>
        </div>

        <article className="mt-[18px] rounded-[14px] border border-border bg-card p-6">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-[19px] font-semibold text-primary">{article.number}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">{article.heading}</p>
            </div>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-full bg-lavender px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-lavender-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Pencil className="size-3" aria-hidden="true" />
              {article.annotations} Annotations
            </button>
          </div>
          <p className="mt-4 text-[15px] leading-[23px] text-foreground">{article.body}</p>

          <h3 className="mt-5 text-xs font-semibold text-muted-foreground">Cross-references</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {article.crossReferences.map((ref) => (
              <button
                key={ref}
                type="button"
                className="rounded-lg border border-border-strong px-3 py-1.5 text-xs font-semibold text-primary transition-all duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {ref}
              </button>
            ))}
          </div>
        </article>

        <div className="mt-[26px] flex items-center gap-2">
          <Gavel className="size-[17px] text-gold" aria-hidden="true" />
          <h3 className="text-[15px] font-semibold text-foreground">Related Jurisprudence</h3>
        </div>
        <div className="mt-3 flex flex-col gap-3">
          {jurisprudenceList.map((kase) => (
            <JurisprudenceCard key={kase.id} kase={kase} />
          ))}
        </div>
      </div>
    </section>
  );
}

function CivilCodesScreen() {
  const [books, setBooks] = useState<CodeBook[]>([]);
  const [expandedBooks, setExpandedBooks] = useState<Record<string, boolean>>({});
  const [selectedChapterId, setSelectedChapterId] = useState("b1-t1-c1");
  const [article, setArticle] = useState<Article | null>(null);
  const [jurisprudenceList, setJurisprudenceList] = useState<JurisprudenceCase[]>([]);
  const [tocQuery, setTocQuery] = useState("");

  useEffect(() => {
    let mounted = true;
    mockRepos.tableOfContents().then((b) => {
      if (mounted) {
        setBooks(b);
        const expanded: Record<string, boolean> = {};
        b.forEach((book) => {
          expanded[book.id] = book.id === "book1";
        });
        setExpandedBooks(expanded);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    mockRepos.article(selectedChapterId).then((a) => {
      if (!mounted) return;
      setArticle(a ?? null);
      if (a) {
        mockRepos.relatedJurisprudence(a.id).then((j) => {
          if (mounted) setJurisprudenceList(j);
        });
      } else {
        setJurisprudenceList([]);
      }
    });
    return () => {
      mounted = false;
    };
  }, [selectedChapterId]);

  const toggleBook = useCallback((id: string) => {
    setExpandedBooks((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  return (
    <div className="flex h-full">
      <TableOfContents
        books={books}
        query={tocQuery}
        onQueryChange={setTocQuery}
        expandedBooks={expandedBooks}
        onToggleBook={toggleBook}
        selectedChapterId={selectedChapterId}
        onSelectChapter={setSelectedChapterId}
      />
      <div className="min-w-0 flex-1">
        <ArticleContent article={article} jurisprudenceList={jurisprudenceList} />
      </div>
    </div>
  );
}

/* ================================================================== */
/* Research screen                                                     */
/* ================================================================== */

function DocumentViewer({
  document,
  issues,
}: {
  document: ResearchDocument | null;
  issues: FlaggedIssue[];
}) {
  return (
    <section className="flex h-full flex-col bg-card">
      <div className="border-b border-border">
        <div className="flex items-center gap-2.5 px-[22px] py-3.5">
          <FileText className="size-[18px] shrink-0 text-primary" aria-hidden="true" />
          <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-foreground">
            {document?.title ?? "Loading document..."}
          </h2>
          {document?.ocrComplete && (
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-green-soft px-2.5 py-1">
              <CircleCheck className="size-3 text-green" aria-hidden="true" />
              <span className="text-[11px] font-semibold text-green">OCR Complete</span>
            </span>
          )}
          <IconActionButton icon={Pencil} onClick={() => {}} label="Edit document" className="hidden sm:inline-flex" />
          <IconActionButton icon={Download} onClick={() => {}} label="Download document" className="hidden sm:inline-flex" />
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-[14px] overflow-y-auto custom-scrollbar px-[26px] py-5">
        {document?.sections.map((section, i) => {
          if (section.flagged) {
            return (
              <div
                key={i}
                className="rounded-lg border border-destructive/35 bg-destructive-soft/55 p-3"
              >
                <div className="flex items-center gap-1.5">
                  <TriangleAlert className="size-[13px] text-destructive" aria-hidden="true" />
                  <span className="text-[11px] font-bold text-destructive">
                    [FLAGGED SECTION]
                  </span>
                </div>
                <p className="mt-[7px] whitespace-pre-line text-sm leading-[21px] text-foreground">
                  {section.text}
                </p>
                {section.flagNote && (
                  <p className="mt-[7px] text-xs leading-[18px] text-destructive">
                    {section.flagNote}
                  </p>
                )}
              </div>
            );
          }
          return (
            <p key={i} className="whitespace-pre-line text-sm leading-[21px] text-foreground">
              {section.text}
            </p>
          );
        })}
      </div>

      {issues.length > 0 && (
        <div className="mx-[22px] mb-3.5 rounded-xl border border-gold/40 bg-gold-soft p-3.5">
          <div className="flex items-center gap-2">
            <TriangleAlert className="size-[15px] text-gold" aria-hidden="true" />
            <h3 className="text-[13px] font-semibold text-foreground">
              Flagged Issues ({issues.length})
            </h3>
          </div>
          <ul className="mt-2 space-y-1.5">
            {issues.map((issue) => (
              <li key={issue.title} className="flex gap-[7px]">
                <span className="font-bold text-gold">•</span>
                <div>
                  <p className="text-xs font-semibold text-foreground">{issue.title}</p>
                  <p className="text-xs text-muted-foreground">{issue.description}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function ResearchScreen() {
  const [document, setDocument] = useState<ResearchDocument | null>(null);
  const [issues, setIssues] = useState<FlaggedIssue[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mounted = true;
    mockRepos.activeDocument().then((doc) => {
      if (!mounted) return;
      setDocument(doc);
      mockRepos.flaggedIssues().then((iss) => {
        if (mounted) setIssues(iss);
      });
      setMessages([
        {
          id: "doc-hello",
          role: "assistant",
          text: `I've finished reading "${doc.title}". Two clauses appear to conflict with the Civil Code — see the flagged sections on the left. Ask me anything about this document.`,
          timestamp: "Just now",
        },
      ]);
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, sending]);

  const ask = useCallback(
    async (text: string) => {
      if (!document || !text.trim() || sending) return;
      const trimmed = text.trim();
      setInput("");
      setMessages((prev) => [
        ...prev,
        { id: `doc-user-${prev.length}`, role: "user", text: trimmed, timestamp: "Just now" },
      ]);
      setSending(true);
      try {
        const reply = await mockRepos.askAssistant(document.id, trimmed);
        setMessages((prev) => [...prev, reply]);
      } finally {
        setSending(false);
      }
    },
    [document, sending],
  );

  return (
    <div className="flex h-full">
      <div className="hidden min-w-0 flex-1 md:block lg:flex-[0.58]">
        <DocumentViewer document={document} issues={issues} />
      </div>

      <section className="flex h-full min-w-0 flex-1 flex-col border-l border-border bg-background lg:flex-[0.42]">
        <div className="border-b border-border bg-card">
          <div className="flex items-center gap-2.5 px-[18px] py-[15px]">
            <AssistantAvatar size={30} />
            <div>
              <h2 className="text-[15px] font-semibold text-foreground">Legal Assistant</h2>
              <p className="text-[11px] text-muted-foreground">
                Answers grounded in this document
              </p>
            </div>
          </div>
        </div>

        <div
          className="flex-1 space-y-[14px] overflow-y-auto custom-scrollbar px-[18px] py-4"
          aria-live="polite"
        >
          {messages.map((m) => (
            <ChatMessageItem key={m.id} message={m} showSuggestions={false} />
          ))}
          {sending && <TypingIndicator />}
          <div ref={bottomRef} />
        </div>

        <div className="px-[18px]">
          <div className="flex flex-wrap gap-2 pb-2.5">
            {researchSuggestions.map((s) => (
              <SuggestionChip key={s} text={s} onClick={() => ask(s)} />
            ))}
          </div>
        </div>

        <div className="px-[18px] pb-4">
          <ChatInputBar
            value={input}
            onValueChange={setInput}
            onSend={() => ask(input)}
            placeholder="Ask about this document..."
            enabled={!sending}
          />
        </div>
      </section>
    </div>
  );
}

/* ================================================================== */
/* Settings screen                                                     */
/* ================================================================== */

function SettingsCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="w-full rounded-[14px] border border-border bg-card p-[22px]">
      <h3 className="text-[15px] font-semibold text-primary">{title}</h3>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function PreferenceRow({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3.5 py-2.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-[9px] bg-lavender">
        <Icon className="size-[17px] text-primary" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

function NavigationRow({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-3.5 py-2.5 text-left transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-[9px] bg-lavender">
        <Icon className="size-[17px] text-primary" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold text-foreground">{title}</span>
        <span className="block text-xs text-muted-foreground">{subtitle}</span>
      </span>
      <ChevronRight className="size-[18px] text-text-tertiary" aria-hidden="true" />
    </button>
  );
}

function RowDivider() {
  return <div className="my-0.5 h-px w-full bg-border" />;
}

function SettingsScreen({ state }: { state: AppState }) {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState(false);

  useTheme(settings?.theme ?? "light");

  useEffect(() => {
    let mounted = true;
    mockRepos.settings().then((s) => {
      if (mounted) {
        setSettings(s);
        setName(s.name);
        setEmail(s.email);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const update = useCallback((transform: (s: UserSettings) => UserSettings) => {
    setSettings((current) => {
      if (!current) return current;
      const next = transform(current);
      mockRepos.updatePreferences(next);
      return next;
    });
  }, []);

  const saveProfile = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setSavedNote(false);
    try {
      const updated = await mockRepos.updateProfile(name.trim(), email.trim());
      setSettings(updated);
      setSavedNote(true);
    } catch {
      /* error surfaced via disabled state in production wiring */
    } finally {
      setSaving(false);
    }
  }, [name, email, saving]);

  if (!settings) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <p className="text-sm text-text-tertiary">Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto custom-scrollbar bg-background px-4 py-7 sm:px-9">
      <div className="mx-auto w-full max-w-[780px]">
        <h1 className="text-[22px] font-bold tracking-tight text-primary">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your profile, preferences, and account security.
        </p>

        <div className="mt-[22px] flex flex-col gap-[18px]">
          <SettingsCard title="Personal Profile">
            <div className="flex items-center gap-5">
              <div className="relative">
                <span className="flex size-16 items-center justify-center rounded-full bg-primary text-[22px] font-bold text-primary-foreground">
                  {state.user?.initials ?? "RD"}
                </span>
                <button
                  type="button"
                  aria-label="Edit avatar"
                  className="absolute bottom-0 right-0 flex size-[22px] items-center justify-center rounded-full border-2 border-card bg-purple text-primary-foreground transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Pencil className="size-2.5" aria-hidden="true" />
                </button>
              </div>
              <div className="min-w-0">
                <p className="text-[15px] font-semibold text-foreground">{settings.name}</p>
                <p className="truncate text-xs text-muted-foreground">{settings.email}</p>
              </div>
            </div>

            <div className="mt-[18px]">
              <FieldLabelSmall text="Full Name" />
              <CxTextField
                value={name}
                onChange={setName}
                placeholder="Your name"
                leadingIcon={User}
                ariaLabel="Full Name"
              />
              <div className="h-3" />
              <FieldLabelSmall text="Email Address" />
              <CxTextField
                value={email}
                onChange={setEmail}
                placeholder="you@example.com"
                leadingIcon={Mail}
                ariaLabel="Email Address"
              />
              <div className="mt-4 flex items-center gap-3">
                <CxButton onClick={saveProfile} disabled={saving}>
                  {saving ? "Saving..." : "Save Changes"}
                </CxButton>
                {savedNote && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-green" role="status">
                    <CircleCheck className="size-[15px]" aria-hidden="true" />
                    Profile updated
                  </span>
                )}
              </div>
            </div>
          </SettingsCard>

          <SettingsCard title="Application Preferences">
            <PreferenceRow
              icon={Sun}
              title="Theme"
              subtitle="Choose how CIVIL-LEX looks on this device"
            >
              <SegmentedControl
                options={[
                  { label: "Light", icon: Sun },
                  { label: "Dark", icon: Moon },
                  { label: "System", icon: Monitor },
                ]}
                selectedIndex={["light", "dark", "system"].indexOf(settings.theme)}
                onSelect={(index) =>
                  update((s) => ({ ...s, theme: (["light", "dark", "system"] as ThemeMode[])[index] }))
                }
              />
            </PreferenceRow>
            <RowDivider />
            <PreferenceRow
              icon={Bell}
              title="Email Notifications"
              subtitle="Case updates and weekly legal digests"
            >
              <CxSwitch
                checked={settings.emailNotifications}
                onCheckedChange={(checked) => update((s) => ({ ...s, emailNotifications: checked }))}
                label="Email notifications"
              />
            </PreferenceRow>
            <RowDivider />
            <PreferenceRow
              icon={Globe}
              title="Regional Settings"
              subtitle="Language and jurisdiction"
            >
              <button
                type="button"
                className="inline-flex items-center gap-[7px] rounded-[9px] border border-border-strong px-3 py-2 text-xs text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {settings.region}
                <ChevronDown className="size-[15px] text-muted-foreground" aria-hidden="true" />
              </button>
            </PreferenceRow>
          </SettingsCard>

          <SettingsCard title="Security">
            <NavigationRow
              icon={KeyRound}
              title="Change Password"
              subtitle="Last changed 3 months ago"
            />
            <RowDivider />
            <PreferenceRow
              icon={Shield}
              title="Two-Factor Authentication"
              subtitle="Add an extra layer of security"
            >
              <CxSwitch
                checked={settings.twoFactorEnabled}
                onCheckedChange={(checked) => update((s) => ({ ...s, twoFactorEnabled: checked }))}
                label="Two-factor authentication"
              />
            </PreferenceRow>
            <RowDivider />
            <NavigationRow
              icon={History}
              title="Active Sessions"
              subtitle="Review devices signed in to your account"
            />
          </SettingsCard>

          <SettingsCard title="Account Management">
            <NavigationRow
              icon={Download}
              title="Export My Data"
              subtitle="Download all inquiries and documents"
            />
            <RowDivider />
            <NavigationRow
              icon={FileText}
              title="Terms & Privacy Policy"
              subtitle="Read how we handle your information"
            />
            <button
              type="button"
              className="mt-4 flex w-full items-center gap-2 rounded-[10px] border-[1.5px] border-destructive px-4 py-[11px] text-sm font-semibold text-destructive transition-colors hover:bg-destructive-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Trash2 className="size-4" aria-hidden="true" />
              Delete Account
            </button>
            <p className="mt-1.5 text-xs text-text-tertiary">
              Permanently removes your account and all associated data. This cannot be undone.
            </p>
          </SettingsCard>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/* Root app                                                            */
/* ================================================================== */

function CivilexApp() {
  const state = useAppState();

  if (state.screen === "signin") {
    return <SignInScreen state={state} />;
  }
  if (state.screen === "signup") {
    return <SignUpScreen state={state} />;
  }

  return (
    <AppShell state={state}>
      {state.screen === "home" && <HomeScreen state={state} />}
      {state.screen === "chat" && <LegalChatScreen />}
      {state.screen === "history" && <CaseHistoryScreen state={state} />}
      {state.screen === "codes" && <CivilCodesScreen />}
      {state.screen === "research" && <ResearchScreen />}
      {state.screen === "settings" && <SettingsScreen state={state} />}
    </AppShell>
  );
}

export default CivilexApp;
