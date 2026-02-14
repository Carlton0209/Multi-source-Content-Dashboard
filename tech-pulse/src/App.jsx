import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Tech Pulse — Multi-Source Content Dashboard (SPA)
 * UI matches the uploaded mock (sidebar + top search + kanban-like columns).
 *
 * APIs (2+ public APIs, 3 enabled by default):
 * - Hacker News (Algolia)  ✅ no key
 * - Reddit public JSON     ✅ no key
 * - NASA APOD              ✅ DEMO_KEY
 * Optional addable column:
 * - Quotable               ✅ no key
 */

// ---------------------------
// Meta + utils
// ---------------------------

const SOURCE_META = {
  hn: { name: "Hacker News", subtitle: "Top Stories", badge: "Y", badgeBg: "#ff6600" },
  reddit: { name: "Reddit", subtitle: "r/startups + r/technology", badge: "r", badgeBg: "#FF4500" },
  nasa: { name: "NASA", subtitle: "Astronomy Picture of the Day", badge: "N", badgeBg: "#137fec" },
  quote: { name: "Quotes", subtitle: "Daily Inspiration", badge: "Q", badgeBg: "#8b5cf6" },
};

function isoToDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatRelative(d) {
  if (!d) return "";
  const ms = Date.now() - d.getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}

function hostFromUrl(u) {
  try {
    return new URL(u).host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function clampText(s, max = 180) {
  if (!s) return "";
  const t = String(s).replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

function safeUrl(u) {
  try {
    return new URL(u).toString();
  } catch {
    return "";
  }
}

function formatScore(n) {
  if (typeof n !== "number") return "0";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

// ---------------------------
// API clients
// ---------------------------

async function fetchHN({ query, page, daysBack, signal }) {
  const base = "https://hn.algolia.com/api/v1/search_by_date";
  const params = new URLSearchParams();
  params.set("tags", "story");
  params.set("hitsPerPage", "20");
  params.set("page", String(page));
  if (query && query.trim()) params.set("query", query.trim());

  if (daysBack !== "all") {
    const nowSec = Math.floor(Date.now() / 1000);
    const backSec =
      daysBack === "24h" ? 24 * 3600 : daysBack === "7d" ? 7 * 24 * 3600 : 30 * 24 * 3600;
    const minSec = nowSec - backSec;
    params.set("numericFilters", `created_at_i>${minSec}`);
  }

  const res = await fetch(`${base}?${params.toString()}`, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HN request failed (${res.status})`);
  const data = await res.json();

  const items = (data.hits || []).map((h) => {
    const url = safeUrl(h.url || (h.objectID ? `https://news.ycombinator.com/item?id=${h.objectID}` : ""));
    return {
      id: `hn_${h.objectID}`,
      source: "hn",
      title: h.title || "(Untitled)",
      url,
      date: isoToDate(h.created_at),
      summary: clampText(h.story_text || "", 140),
      score: typeof h.points === "number" ? h.points : 0,
      comments: typeof h.num_comments === "number" ? h.num_comments : 0,
      author: h.author || "",
      host: hostFromUrl(url),
    };
  });

  const hasMore = typeof data.nbPages === "number" ? page + 1 < data.nbPages : false;
  return { items, nextPage: page + 1, hasMore };
}

async function fetchReddit({ query, after, signal }) {
  const base = "https://www.reddit.com/r/technology+startups/hot.json";
  const params = new URLSearchParams();
  params.set("limit", "15");
  params.set("raw_json", "1");
  if (after) params.set("after", after);

  const res = await fetch(`${base}?${params.toString()}`, {
    signal,
    headers: {
      Accept: "application/json",
      "User-Agent": "TechPulseDashboard/1.0 (portfolio project)",
    },
  });
  if (!res.ok) throw new Error(`Reddit request failed (${res.status})`);
  const data = await res.json();

  const children = data?.data?.children || [];
  let mapped = children
    .map((c) => c?.data)
    .filter(Boolean)
    .map((p) => {
      const url = safeUrl(p.url_overridden_by_dest || (p.permalink ? `https://www.reddit.com${p.permalink}` : ""));
      const thumb = safeUrl((p.preview?.images?.[0]?.source?.url || "").replace(/&amp;/g, "&"));
      return {
        id: `rd_${p.id}`,
        source: "reddit",
        title: p.title || "(Untitled)",
        url,
        date: typeof p.created_utc === "number" ? new Date(p.created_utc * 1000) : null,
        summary: clampText(p.selftext || "", 160),
        score: typeof p.ups === "number" ? p.ups : 0,
        comments: typeof p.num_comments === "number" ? p.num_comments : 0,
        author: p.author || "",
        subreddit: p.subreddit_name_prefixed || "",
        imageUrl: thumb || "",
        host: hostFromUrl(url),
      };
    });

  const q = (query || "").trim().toLowerCase();
  if (q) {
    mapped = mapped.filter((it) => `${it.title} ${it.summary} ${it.subreddit}`.toLowerCase().includes(q));
  }

  const nextAfter = data?.data?.after || null;
  return { items: mapped, nextAfter, hasMore: Boolean(nextAfter) };
}

async function fetchNASA({ signal }) {
  const base = "https://api.nasa.gov/planetary/apod";
  const params = new URLSearchParams({ api_key: import.meta.env.VITE_NASA_API_KEY || "McO1EuGGc6maPIowuhkdYGWxkJsYQgozNVAkRvYR" });
  const res = await fetch(`${base}?${params.toString()}`, { signal });
  if (!res.ok) throw new Error(`NASA APOD request failed (${res.status})`);
  const d = await res.json();

  const url = safeUrl(d.url || "");
  const hd = safeUrl(d.hdurl || "");
  const bestImage = d.media_type === "image" ? hd || url : "";

  return {
    items: [
      {
        id: `nasa_${d.date || "apod"}`,
        source: "nasa",
        title: d.title || "Astronomy Picture of the Day",
        url: url || "https://apod.nasa.gov/",
        date: d.date ? isoToDate(`${d.date}T00:00:00Z`) : null,
        summary: clampText(d.explanation || "", 240),
        author: d.copyright || "NASA",
        imageUrl: bestImage,
        score: 0,
        comments: 0,
        host: "api.nasa.gov",
      },
    ],
    hasMore: false,
  };
}

async function fetchQuote({ signal }) {
  const res = await fetch("https://api.quotable.io/random", { signal });
  if (!res.ok) throw new Error(`Quote request failed (${res.status})`);
  const q = await res.json();
  return {
    items: [
      {
        id: `quote_${q._id}`,
        source: "quote",
        title: q.author ? `Quote by ${q.author}` : "Quote",
        url: "",
        date: q.dateAdded ? isoToDate(q.dateAdded) : null,
        summary: `“${q.content}”`,
        author: q.author || "",
        host: "quotable.io",
        tags: Array.isArray(q.tags) ? q.tags : [],
        score: 0,
        comments: 0,
      },
    ],
    hasMore: false,
  };
}

// ---------------------------
// UI pieces
// ---------------------------

function Icon({ name, className = "" }) {
  const common = "w-5 h-5";
  if (name === "columns")
    return (
      <svg className={`${common} ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="4" width="7" height="16" rx="1" />
        <rect x="14" y="4" width="7" height="16" rx="1" />
      </svg>
    );
  if (name === "trend")
    return (
      <svg className={`${common} ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 17l6-6 4 4 7-7" />
        <path d="M14 8h6v6" />
      </svg>
    );
  if (name === "bookmark")
    return (
      <svg className={`${common} ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
      </svg>
    );
  if (name === "bell")
    return (
      <svg className={`${common} ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M18 8a6 6 0 10-12 0c0 7-3 7-3 7h18s-3 0-3-7" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
    );
  if (name === "settings")
    return (
      <svg className={`${common} ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 15.5A3.5 3.5 0 1 0 12 8.5a3.5 3.5 0 0 0 0 7z" />
        <path d="M19.4 15a7.8 7.8 0 0 0 .1-1l2-1.5-2-3.5-2.4.5a7.5 7.5 0 0 0-1.7-1L15 4h-6l-.4 2.5a7.5 7.5 0 0 0-1.7 1L4.5 7 2.5 10.5 4.5 12a7.8 7.8 0 0 0 0 2L2.5 15.5 4.5 19l2.4-.5a7.5 7.5 0 0 0 1.7 1L9 22h6l.4-2.5a7.5 7.5 0 0 0 1.7-1l2.4.5 2-3.5-2-1.5z" />
      </svg>
    );
  if (name === "search")
    return (
      <svg className={`${common} ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" />
      </svg>
    );
  if (name === "refresh")
    return (
      <svg className={`${common} ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 12a9 9 0 1 1-3-6.7" />
        <path d="M21 3v6h-6" />
      </svg>
    );
  if (name === "add")
    return (
      <svg className={`${common} ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </svg>
    );
  return null;
}

function Tooltip({ label }) {
  return (
    <span className="pointer-events-none absolute left-14 z-50 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
      {label}
    </span>
  );
}

function ErrorBanner({ title, message, onDismiss }) {
  return (
    <div className="rounded-xl border border-red-400/30 bg-red-500/10 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-red-200">{title}</div>
          <div className="mt-1 text-xs text-red-100/80">{message}</div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-lg px-2 py-1 text-xs text-red-100/80 hover:bg-red-500/10"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function ColumnItem({ item, index }) {
  if (item.source === "nasa") {
    return (
      <article className="cursor-pointer rounded-lg border border-white/5 bg-[#202c3a] p-3 transition-colors hover:bg-[#253341]">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-sm font-bold text-[#137fec]">{index + 1}.</span>
          <div className="min-w-0 flex-1">
            <h3 className="line-clamp-2 text-sm font-semibold text-slate-100">
              <a className="hover:text-[#137fec]" href={item.url} target="_blank" rel="noreferrer">
                {item.title}
              </a>
            </h3>
            {item.imageUrl ? (
              <div className="mt-2 overflow-hidden rounded-lg border border-white/10">
                <img src={item.imageUrl} alt={item.title} className="h-28 w-full object-cover" loading="lazy" />
              </div>
            ) : null}
            <p className="mt-2 line-clamp-3 text-xs text-slate-300/80">{item.summary}</p>
            <div className="mt-2 text-[11px] text-slate-400">
              {item.date ? formatRelative(item.date) : ""}{item.author ? ` • ${item.author}` : ""}
            </div>
          </div>
        </div>
      </article>
    );
  }

  if (item.source === "quote") {
    return (
      <article className="rounded-lg border border-white/5 bg-[#202c3a] p-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-sm font-bold text-[#137fec]">{index + 1}.</span>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-slate-100">{item.title}</h3>
            <p className="mt-2 text-xs text-slate-300/90">{item.summary}</p>
            <div className="mt-2 text-[11px] text-slate-400">
              {item.author ? `— ${item.author}` : ""}
              {item.date ? ` • ${formatRelative(item.date)}` : ""}
            </div>
          </div>
        </div>
      </article>
    );
  }

  if (item.source === "reddit") {
    return (
      <article className="group cursor-pointer rounded-lg border border-white/5 bg-[#202c3a] p-3 transition-colors hover:bg-[#253341]">
        <div className="flex gap-3">
          <div className="flex min-w-[26px] flex-col items-center gap-1 pt-1">
            <span className="text-xs font-bold text-slate-200/90">{formatScore(item.score)}</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2">
              {item.subreddit ? (
                <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-bold text-slate-100">
                  {item.subreddit}
                </span>
              ) : null}
              {item.date ? <span className="text-[10px] text-slate-400">{formatRelative(item.date)}</span> : null}
            </div>
            <h3 className="mb-2 line-clamp-2 text-sm font-medium text-slate-100 group-hover:text-[#137fec]">
              <a href={item.url} target="_blank" rel="noreferrer">
                {item.title}
              </a>
            </h3>
            {item.imageUrl ? (
              <div className="relative mb-2 h-28 w-full overflow-hidden rounded-lg">
                <img src={item.imageUrl} alt={item.title} className="h-full w-full object-cover" loading="lazy" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
              </div>
            ) : item.summary ? (
              <p className="mb-2 line-clamp-3 text-xs text-slate-300/70">{item.summary}</p>
            ) : null}
            <div className="flex items-center gap-3 text-xs text-slate-400">
              <span>{item.comments ?? 0} comments</span>
              {item.author ? <span>by {item.author}</span> : null}
            </div>
          </div>
        </div>
      </article>
    );
  }

  // HN default
  return (
    <article className="group cursor-pointer rounded-lg border border-white/5 bg-[#202c3a] p-3 transition-colors hover:bg-[#253341]">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-sm font-bold text-[#137fec]">{index + 1}.</span>
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-sm font-medium text-slate-100 group-hover:text-[#137fec]">
            <a href={item.url} target="_blank" rel="noreferrer">
              {item.title}
            </a>
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span className="flex items-center gap-1">↑ {formatScore(item.score)}</span>
            <span>•</span>
            <span>{item.comments ?? 0} comments</span>
            {item.host ? (
              <>
                <span>•</span>
                <span>{item.host}</span>
              </>
            ) : null}
          </div>
          <div className="mt-1 text-xs text-slate-400">
            {item.date ? formatRelative(item.date) : ""}
            {item.author ? (
              <>
                {" "}by <span className="text-slate-200/80">{item.author}</span>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

function ColumnShell({ col, items, loading, error, onRefresh, onLoadMore, hasMore, onRemove }) {
  const meta = SOURCE_META[col.type];

  return (
    <div className="flex h-full w-[380px] flex-shrink-0 flex-col rounded-xl border border-[#2a3b4d] bg-[#182430] shadow-sm md:w-[420px]">
      <div className="flex flex-shrink-0 items-center justify-between border-b border-[#2a3b4d] p-4">
        <div className="flex items-center gap-3">
          <div
            className="flex h-8 w-8 items-center justify-center rounded text-lg font-bold text-white"
            style={{ background: meta.badgeBg }}
          >
            {meta.badge}
          </div>
          <div>
            <h2 className="text-sm font-bold text-white">{meta.name}</h2>
            <p className="text-xs text-slate-400">{meta.subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onRefresh}
            className="rounded p-1.5 text-slate-400 transition-colors hover:bg-white/5 hover:text-[#137fec]"
            type="button"
            aria-label="Refresh"
          >
            <Icon name="refresh" className="h-4 w-4" />
          </button>
          <button
            onClick={() => onRemove(col.id)}
            className="rounded p-1.5 text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
            type="button"
            aria-label="Remove column"
            title="Remove column"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="custom-scrollbar flex-1 space-y-2 overflow-y-auto p-2">
        {loading && items.length === 0 ? (
          <div className="rounded-lg border border-white/5 bg-[#202c3a] p-4 text-sm text-slate-300">Loading content…</div>
        ) : null}

        {error ? (
          <div className="p-2">
            <ErrorBanner title={`${meta.name} unavailable`} message={error} onDismiss={onRefresh} />
          </div>
        ) : null}

        {items.map((it, idx) => (
          <ColumnItem key={it.id} item={it} index={idx} />
        ))}

        {hasMore ? (
          <button
            type="button"
            onClick={onLoadMore}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded py-3 text-sm text-slate-400 transition-colors hover:bg-white/5 hover:text-[#137fec]"
            disabled={loading}
          >
            {loading ? "Loading…" : "Load More"}
            <span className="text-xs">▾</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------
// App
// ---------------------------

export default function App() {
  const [globalSearch, setGlobalSearch] = useState("");
  const [hnQuery, setHnQuery] = useState("");
  const [hnDaysBack, setHnDaysBack] = useState("7d");

  const [columns, setColumns] = useState([
    { id: "col_hn", type: "hn" },
    { id: "col_reddit", type: "reddit" },
    { id: "col_nasa", type: "nasa" },
  ]);

  const [store, setStore] = useState(() => ({
    col_hn: { items: [], loading: false, error: "", page: 0, hasMore: true },
    col_reddit: { items: [], loading: false, error: "", after: null, hasMore: true },
    col_nasa: { items: [], loading: false, error: "", hasMore: false },
  }));

  const abortRef = useRef(null);

  // Ensure store exists for newly added columns
  useEffect(() => {
    setStore((prev) => {
      const next = { ...prev };
      for (const c of columns) {
        if (!next[c.id]) {
          if (c.type === "hn") next[c.id] = { items: [], loading: false, error: "", page: 0, hasMore: true };
          if (c.type === "reddit") next[c.id] = { items: [], loading: false, error: "", after: null, hasMore: true };
          if (c.type === "nasa") next[c.id] = { items: [], loading: false, error: "", hasMore: false };
          if (c.type === "quote") next[c.id] = { items: [], loading: false, error: "", hasMore: false };
        }
      }
      return next;
    });
  }, [columns]);

  function removeColumn(id) {
    setColumns((prev) => prev.filter((c) => c.id !== id));
  }

  function addColumn(type) {
    const id = `col_${type}_${Math.random().toString(16).slice(2, 8)}`;
    setColumns((prev) => [...prev, { id, type }]);
  }

  function openAddColumnMenu() {
    const choice = window.prompt("Add Column:\n1 = Quotes\n2 = NASA\n3 = Hacker News\n4 = Reddit\n\nEnter 1-4");
    const map = { "1": "quote", "2": "nasa", "3": "hn", "4": "reddit" };
    const t = map[String(choice || "").trim()];
    if (t) addColumn(t);
  }

  async function loadColumn(colId, mode) {
    const col = columns.find((c) => c.id === colId);
    if (!col) return;

    setStore((p) => ({ ...p, [colId]: { ...p[colId], loading: true, error: "" } }));

    try {
      if (col.type === "hn") {
        const currentPage = mode === "more" ? store[colId]?.page ?? 0 : 0;
        const res = await fetchHN({ query: hnQuery, page: currentPage, daysBack: hnDaysBack, signal: abortRef.current?.signal });
        setStore((p) => {
          const prevItems = mode === "more" ? p[colId].items : [];
          return {
            ...p,
            [colId]: { ...p[colId], items: [...prevItems, ...res.items], loading: false, error: "", page: res.nextPage, hasMore: res.hasMore },
          };
        });
        return;
      }

      if (col.type === "reddit") {
        const after = mode === "more" ? store[colId]?.after ?? null : null;
        const res = await fetchReddit({ query: hnQuery || "", after, signal: abortRef.current?.signal });
        setStore((p) => {
          const prevItems = mode === "more" ? p[colId].items : [];
          return {
            ...p,
            [colId]: { ...p[colId], items: [...prevItems, ...res.items], loading: false, error: "", after: res.nextAfter, hasMore: res.hasMore },
          };
        });
        return;
      }

            if (!res.ok) {
        return {
          items: [{
            id: "nasa_fallback",
            source: "nasa",
            title: "NASA APOD temporarily unavailable",
            summary: "Rate limit reached. Please refresh later.",
            author: "NASA",
            date: new Date(),
            imageUrl: "",
            score: 0,
            comments: 0,
            host: "api.nasa.gov",
          }],
          hasMore: false,
        };
      }


      if (col.type === "quote") {
        const res = await fetchQuote({ signal: abortRef.current?.signal });
        setStore((p) => ({ ...p, [colId]: { ...p[colId], items: res.items, loading: false, error: "", hasMore: false } }));
        return;
      }
    } catch (e) {
      const msg =
        col.type === "reddit"
          ? "Could not load Reddit items. If you see a CORS error locally, try a different network or deploy (CORS often differs locally vs hosted)."
          : "Could not load content. Try Refresh.";
      setStore((p) => ({ ...p, [colId]: { ...p[colId], loading: false, error: msg } }));
    }
  }

  async function refreshAll() {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    setStore((p) => {
      const next = { ...p };
      for (const c of columns) {
        if (!next[c.id]) continue;
        if (c.type === "hn") next[c.id] = { ...next[c.id], items: [], page: 0, hasMore: true, error: "", loading: true };
        if (c.type === "reddit") next[c.id] = { ...next[c.id], items: [], after: null, hasMore: true, error: "", loading: true };
        if (c.type === "nasa" || c.type === "quote") next[c.id] = { ...next[c.id], items: [], error: "", loading: true, hasMore: false };
      }
      return next;
    });

    await Promise.all(columns.map((c) => loadColumn(c.id, "refresh")));
  }

  useEffect(() => {
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleByColumn = useMemo(() => {
    const s = globalSearch.trim().toLowerCase();
    const out = {};
    for (const c of columns) {
      const bucket = store[c.id]?.items || [];
      out[c.id] =
        !s
          ? bucket
          : bucket.filter((it) =>
              [it.title, it.summary, it.author, it.subreddit, it.host, (it.tags || []).join(" ")]
                .filter(Boolean)
                .join(" ")
                .toLowerCase()
                .includes(s)
            );
    }
    return out;
  }, [columns, store, globalSearch]);

  return (
    <div className="h-screen overflow-hidden bg-[#101922] text-slate-200">
      <div className="flex h-full">
        {/* Sidebar */}
        <aside className="z-20 flex w-16 flex-shrink-0 flex-col items-center border-r border-[#2a3b4d] bg-[#0c131a] py-6 md:w-20">
          <div className="mb-8">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#137fec] shadow-lg shadow-[#137fec]/20">
              <span className="text-white">✺</span>
            </div>
          </div>

          <nav className="flex w-full flex-1 flex-col items-center gap-6">
            <button className="group relative rounded-xl bg-[#137fec]/10 p-3 text-[#137fec]" type="button">
              <Icon name="columns" />
              <Tooltip label="Dashboard" />
            </button>
            <button className="group relative rounded-xl p-3 text-slate-400 transition-colors hover:bg-[#182430] hover:text-[#137fec]" type="button">
              <Icon name="trend" />
              <Tooltip label="Analytics" />
            </button>
            <button className="group relative rounded-xl p-3 text-slate-400 transition-colors hover:bg-[#182430] hover:text-[#137fec]" type="button">
              <Icon name="bookmark" />
              <Tooltip label="Saved" />
            </button>
            <button className="group relative rounded-xl p-3 text-slate-400 transition-colors hover:bg-[#182430] hover:text-[#137fec]" type="button">
              <div className="absolute right-2 top-2 h-2 w-2 rounded-full bg-red-500" />
              <Icon name="bell" />
              <Tooltip label="Notifications" />
            </button>
          </nav>

          <div className="mt-auto flex flex-col items-center gap-4">
            <div className="h-8 w-8 overflow-hidden rounded-full border border-[#2a3b4d] bg-white/10" />
            <button className="rounded-xl p-3 text-slate-400 transition-colors hover:bg-[#182430] hover:text-slate-200" type="button">
              <Icon name="settings" />
            </button>
          </div>
        </aside>

        {/* Main */}
        <main className="flex h-full flex-1 flex-col overflow-hidden">
          {/* Top bar */}
          <header className="flex h-16 flex-shrink-0 items-center justify-between border-b border-[#2a3b4d] bg-[#101922] px-4 sm:px-6">
            <div className="flex items-center gap-4">
              <h1 className="text-xl font-bold tracking-tight text-white">Tech Pulse</h1>
              <div className="mx-2 hidden h-4 w-px bg-[#2a3b4d] sm:block" />

              <div className="flex items-center gap-2 rounded-lg border border-transparent bg-[#182430] px-3 py-1.5 text-sm text-slate-300 transition-all focus-within:border-[#137fec]/50 focus-within:ring-1 focus-within:ring-[#137fec]/50 sm:w-96">
                <Icon name="search" className="h-4 w-4 text-slate-400" />
                <input
                  className="h-full w-full border-none bg-transparent p-0 text-sm text-slate-200 placeholder:text-slate-500 outline-none focus:ring-0"
                  placeholder="Search keywords across all sources…"
                  value={globalSearch}
                  onChange={(e) => setGlobalSearch(e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={refreshAll}
                className="hidden items-center gap-2 rounded-lg border border-[#2a3b4d] bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/10 sm:flex"
                type="button"
              >
                <Icon name="refresh" className="h-4 w-4" />
                Refresh All
              </button>

              <button
                onClick={openAddColumnMenu}
                className="flex items-center gap-2 rounded-lg bg-[#137fec] px-3 py-1.5 text-xs font-medium text-white shadow-lg shadow-[#137fec]/20 transition-colors hover:bg-[#0f6bd0]"
                type="button"
              >
                <Icon name="add" className="h-4 w-4" />
                Add Column
              </button>
            </div>
          </header>

          {/* Controls row */}
          <section className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-[#2a3b4d] bg-[#0c131a] px-4 py-3 sm:px-6">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-400">HN query:</span>
              <input
                value={hnQuery}
                onChange={(e) => setHnQuery(e.target.value)}
                placeholder="e.g., AI, climate, Apple"
                className="w-44 rounded-lg border border-[#2a3b4d] bg-[#101922] px-2 py-1 text-xs text-slate-200 placeholder:text-slate-500 outline-none focus:border-[#137fec]/60"
              />
              <span className="text-xs text-slate-400">Window:</span>
              <select
                value={hnDaysBack}
                onChange={(e) => setHnDaysBack(e.target.value)}
                className="rounded-lg border border-[#2a3b4d] bg-[#101922] px-2 py-1 text-xs text-slate-200 outline-none"
              >
                <option value="24h">24h</option>
                <option value="7d">7d</option>
                <option value="30d">30d</option>
                <option value="all">all</option>
              </select>
              <button
                type="button"
                onClick={refreshAll}
                className="ml-1 rounded-lg border border-[#2a3b4d] bg-white/5 px-2 py-1 text-xs text-slate-200 hover:bg-white/10"
              >
                Apply
              </button>
            </div>
            <div className="ml-auto text-xs text-slate-500">Global search filters fetched cards; refresh pulls new content.</div>
          </section>

          {/* Columns */}
          <div className="flex-1 overflow-x-auto overflow-y-hidden bg-[#0c131a]">
            <div className="flex h-full w-max min-w-full gap-4 p-4">
              {columns.map((c) => (
                <ColumnShell
                  key={c.id}
                  col={c}
                  items={visibleByColumn[c.id] || []}
                  loading={Boolean(store[c.id]?.loading)}
                  error={store[c.id]?.error || ""}
                  hasMore={Boolean(store[c.id]?.hasMore)}
                  onRefresh={() => loadColumn(c.id, "refresh")}
                  onLoadMore={() => loadColumn(c.id, "more")}
                  onRemove={removeColumn}
                />
              ))}
            </div>
          </div>
        </main>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: rgba(0,0,0,0.1); }
        .custom-scrollbar::-webkit-scrollbar-thumb { background-color: #2a3b4d; border-radius: 20px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background-color: #137fec; }
      `}</style>
    </div>
  );
}
