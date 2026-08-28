"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  Grid3X3,
  HelpCircle,
  Home,
  Image as ImageIcon,
  Menu,
  Minus,
  PanelLeftClose,
  Bell,
  Plus,
  Settings,
  Sparkles,
  Star,
  Trash2,
  UploadCloud,
  Users,
  X,
} from "lucide-react";
import { mapAnswers } from "@/lib/mapping";
import { answerSchema, questionSchema, type MappedQuestion } from "@/lib/types";

type Stage = "upload" | "processing" | "results";
type UploadedDoc = { file: File; pages: string[]; pageCount?: number } | null;

async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;
  }
  return pdfjs;
}

async function makeDoc(file: File): Promise<UploadedDoc> {
  if (file.type === "application/pdf") {
    try {
      const pdfjs = await loadPdfjs();
      const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
      if (!doc.numPages) throw new Error("Empty PDF");
      return { file, pages: [], pageCount: doc.numPages };
    } catch {
      throw new Error("This PDF could not be read. Please upload a valid PDF.");
    }
  }
  try { await createImageBitmap(file); } catch { throw new Error("This image could not be read. Please upload a valid JPG or PNG."); }
  return { file, pages: [URL.createObjectURL(file)], pageCount: 1 };
}

/* ───────────────────── SVG ICONS ───────────────────── */

function VedaLogo({ size = 30 }: { size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/vedaai-logo.avif"
      alt="VedaAI"
      width={size}
      height={size}
      className="brand-img"
      style={{ width: size, height: size }}
    />
  );
}

function SparkleIconLarge() {
  return (
    <svg width="90" height="90" viewBox="0 0 90 90" fill="none">
      <path d="M52 10 L56 28 L74 24 L58 36 L74 48 L56 44 L52 62 L48 44 L30 48 L46 36 L30 24 L48 28 Z" fill="#ff5623" />
      <circle cx="34" cy="34" r="4" fill="#ff5623" opacity="0.6" />
      <path d="M64 52 L66 58 L72 56 L66 60 L68 66 L64 62 L60 66 L62 60 L56 56 L62 58 Z" fill="#ff5623" opacity="0.45" />
      <circle cx="62" cy="62" r="2.5" fill="#ff5623" opacity="0.35" />
    </svg>
  );
}

function TeacherPortrait() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="teacher-portrait"
      src="/teacher-portrait.png"
      alt="AI Teacher Assistant"
      width={78}
      height={78}
    />
  );
}

function PdfIcon() {
  return (
    <div className="pdf-icon">
      <svg width="22" height="26" viewBox="0 0 22 26" fill="none">
        <rect x="1" y="1" width="20" height="24" rx="2" fill="white" fillOpacity="0.25" stroke="white" strokeWidth="1.5" />
        <text x="11" y="16" textAnchor="middle" fill="white" fontSize="7" fontWeight="800" fontFamily="DM Sans">PDF</text>
      </svg>
    </div>
  );
}

function CustomImageIcon() {
  return (
    <div className="pdf-icon" style={{ background: "#d8d8d8" }}>
      <svg width="22" height="26" viewBox="0 0 22 26" fill="none">
        <rect x="1" y="1" width="20" height="24" rx="2" fill="white" fillOpacity="0.25" stroke="white" strokeWidth="1.5" />
        <text x="11" y="16" textAnchor="middle" fill="white" fontSize="7" fontWeight="800" fontFamily="DM Sans">IMG</text>
      </svg>
    </div>
  );
}

/* ───────────────────── SIDEBAR ───────────────────── */

function Sidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const navItems = [
    { icon: Grid3X3, label: "Home" },
    { icon: Users, label: "My Classroom" },
    { icon: FileText, label: "Assignments" },
    { icon: BookOpen, label: "Exams", active: true },
    { icon: Clock, label: "My Library" },
  ];
  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="sidebar-header">
        <div className="brand">
          <VedaLogo size={32} />
          {!collapsed && <span className="brand-text">VedaAI</span>}
        </div>
        {!collapsed && (
          <button className="sidebar-toggle" onClick={onToggle} aria-label="Collapse sidebar">
            <PanelLeftClose size={18} />
          </button>
        )}
      </div>

      <div className="nav-section">
        {collapsed ? (
          <button className="nav-pill-collapsed" title="AI Teacher's Toolkit">
            <Sparkles size={22} />
          </button>
        ) : (
          <button className="nav-pill">
            <Sparkles size={20} />
            <span>AI Teacher&apos;s Toolkit</span>
          </button>
        )}
      </div>

      <nav className="nav-section" style={{ marginTop: collapsed ? 16 : 8 }}>
        {navItems.map(({ icon: Icon, label, active }) => (
          <button
            key={label}
            className={`nav-item ${active ? "active" : ""} ${collapsed ? "collapsed-item" : ""}`}
            title={label}
          >
            <Icon size={20} />
            {!collapsed && <span>{label}</span>}
          </button>
        ))}
      </nav>

      <div className="sidebar-spacer" />

      {!collapsed && (
        <button className="nav-item" style={{ marginBottom: 16 }}>
          <Settings size={20} />
          <span>Settings</span>
        </button>
      )}

      <div className={`school-card ${collapsed ? "collapsed-school" : ""}`}>
        <div className="school-logo" style={{ background: "white", padding: 2, borderRadius: "50%" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/dps-logo.png"
            alt="Delhi Public School"
            width={52}
            height={52}
            className="school-logo-img"
            style={{ borderRadius: "50%" }}
          />
        </div>
        {!collapsed && (
          <div className="school-info">
            <b>Delhi Public School</b>
            <small>Bokaro Steel City</small>
          </div>
        )}
      </div>

      {collapsed && (
        <button className="sidebar-expand-btn" onClick={onToggle} aria-label="Expand sidebar">
          <ChevronRight size={18} />
        </button>
      )}
    </aside>
  );
}

/* ───────────────────── HEADER ───────────────────── */

function Header({ onBack }: { onBack?: () => void }) {
  return (
    <header className="header">
      <div className="header-left">
        <button className="header-back" onClick={onBack} aria-label="Go back">
          <ArrowLeft size={18} />
        </button>
        <div className="header-breadcrumb">
          <FileText size={16} />
          <span>Exams</span>
        </div>
      </div>
      <div className="header-right">
        <button className="header-icon" aria-label="Help">
          <HelpCircle size={18} />
        </button>
        <button className="header-icon" aria-label="Notifications">
          <Bell size={18} />
          <span className="notif-dot" />
        </button>
        <button className="header-icon" aria-label="Star">
          <Star size={18} />
        </button>
        <button className="header-user">
          <div className="header-avatar" style={{
            background: "linear-gradient(135deg, #f0d9c8, #e2c4b0)",
            display: "grid", placeItems: "center", overflow: "hidden",
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8b6f5c" strokeWidth="2">
              <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 4-7 8-7s8 3 8 7" />
            </svg>
          </div>
          <span className="header-username">Madhur Rastogi</span>
          <ChevronDown size={14} style={{ color: "var(--ink-muted)" }} />
        </button>
      </div>
    </header>
  );
}

/* ───────────────────── MOBILE HEADER ───────────────────── */

function MobileHeader({ onBack }: { onBack?: () => void }) {
  return (
    <div className="mobile-header-wrapper">
      <header className="mobile-header mobile-header-card">
        <div className="mobile-header-left">
          <button className="mobile-header-btn" onClick={onBack} aria-label="Go back">
            <ArrowLeft size={18} color="var(--ink)" />
          </button>
          <div className="brand" style={{ gap: 6 }}>
            <VedaLogo size={22} />
            <span className="brand-text" style={{ fontSize: 16, fontWeight: 700 }}>VedaAI</span>
          </div>
        </div>
        <div className="mobile-header-right">
          <button className="mobile-header-icon" aria-label="Notifications">
            <Bell size={18} color="var(--ink)" />
            <span className="notif-dot" />
          </button>
          <div className="mobile-header-avatar">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#8b6f5c" strokeWidth="2">
              <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 4-7 8-7s8 3 8 7" />
            </svg>
          </div>
          <button className="mobile-header-btn" aria-label="Menu">
            <Menu size={18} color="var(--ink)" />
          </button>
        </div>
      </header>
    </div>
  );
}

/* ───────────────────── UPLOAD CARD ───────────────────── */

function UploadCard({
  label,
  keyword,
  doc,
  onUpload,
  onRemove,
}: {
  label: string;
  keyword: string;
  doc: UploadedDoc;
  onUpload: (file: File) => Promise<void>;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const allowed = ["application/pdf", "image/png", "image/jpeg", "image/jpg"];
      if (!allowed.includes(file.type)) return alert("Please upload a PDF, JPG, or PNG file.");
      if (file.size > 10 * 1024 * 1024) return alert("File must be 10 MB or smaller.");
      try { await onUpload(file); } catch (error) { alert(error instanceof Error ? error.message : "This file could not be read."); }
      e.target.value = "";
    },
    [onUpload]
  );

  return (
    <div className={`upload-card ${doc ? "has-file" : ""}`}>
      {doc && (
        <button className="filled-remove" onClick={onRemove} aria-label="Remove file">
          <X size={12} />
        </button>
      )}
      <input ref={inputRef} type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={handleChange} />
      {doc ? (
        <div className="filled-file" onClick={() => inputRef.current?.click()}>
          {doc.file.type.includes("pdf") ? <PdfIcon /> : <CustomImageIcon />}
          <div className="filled-meta">
            <b>{doc.file.name}</b>
            <small>
              {(doc.file.size / 1024 / 1024).toFixed(0)}MB
              {(doc.pageCount ?? doc.pages.length) > 1 ? ` • ${doc.pageCount ?? doc.pages.length} Pages` : ""}
            </small>
          </div>
        </div>
      ) : (
        <div onClick={() => inputRef.current?.click()} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%" }}>
          <div className="upload-icon-wrap" style={{ background: "#f0f0f0" }}>
            <UploadCloud size={24} color="#333" />
          </div>
          <div className="upload-card-label">
            Upload <span className="hl">{keyword}</span>
          </div>
          <div className="upload-card-sub" style={{ color: "#aaa" }}>Max 10MB</div>
        </div>
      )}
    </div>
  );
}

/* ───────────────────── UPLOAD SCREEN ───────────────────── */

function UploadScreen({
  paper,
  answers,
  setPaper,
  setAnswers,
  onStart,
}: {
  paper: UploadedDoc;
  answers: UploadedDoc;
  setPaper: (d: UploadedDoc) => void;
  setAnswers: (d: UploadedDoc) => void;
  onStart: () => void;
}) {
  return (
    <div className="upload-page">
      <div className="upload-hero">
        <h1 className="serif">
          Upload <span className="accent">Question Paper &amp; Answer Sheets</span>
        </h1>
        <p>Upload both files to get started</p>
      </div>

      <div className="upload-avatar">
        <div className="upload-avatar-ring">
          <div className="upload-avatar-inner">
            <TeacherPortrait />
          </div>
          <span className="avatar-dot" style={{ top: 8, right: 18 }} />
          <span className="avatar-dot" style={{ top: 28, right: 2 }} />
          <span className="avatar-dot" style={{ bottom: 28, right: 8 }} />
          <span className="avatar-dot" style={{ bottom: 12, left: 24 }} />
        </div>
      </div>

      <div className="upload-cards">
        <UploadCard
          label="Question Paper"
          keyword="Question Paper"
          doc={paper}
          onUpload={async (f) => {
            if (answers?.file.name === f.name && answers.file.size === f.size) throw new Error("Upload different files for the question paper and answer sheet.");
            setPaper(await makeDoc(f));
          }}
          onRemove={() => setPaper(null)}
        />
        <UploadCard
          label="Answer Sheet"
          keyword="Answer Sheet"
          doc={answers}
          onUpload={async (f) => {
            if (paper?.file.name === f.name && paper.file.size === f.size) throw new Error("Upload different files for the question paper and answer sheet.");
            setAnswers(await makeDoc(f));
          }}
          onRemove={() => setAnswers(null)}
        />
      </div>

      <button className="start-btn" disabled={!paper || !answers} onClick={onStart}>
        Start Mapping <ArrowRight size={16} />
      </button>
      <p className="upload-footer">
        <Sparkles size={12} style={{ display: "inline", verticalAlign: -1, marginRight: 4 }} />
        Once both files are uploaded, you&apos;ll able to map answers with questions
      </p>
    </div>
  );
}

/* ───────────────────── PROCESSING SCREEN ───────────────────── */

function ProcessingScreen() {
  return (
    <div className="processing-page">
      <div className="processing-card">
        <div className="sparkle-icon">
          <SparkleIconLarge />
        </div>
        <h2 className="serif" style={{ fontSize: 30, fontWeight: 700, marginTop: 12 }}>
          Extracting<span className="dots" />
        </h2>
        <p className="sub" style={{ fontSize: 15, color: "var(--ink-muted)", marginTop: 6 }}>
          This may take a while
        </p>
      </div>
    </div>
  );
}

/* ───────────────────── PDF PAGE RENDERER ───────────────────── */

function PdfPageCanvas({ file, page }: { file: File; page: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const pdfjs = await loadPdfjs();
        const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
        const pdfPage = await doc.getPage(Math.min(Math.max(1, page), doc.numPages));
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        const vp = pdfPage.getViewport({ scale: 1.8 });
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        canvas.width = vp.width;
        canvas.height = vp.height;
        await pdfPage.render({ canvasContext: ctx, viewport: vp }).promise;
      } catch {
        /* unreadable PDF — mock paper shows instead */
      }
    })();
    return () => { cancelled = true; };
  }, [file, page]);
  return <canvas ref={canvasRef} />;
}

/* ───────────────────── ANSWER SHEET VIEWER ───────────────────── */

function AnswerViewer({
  doc,
  selectedQuestion,
  zoom,
  setZoom,
}: {
  doc: UploadedDoc;
  selectedQuestion: MappedQuestion | null;
  zoom: number;
  setZoom: (v: number) => void;
}) {
  const regions = selectedQuestion?.answer?.regions ?? [];
  const region = regions[0];
  const maxRegionPage = regions.reduce((m, r) => Math.max(m, r.page), 0);
  const totalPages = Math.max(1, doc?.pages.length || doc?.pageCount || maxRegionPage || 4);
  const initialPage = region ? Math.min(region.page, totalPages) : 1;
  const [page, setPage] = useState(initialPage);
  const [regionIndex, setRegionIndex] = useState(0);

  useEffect(() => {
    setRegionIndex(0);
    if (region) setPage(Math.min(region.page, totalPages));
  }, [selectedQuestion?.id, region, totalPages]);

  const activeRegion = regions[regionIndex] ?? region;
  const showRegion = (nextIndex: number) => {
    const next = regions[nextIndex];
    if (!next) return;
    setRegionIndex(nextIndex);
    if (next.page <= totalPages) setPage(next.page);
  };

  const isPdf = doc?.file.type === "application/pdf";

  return (
    <div className="viewer-panel">
      <div className="viewer-toolbar">
        <span className="viewer-toolbar-title">Answer Sheet</span>
        <div className="viewer-toolbar-right">
          <div className="zoom-controls">
            <button className="zoom-btn" onClick={() => setZoom(Math.max(0.5, zoom - 0.1))}>
              <Minus size={14} />
            </button>
            <span className="zoom-val">{Math.round(zoom * 100)}%</span>
            <button className="zoom-btn" onClick={() => setZoom(Math.min(2, zoom + 0.1))}>
              <Plus size={14} />
            </button>
          </div>
          <div className="page-nav">
            <button className="page-nav-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft size={14} />
            </button>
            <span>Page {page} of {totalPages}</span>
            <button className="page-nav-btn" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>

      <div className="viewer-canvas">
        <div className="paper-wrapper" style={{ transform: `scale(${zoom})` }}>
          <div className="paper-page">
            {isPdf && doc ? (
              <PdfPageCanvas file={doc.file} page={page} />
            ) : doc?.pages[page - 1] ? (
              <img src={doc.pages[page - 1]} alt={`Answer sheet page ${page}`} />
            ) : (
              <div className="notebook-paper">
                <div className="notebook-header-line" />
                <div className="notebook-content">
                  <p style={{ color: "#1e3a8a", fontFamily: "cursive", fontSize: 16, lineHeight: 2.2 }}>
                    <b>Q1.</b> Photosynthesis is the process used by green plants and some other organisms to convert light energy into chemical energy.
                  </p>
                  <div style={{ margin: "20px 0", padding: "12px", border: "1.5px solid #1e3a8a", textAlign: "center", fontFamily: "cursive", color: "#1e3a8a" }}>
                    6CO₂ + 6H₂O ───(Light / Chlorophyll)───&gt; C₆H₁₂O₆ + 6O₂
                  </div>
                  <p style={{ color: "#1e3a8a", fontFamily: "cursive", fontSize: 16, lineHeight: 2.2 }}>
                    <b>Q2.</b> The process mainly occurs in the chloroplast of the plant cell. It has two main stages:
                    <br />1. Light reaction — Captures light energy.
                    <br />2. Dark reaction — Uses energy to make glucose.
                  </p>
                </div>
              </div>
            )}

            {activeRegion && activeRegion.page === page && activeRegion.page <= totalPages && (
              <div
                className="answer-highlight"
                style={{
                  left: `${activeRegion.bbox[0] * 100}%`,
                  top: `${activeRegion.bbox[1] * 100}%`,
                  width: `${(activeRegion.bbox[2] - activeRegion.bbox[0]) * 100}%`,
                  height: `${(activeRegion.bbox[3] - activeRegion.bbox[1]) * 100}%`,
                }}
              >
                <span className="answer-highlight-label">
                  Q{selectedQuestion?.number ?? ""}{regions.length > 1 ? ` · ${regionIndex + 1}/${regions.length}` : ""}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
      {regions.length > 1 && (
        <div className="region-nav" aria-label="Answer continuation navigation">
          <button disabled={regionIndex <= 0} onClick={() => showRegion(regionIndex - 1)}><ChevronLeft size={13} /> Previous region</button>
          <span>Answer continues across {regions.length} regions</span>
          <button disabled={regionIndex >= regions.length - 1} onClick={() => showRegion(regionIndex + 1)}>Next region <ChevronRight size={13} /></button>
        </div>
      )}
    </div>
  );
}

/* ───────────────────── QUESTION CARD ───────────────────── */

function QuestionCard({
  q,
  isSelected,
  isExpanded,
  onToggleExpand,
  onSelect,
}: {
  q: MappedQuestion;
  isSelected: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onSelect: () => void;
}) {
  const statusClass = q.status === "answered" ? "full" : q.status === "uncertain" ? "partial" : "zero";
  const scoreLabel = q.status === "answered" ? "Mapped" : q.status === "uncertain" ? "Review" : "Unanswered";

  // Parse question number: match sub-questions like "11(a)" or "11a" but NOT plain "11"
  const subMatch =
    /^(\d+)\s*[.\s]*\(?([a-zA-Z])\)?$/.exec(q.number ?? "") ||
    /^(\d+)\s*[.\s]*\(?([a-zA-Z])\)?/.exec(q.originalLabel ?? "");
  // Only treat as sub-question if the matched number differs from a pure digit-only check
  // i.e. "11(a)" → mainNum="11", subPart="a"
  // "21" → no subMatch (just a 2-digit number with no letter)
  const isSubQuestion = subMatch != null && /[a-zA-Z]/.test(subMatch[2]);
  const visibleLabel = q.originalLabel || q.number;
  const mainNum = isSubQuestion ? subMatch![1] : visibleLabel.replace(/\.$/, "");
  const subPart = isSubQuestion ? subMatch![2].toLowerCase() : null;

  return (
    <div className={`q-card ${isSelected ? "selected" : ""}`}>
      <div className="q-card-top" onClick={onSelect}>
        <div className="q-number-badge">
          <div className="q-number-circle">{mainNum}</div>
          {subPart && <div className="q-sub-circle">{subPart}.</div>}
        </div>
        <div className="q-card-body">
          <div className="q-card-text">{q.text || `Question ${q.number}`}</div>
          {q.marks != null && <div className="q-max-marks">Maximum marks: {q.marks}</div>}
        </div>
        <div className="q-card-right">
          <span className={`score-pill ${statusClass}`}>{scoreLabel}</span>
          <button className={`q-expand-icon ${isExpanded ? "open" : ""}`} onClick={(e) => { e.stopPropagation(); onToggleExpand(); }}>
            <ChevronDown size={18} />
          </button>
        </div>
      </div>
      {isExpanded && (
        <div className="q-feedback">
          <div className="q-feedback-label">Mapping Details</div>
          <div className="q-feedback-text">
            {q.answer?.text ? (
              q.status === "answered"
                ? `Answer ${q.answer.originalLabel || q.answer.questionNumber || "record"} was matched by its explicit question label. Awarded marks require an answer key or teacher rubric.`
                : "This answer was inferred from incomplete numbering. Please review the mapping before grading."
            ) : (
              "No matching answer was found for this question."
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────────────────── RESULTS SCREEN ───────────────────── */

function ResultsScreen({
  questions,
  doc,
  unmatchedCount = 0,
  onBack,
}: {
  questions: MappedQuestion[];
  doc: UploadedDoc;
  unmatchedCount?: number;
  onBack?: () => void;
}) {
  const [selectedId, setSelectedId] = useState(questions[0]?.id ?? "");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set([questions[1]?.id ?? "q2", questions[5]?.id ?? "q6"]));
  const [zoom, setZoom] = useState(1);
  const [mobileTab, setMobileTab] = useState<"questions" | "answers">("questions");

  const selected = useMemo(
    () => questions.find((q) => q.id === selectedId) ?? questions[0] ?? null,
    [questions, selectedId]
  );

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setExpandedIds(new Set(questions.map((q) => q.id)));
  }, [questions]);

  return (
    <div className="results-page">
      <div className="mobile-only-header">
        <div className="mobile-tabs mobile-tabs-container">
          <div className="mobile-tabs-pill">
            <button
              className={`mobile-tab mobile-tab-btn ${mobileTab === "questions" ? "active" : ""}`}
              onClick={() => setMobileTab("questions")}
            >
              Questions
            </button>
            <button
              className={`mobile-tab mobile-tab-btn ${mobileTab === "answers" ? "active" : ""}`}
              onClick={() => setMobileTab("answers")}
            >
              Answer Sheet
            </button>
          </div>
        </div>
      </div>

      <div className="results-body">
        <div className={`questions-panel ${mobileTab === "answers" ? "mobile-hidden" : ""}`}>
          <div className="questions-header">
            <div>
              <h3>Extracted Questions <span className="questions-heading-detail">(from question paper)</span></h3>
              {unmatchedCount > 0 && <small className="unmatched-note">{unmatchedCount} answer{unmatchedCount === 1 ? "" : "s"} could not be mapped</small>}
            </div>
            <button className="expand-all-btn" onClick={expandAll}>Expand All</button>
          </div>
          <div className="questions-list">
            {questions.map((q) => (
              <QuestionCard
                key={q.id}
                q={q}
                isSelected={selected?.id === q.id}
                isExpanded={expandedIds.has(q.id)}
                onToggleExpand={() => toggleExpand(q.id)}
                onSelect={() => {
                  setSelectedId(q.id);
                  setMobileTab("answers");
                }}
              />
            ))}
          </div>
        </div>

        <div className={`viewer-container ${mobileTab === "questions" ? "mobile-hidden" : ""}`}>
          <AnswerViewer doc={doc} selectedQuestion={selected} zoom={zoom} setZoom={setZoom} />
        </div>
      </div>
    </div>
  );
}

/* ───────────────────── DEMO DATA ───────────────────── */

const DEMO_QUESTIONS = questionSchema.array().parse([
  { id: "q1", number: "1", text: "Which blood vessel carries blood away from the heart?", page: 1, marks: 2 },
  { id: "q2", number: "2", text: "Which of the following organelles is primarily involved in photosynthesis?", page: 1, marks: 2 },
  { id: "q3", number: "3", text: "Explain the role of chloroplasts in photosynthesis, naming the main pigments involved and briefly outlining the two major stages of the process.", page: 1, marks: 2 },
  { id: "q4", number: "4", text: "Describe the flow of blood through the human heart starting from the right atrium and ending at the aorta; include the names of valves crossed.", page: 1, marks: 2 },
  { id: "q5", number: "5", text: "Draw a labelled diagram of an alveolus showing capillaries and air space (label alveolar sac, capillary, and direction of gas exchange).", page: 2, marks: 2 },
  { id: "q6", number: "6", text: "Draw a neat labelled diagram of the human digestive system (stomach, small intestine, large intestine, liver, pancreas) and label the site where most absorption occurs.", page: 2, marks: 5 },
  { id: "q7", number: "7", text: "Draw and label a nephron (Bowman's capsule, glomerulus, proximal tubule, loop of Henle, distal tubule, collecting duct).", page: 2, marks: 5 },
  { id: "q8", number: "8", text: "Explain the structural differences between palisade mesophyll and spongy mesophyll and state how each structure aids its function in the leaf.", page: 3, marks: 5 },
  { id: "q9", number: "9", text: "Describe the process of transpiration in plants in two to three sentences and name two environmental factors that increase its rate.", page: 3, marks: 2 },
  { id: "q10", number: "10", text: "Explain how the structure of xylem vessels facilitates water transport in plants (mention one structural feature and its role).", page: 3, marks: 5 },
  { id: "q11a", number: "11a", text: "A diagram shows two potted plants — Plant A in bright light with broad green leaves, Plant B kept in dim light with pale, elongated leaves.", page: 3, marks: 2 },
  { id: "q11b", number: "11b", text: "Suggest one practical measure to help Plant B recover.", page: 3, marks: 3 },
  { id: "q12", number: "12", text: "A resting person has tidal volume (air per breath) of 0.5 L and breathes 12 times per minute.", page: 4, marks: 5 },
  { id: "q13", number: "13", text: "If dead space is 0.15 L per breath, calculate the alveolar ventilation per minute. Show working.", page: 4, marks: 5 },
]);

const DEMO_ANSWERS = answerSchema.array().parse([
  { id: "a2", questionNumber: "2", text: "The chloroplast is the organelle primarily involved in photosynthesis. It contains chlorophyll which captures light energy.", regions: [{ page: 1, bbox: [0.04, 0.44, 0.96, 0.58] }], confidence: 0.95 },
  { id: "a1", questionNumber: "1", text: "The artery carries blood away from the heart.", regions: [{ page: 1, bbox: [0.04, 0.08, 0.96, 0.22] }], confidence: 0.92 },
  { id: "a3", questionNumber: "3", text: "Chloroplasts contain chlorophyll which captures light energy. The two major stages are light reaction and dark reaction.", regions: [{ page: 1, bbox: [0.04, 0.60, 0.96, 0.76] }, { page: 2, bbox: [0.04, 0.08, 0.96, 0.18] }], confidence: 0.88 },
  { id: "a5", questionNumber: "5", text: "Diagram of alveolus with capillaries.", regions: [{ page: 2, bbox: [0.04, 0.20, 0.96, 0.60] }], confidence: 0.85 },
  { id: "a4", questionNumber: "4", text: "Blood flows from right atrium through tricuspid valve to right ventricle, then through pulmonary valve to pulmonary artery.", regions: [{ page: 2, bbox: [0.04, 0.65, 0.96, 0.92] }], confidence: 0.82 },
  { id: "a7", questionNumber: "7", text: "Labelled diagram of nephron.", regions: [{ page: 3, bbox: [0.04, 0.10, 0.96, 0.45] }], confidence: 0.9 },
  { id: "a6", questionNumber: "6", text: "Diagram of digestive system with labels.", regions: [{ page: 3, bbox: [0.04, 0.50, 0.96, 0.88] }], confidence: 0.87 },
  { id: "a9", questionNumber: "9", text: "Transpiration is the loss of water vapour from plant leaves. Factors: temperature and wind speed.", regions: [{ page: 4, bbox: [0.04, 0.08, 0.96, 0.25] }], confidence: 0.91 },
  { id: "a8", questionNumber: "8", text: "Palisade mesophyll has tightly packed columnar cells for maximum light absorption. Spongy mesophyll has loosely packed cells with air spaces for gas exchange.", regions: [{ page: 4, bbox: [0.04, 0.28, 0.96, 0.50] }], confidence: 0.86 },
  { id: "a10", questionNumber: "10", text: "Xylem vessels have lignified walls that provide structural support and prevent collapse under tension during water transport.", regions: [{ page: 4, bbox: [0.04, 0.52, 0.96, 0.70] }], confidence: 0.89 },
  { id: "a11a", questionNumber: "11a", text: "Plant A has broad green leaves adapted for maximum light capture. Plant B has pale elongated leaves due to insufficient light.", regions: [{ page: 4, bbox: [0.04, 0.72, 0.96, 0.85] }], confidence: 0.84 },
  { id: "a11b", questionNumber: "11b", text: "Move Plant B to a brighter location to allow chlorophyll production to resume.", regions: [{ page: 4, bbox: [0.04, 0.86, 0.96, 0.96] }], confidence: 0.8 },
  { id: "a12", questionNumber: "12", text: "Tidal volume = 0.5L, Breaths = 12/min, Total ventilation = 0.5 x 12 = 6 L/min.", regions: [{ page: 1, bbox: [0.04, 0.1, 0.96, 0.5] }], confidence: 0.93 },
  { id: "a13", questionNumber: "13", text: "Alveolar ventilation = (Tidal volume - Dead space) x Respiratory rate = (0.5 - 0.15) x 12 = 4.2 L/min.", regions: [{ page: 1, bbox: [0.04, 0.52, 0.96, 0.95] }], confidence: 0.91 },
]);

/* ───────────────────── MAIN WORKSPACE ───────────────────── */

/* ───────────────────── ERROR POPUP / MODAL ───────────────────── */

function ApiErrorModal({ error, onClose }: { error: string; onClose: () => void }) {
  const [showDetails, setShowDetails] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyDetails = () => {
    navigator.clipboard.writeText(error);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="error-modal-overlay" onClick={onClose}>
      <div className="error-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="error-modal-header">
          <div className="error-modal-title-wrap">
            <span className="error-modal-icon">⚠️</span>
            <h3>AI Extraction Error</h3>
          </div>
          <button className="error-modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        
        <div className="error-modal-body">
          <p className="error-modal-msg">
            We couldn't confidently process these documents with the AI models. Please try again with clearer scans or check your API keys.
          </p>

          <div className="error-modal-actions">
            <button className="error-details-btn" onClick={() => setShowDetails(!showDetails)}>
              {showDetails ? "Hide Error Details ▲" : "View Error Details ▼"}
            </button>
            {showDetails && (
              <button className="error-copy-btn" onClick={copyDetails}>
                {copied ? "Copied! ✓" : "Copy Error Details"}
              </button>
            )}
          </div>

          {showDetails && (
            <div className="error-modal-details-wrap">
              <pre className="error-modal-details">{error}</pre>
            </div>
          )}
        </div>

        <div className="error-modal-footer">
          <button className="error-modal-btn primary" onClick={onClose}>
            Dismiss & Try Again
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────── MAIN WORKSPACE ───────────────────── */

export function AssessmentWorkspace() {
  const [stage, setStage] = useState<Stage>("upload");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [paper, setPaper] = useState<UploadedDoc>(null);
  const [answers, setAnswers] = useState<UploadedDoc>(null);
  const [error, setError] = useState("");
  const [mapped, setMapped] = useState<MappedQuestion[]>([]);
  const [unmatchedCount, setUnmatchedCount] = useState(0);

  // Sidebar is collapsed when user manually collapsed it, OR on processing/results screens
  // But on results screen, clicking the expand chevron re-opens it
  const isCollapsed = sidebarCollapsed;

  const handleBack = useCallback(() => {
    setStage("upload");
    setSidebarCollapsed(false);
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => !prev);
  }, []);

  const startMapping = useCallback(async () => {
    if (!paper || !answers) return;
    setError("");
    setStage("processing");
    const startedAt = Date.now();

    try {
      const form = new FormData();
      form.append("paper", paper.file);
      form.append("answers", answers.file);
      const res = await fetch("/api/extract", { method: "POST", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Extraction failed");
      }
      const result = await res.json();
      const output = mapAnswers(result.questions, result.answers);
      setMapped(output.mapped);
      setUnmatchedCount(output.unmatched.length);
      
      const elapsed = Date.now() - startedAt;
      if (elapsed < 2000) await new Promise((r) => setTimeout(r, 2000 - elapsed));
      setStage("results");
    } catch (err) {
      const elapsed = Date.now() - startedAt;
      if (elapsed < 1600) await new Promise((r) => setTimeout(r, 1600 - elapsed));
      setError(err instanceof Error ? err.message : "Something went wrong");
      setStage("upload");
    }
  }, [paper, answers]);

  const useDemo = useCallback(() => {
    const output = mapAnswers(DEMO_QUESTIONS, DEMO_ANSWERS);
    setMapped(output.mapped);
    setUnmatchedCount(output.unmatched.length);
    setStage("results");
  }, []);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("demo") === "1") useDemo();
  }, [useDemo]);

  // Auto-collapse sidebar when leaving upload screen, auto-expand when returning
  useEffect(() => {
    setSidebarCollapsed(stage !== "upload");
  }, [stage]);

  return (
    <div className="app-shell">
      <Sidebar collapsed={isCollapsed} onToggle={toggleSidebar} />

      <div className={`main-content ${isCollapsed ? "collapsed-main" : ""}`}>
        {/* Desktop header — always visible */}
        <div className="desktop-header-wrapper">
          <Header onBack={stage !== "upload" ? handleBack : undefined} />
        </div>

        {/* Mobile floating header — upload screen only */}
        <div className="mobile-header-top">
          <MobileHeader onBack={stage !== "upload" ? handleBack : undefined} />
        </div>

        <div className="content-area">
          {stage === "upload" && (
            <UploadScreen
              paper={paper}
              answers={answers}
              setPaper={setPaper}
              setAnswers={setAnswers}
              onStart={startMapping}
            />
          )}

          {stage === "processing" && <ProcessingScreen />}

          {stage === "results" && (
            <ResultsScreen
              questions={mapped}
              doc={answers}
              unmatchedCount={unmatchedCount}
              onBack={handleBack}
            />
          )}
        </div>
      </div>

      {error && <ApiErrorModal error={error} onClose={() => setError("")} />}
    </div>
  );
}
