import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Portfolio Project #2 — Multi-Source Content Dashboard
 * Focus: “Daily Signal Dashboard” for communications + content teams.
 * APIs (no keys required):
 * 1) Hacker News (Algolia) Search API
 * 2) NASA APOD API (uses DEMO_KEY)
 * 3) Quotable (random quote)
 *
 * Paste this file as src/App.jsx in a Vite+React+Tailwind project.
 */

// ---------------------------
// Helpers
// ---------------------------

const SOURCE = {
  HN: "Hacker News",
  NASA: "NASA APOD",
  QUOTE: "Quote",
};

function isoToDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDateTime(d) {
  if (!d) return "";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function clampText(s, max = 220) {
  if (!s) return "";
  const t = String(s).replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

function safeUrl(u) {
  try {
    const url = new URL(u);
    return url.toString();
  } catch {
    return "";
  }
}

// Normalize into a unified schema
// type ContentItem = {
//   id: string;
//   source: "HN" | "NASA" | "QUOTE";
//   title: string;
//   url: string;
//   date: Date | null;
//   summary: string;
//   tags: string[];
//   score?: number;
//   imageUrl?: string;
//   author?: string;
// }

// ---------------------------
// API clients (separated for clarity)
// ---------------------------

async function fetchHN({ query, daysBack, signal }) {
  // Algolia HN Search API: https://hn.algolia.com/api
  // We use search_by_date for recency and allow query filter.
  const base = "https://hn.algolia.com/api/v1/search_by_date";
  const params = new URLSearchParams();
  params.set("tags", "story");
  params.set("hitsPerPage", "40");
  if (query && query.trim()) params.set("query", query.trim());

  // Filter by created_at_i (unix seconds)
  if (daysBack !== "all") {
    const nowSec = Math.floor(Date.now() / 1000);
    const backSec =
      daysBack === "24h" ? 24 * 3600 : daysBack === "7d" ? 7 * 24 * 3600 : 30 * 24 * 3600;
    const minSec = nowSec - backSec;
    // numericFilters format
    params.set("numericFilters", `created_at_i>${minSec}`);
  }

  const res = await fetch(`${base}?${params.toString()}`, {
    signal,
    headers: {
      // Helpful for some APIs; harmless here.
      "Accept": "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`HN request failed (${res.status})`);
  }
  const data = await res.json();

  const items = (data.hits || []).map((h) => {
    const url = safeUrl(h.url || (h.objectID ? `https://news.ycombinator.com/item?id=${h.objectID}` : ""));
    return {
      id: `hn_${h.objectID}`,
      source: "HN",
      title: h.title || "(Untitled)",
      url,
      date: isoToDate(h.created_at),
      summary: clampText(h.story_text || ""),
      tags: Array.isArray(h._tags) ? h._tags.filter((t) => t !== "story") : [],
      score: typeof h.points === "number" ? h.points : 0,
      author: h.author || "",
    };
  });

  return items;
}

async function fetchNASA({ signal }) {
  // NASA APOD: https://api.nasa.gov/
  const base = "https://api.nasa.gov/planetary/apod";
  const params = new URLSearchParams({ api_key: "DEMO_KEY" });
  const res = await fetch(`${base}?${params.toString()}`, { signal });
  if (!res.ok) {
    throw new Error(`NASA APOD request failed (${res.status})`);
  }
  const d = await res.json();

  const url = safeUrl(d.url || "");
  const hd = safeUrl(d.hdurl || "");
  const bestImage = d.media_type === "image" ? (hd || url) : "";

  return [
    {
      id: `nasa_${d.date || "apod"}`,
      source: "NASA",
      title: d.title || "Astronomy Picture of the Day",
      url: url || "https://apod.nasa.gov/",
      date: d.date ? isoToDate(`${d.date}T00:00:00Z`) : null,
      summary: clampText(d.explanation || ""),
      tags: ["space", "science"],
      score: 0,
      imageUrl: bestImage,
      author: d.copyright || "NASA",
    },
  ];
}

async function fetchQuote({ signal }) {
  // Quotable: https://github.com/lukePeavey/quotable (public API)
  const res = await fetch("https://api.quotable.io/random", { signal });
  if (!res.ok) {
    throw new Error(`Quote request failed (${res.status})`);
  }
  const q = await res.json();
  return [
    {
      id: `quote_${q._id}`,
      source: "QUOTE",
      title: q.author ? `Quote by ${q.author}` : "Quote",
      url: "", // no canonical link provided; keep empty
      date: q.dateAdded ? isoToDate(q.dateAdded) : null,
      summary: `“${q.content}”`,
      tags: Array.isArray(q.tags) ? q.tags : ["inspiration"],
      score: 0,
      author: q.author || "",
    },
  ];
}

// ---------------------------
// UI
// ---------------------------

function Badge({ children }) {
  return (
    <span className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-xs text-white/80">
      {children}
    </span>
  );
}

function PillButton({ active, children, onClick }) {
  return (
    <button
      onClick={onClick}
      className={
        "rounded-full px-3 py-1 text-sm transition " +
        (active
          ? "bg-white text-black"
          : "bg-white/5 text-white/85 hover:bg-white/10 border border-white/10")
      }
      type="button"
    >
      {children}
    </button>
  );
}

function ErrorBanner({ title, message, onDismiss }) {
  return (
    <div className="rounded-2xl border border-red-400/30 bg-red-500/10 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-red-200">{title}</div>
          <div className="mt-1 text-sm text-red-100/80">{message}</div>
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

function Card({ item }) {
  const sourceLabel = SOURCE[item.source] || item.source;
  const dateLabel = item.date ? formatDateTime(item.date) : "";

  return (
    <article className="group rounded-2xl border border-white/10 bg-white/5 p-4 shadow-sm backdrop-blur transition hover:bg-white/[0.07]">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{sourceLabel}</Badge>
        {dateLabel ? <span className="text-xs text-white/60">{dateLabel}</span> : null}
        {typeof item.score === "number" && item.source === "HN" ? (
          <Badge>{item.score} pts</Badge>
        ) : null}
      </div>

      <h3 className="mt-3 text-base font-semibold leading-snug text-white">
        {item.url ? (
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="underline decoration-white/20 underline-offset-4 hover:decoration-white/60"
          >
            {item.title}
          </a>
        ) : (
          item.title
        )}
      </h3>

      {item.imageUrl ? (
        <div className="mt-3 overflow-hidden rounded-xl border border-white/10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.imageUrl}
            alt={item.title}
            className="h-44 w-full object-cover transition duration-300 group-hover:scale-[1.01]"
            loading="lazy"
          />
        </div>
      ) : null}

      {item.summary ? <p className="mt-3 text-sm text-white/75">{item.summary}</p> : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {item.author ? <Badge>by {item.author}</Badge> : null}
        {(item.tags || []).slice(0, 4).map((t) => (
          <Badge key={t}>{t}</Badge>
        ))}
      </div>
    </article>
  );
}

export default function App() {
  // Controls
  const [query, setQuery] = useState("");
  const [searchText, setSearchText] = useState(""); // client-side search across all sources
  const [daysBack, setDaysBack] = useState("7d"); // 24h | 7d | 30d | all
  const [sortBy, setSortBy] = useState("newest"); // newest | oldest | score
  const [sourceFilter, setSourceFilter] = useState({ HN: true, NASA: true, QUOTE: true });

  // Data + states
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [partialLoading, setPartialLoading] = useState({ HN: false, NASA: false, QUOTE: false });
  const [errors, setErrors] = useState([]); // {id, title, message}

  const abortRef = useRef(null);

  const selectedSources = useMemo(() => {
    return Object.entries(sourceFilter)
      .filter(([, on]) => on)
      .map(([k]) => k);
  }, [sourceFilter]);

  async function refresh() {
    // Cancel inflight
    if (abortRef.current) abortRef.current.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setErrors([]);
    setLoading(true);

    // Per-source loading signals
    setPartialLoading({ HN: true, NASA: true, QUOTE: true });

    const results = [];
    const nextErrors = [];

    // Fetch in parallel, but isolate failures
    const tasks = [
      fetchHN({ query, daysBack, signal: ac.signal })
        .then((hn) => results.push(...hn))
        .catch((e) => {
          nextErrors.push({
            id: "err_hn",
            title: "Hacker News unavailable",
            message: "Could not load Hacker News items. Try refresh or adjust your query.",
            dev: String(e?.message || e),
          });
        })
        .finally(() => setPartialLoading((p) => ({ ...p, HN: false }))),

      fetchNASA({ signal: ac.signal })
        .then((nasa) => results.push(...nasa))
        .catch((e) => {
          nextErrors.push({
            id: "err_nasa",
            title: "NASA APOD unavailable",
            message: "Could not load NASA content (APOD). Try refresh later.",
            dev: String(e?.message || e),
          });
        })
        .finally(() => setPartialLoading((p) => ({ ...p, NASA: false }))),

      fetchQuote({ signal: ac.signal })
        .then((q) => results.push(...q))
        .catch((e) => {
          nextErrors.push({
            id: "err_quote",
            title: "Quote service unavailable",
            message: "Could not load a quote. Try refresh later.",
            dev: String(e?.message || e),
          });
        })
        .finally(() => setPartialLoading((p) => ({ ...p, QUOTE: false }))),
    ];

    await Promise.all(tasks);

    // Deterministic base ordering to keep UI stable
    results.sort((a, b) => (a.id > b.id ? 1 : -1));

    setItems(results);
    setErrors(nextErrors);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const view = useMemo(() => {
    let list = [...items];

    // Source filter
    list = list.filter((it) => selectedSources.includes(it.source));

    // Client-side search across unified content
    const s = searchText.trim().toLowerCase();
    if (s) {
      list = list.filter((it) => {
        const hay = [it.title, it.summary, it.author, (it.tags || []).join(" ")]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(s);
      });
    }

    // Sorting
    if (sortBy === "score") {
      list.sort((a, b) => (b.score || 0) - (a.score || 0) || ((b.date?.getTime() || 0) - (a.date?.getTime() || 0)));
    } else if (sortBy === "oldest") {
      list.sort((a, b) => (a.date?.getTime() || 0) - (b.date?.getTime() || 0));
    } else {
      // newest
      list.sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0));
    }

    return list;
  }, [items, selectedSources, searchText, sortBy]);

  const anyLoading = loading || partialLoading.HN || partialLoading.NASA || partialLoading.QUOTE;

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-950 to-black text-white">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:py-10">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Daily Signal Dashboard</h1>
            <p className="mt-1 text-sm text-white/70">
              Unified feed from <span className="text-white/90">Hacker News</span>, <span className="text-white/90">NASA APOD</span>, and a
              <span className="text-white/90"> quote</span> — built for communicators who need fast daily signals.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={refresh}
              className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-white/90 disabled:opacity-60"
              disabled={anyLoading}
            >
              {anyLoading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </header>

        <section className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="lg:col-span-2">
              <label className="text-xs font-medium text-white/70">Search (across all sources)</label>
              <input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Search titles, summaries, tags…"
                className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/25"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-white/70">HN query (server-side)</label>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g., AI, Apple, climate"
                className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/25"
              />
              <button
                type="button"
                onClick={refresh}
                className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-60"
                disabled={anyLoading}
              >
                Apply HN query
              </button>
            </div>

            <div>
              <label className="text-xs font-medium text-white/70">Sort</label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-white/25"
              >
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="score">HN Score</option>
              </select>

              <label className="mt-3 block text-xs font-medium text-white/70">Date window</label>
              <select
                value={daysBack}
                onChange={(e) => setDaysBack(e.target.value)}
                className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-white/25"
              >
                <option value="24h">Last 24 hours</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="all">All time</option>
              </select>

              <button
                type="button"
                onClick={refresh}
                className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-60"
                disabled={anyLoading}
              >
                Apply date window
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-xs text-white/70">Sources:</span>
            {Object.keys(SOURCE).map((k) => (
              <PillButton
                key={k}
                active={sourceFilter[k]}
                onClick={() => setSourceFilter((p) => ({ ...p, [k]: !p[k] }))}
              >
                {SOURCE[k]}
              </PillButton>
            ))}

            <div className="ml-auto text-xs text-white/60">
              {partialLoading.HN || partialLoading.NASA || partialLoading.QUOTE ? (
                <span>Loading content…</span>
              ) : (
                <span>{view.length} items</span>
              )}
            </div>
          </div>
        </section>

        <section className="mt-4 space-y-3">
          {errors.map((e) => (
            <ErrorBanner
              key={e.id}
              title={e.title}
              message={e.message}
              onDismiss={() => setErrors((prev) => prev.filter((x) => x.id !== e.id))}
            />
          ))}

          {loading && items.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-white/70">
              Loading content…
            </div>
          ) : null}
        </section>

        <main className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {view.map((it) => (
            <Card key={it.id} item={it} />
          ))}
        </main>

        <footer className="mt-10 text-xs text-white/50">
          Source attribution: Each card shows its source badge. External links open in a new tab.
        </footer>
      </div>
    </div>
  );
}
