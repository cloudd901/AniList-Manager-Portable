import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import packageInfo from "../package.json";
import "./styles.css";

const APP_VERSION = `v${packageInfo.version}`;
const ADD_STATUS = "ADD";
const LIST_STATUSES = [
  { value: "CURRENT", label: "Watching" },
  { value: "PLANNING", label: "Planning" },
  { value: "COMPLETED", label: "Completed" },
  { value: "PAUSED", label: "Paused" },
  { value: "DROPPED", label: "Dropped" },
  { value: "REPEATING", label: "Repeating" }
];
const STATUSES = [...LIST_STATUSES, { value: ADD_STATUS, label: "Add" }];
const EXPORT_STATUSES = LIST_STATUSES.map((status) => status.value);
const EXPORT_AVAILABILITY_CHUNK_SIZE = 25;
const EXPORT_RATING_CHUNK_SIZE = 25;
const MAL_STATUS_LABELS = {
  CURRENT: "Watching",
  COMPLETED: "Completed",
  PAUSED: "On-Hold",
  DROPPED: "Dropped",
  PLANNING: "Plan to Watch",
  REPEATING: "Watching"
};
const MAL_SERIES_TYPES = {
  TV: "TV",
  TV_SHORT: "TV",
  MOVIE: "Movie",
  SPECIAL: "Special",
  OVA: "OVA",
  ONA: "ONA",
  MUSIC: "Music"
};

const SORT_OPTIONS = [
  { value: "english", label: "English name" },
  { value: "romaji", label: "Romaji name" },
  { value: "year", label: "Year" },
  { value: "progress", label: "Progress" },
  { value: "total", label: "Total episodes" },
  { value: "sub", label: "Sub episodes" },
  { value: "dub", label: "Dub episodes" },
  { value: "personalScore", label: "Personal Score" },
  { value: "publicScore", label: "Public Score" },
  { value: "notes", label: "Notes" },
  { value: "rating", label: "Class Rating" }
];
const ADD_SEARCH_LIMIT_OPTIONS = ["all", "200", "100", "50", "20"];
const AVAILABILITY_CHUNK_SIZE = 25;
const RATING_CHUNK_SIZE = 4;
const RATING_BATCH_DELAY_MS = 500;
const AUTO_AVAILABILITY_COOLDOWN_MS = 60 * 60 * 1000;
const AUTO_AVAILABILITY_STORAGE_PREFIX = "anilist-manager:auto-availability:";
const BULK_PROGRESS_CHUNK_SIZE = 12;
const COLOR_MODES = [
  { value: "light", label: "Light" },
  { value: "soft", label: "Soft" },
  { value: "dim", label: "Dim" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" }
];
const ACCENT_THEMES = [
  { value: "blue", label: "Blue" },
  { value: "teal", label: "Teal" },
  { value: "rose", label: "Rose" }
];
const ALERT_ICON_OPTIONS = [
  { value: "triangle", label: "Warning" },
  { value: "beacon", label: "Beacon" },
  { value: "bolt", label: "Bolt" },
  { value: "dot", label: "Dot" },
  { value: "green-dot", label: "Green Dot" }
];
const FORMAT_LABELS = {
  TV: "Series",
  TV_SHORT: "Short Series",
  MOVIE: "Movie",
  SPECIAL: "Special",
  OVA: "OVA",
  ONA: "ONA",
  MUSIC: "Music"
};
const RATING_SORT_RANKS = {
  Rx: 6,
  "R+": 5,
  R: 4,
  "PG-13": 3,
  PG: 2,
  G: 1
};
const AVAILABILITY_ALERT_STATUSES = new Set(["CURRENT", "PLANNING", "PAUSED", "REPEATING"]);

function defaultSettings() {
  return {
    showNotes: false,
    appearance: {
      colorMode: "soft",
      accentTheme: "teal",
      alertIcon: "green-dot",
      showSynonymInfoIcon: true
    },
    watchNow: {
      selectedServerId: "",
      hideWatchNow: false,
      useAniListDetails: false,
      showUnwatchedDubAlert: false,
      showUnwatchedSubAlert: false,
      servers: []
    },
    updates: {
      autoCheckEnabled: true
    }
  };
}

function normalizeSettings(settings) {
  const watchNow = settings?.watchNow || {};
  const appearance = settings?.appearance || {};
  const updates = settings?.updates || {};
  return {
    showNotes: settings?.showNotes === true,
    appearance: {
      colorMode: COLOR_MODES.some((mode) => mode.value === appearance.colorMode) ? appearance.colorMode : "soft",
      accentTheme: ACCENT_THEMES.some((theme) => theme.value === appearance.accentTheme) ? appearance.accentTheme : "teal",
      alertIcon: ALERT_ICON_OPTIONS.some((option) => option.value === appearance.alertIcon) ? appearance.alertIcon : "green-dot",
      showSynonymInfoIcon: appearance.showSynonymInfoIcon !== false
    },
    watchNow: {
      selectedServerId: watchNow.selectedServerId || "",
      hideWatchNow: watchNow.hideWatchNow === true,
      useAniListDetails: watchNow.useAniListDetails === true,
      showUnwatchedDubAlert: watchNow.showUnwatchedDubAlert === true,
      showUnwatchedSubAlert: watchNow.showUnwatchedSubAlert === true,
      servers: Array.isArray(watchNow.servers) ? watchNow.servers : []
    },
    updates: {
      autoCheckEnabled: updates.autoCheckEnabled !== false
    }
  };
}

function formatPublicScore(score) {
  const numericScore = Number(score) || 0;
  return numericScore > 0 ? (numericScore / 10).toFixed(1) : "";
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

function clampScore10(score) {
  const numericScore = Number(score) || 0;
  return Math.min(10, Math.max(0, numericScore));
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .trim();
}

function csvCell(value) {
  if (value === null || value === undefined) {
    return "";
  }
  const text = Array.isArray(value) ? value.join("|") : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function cdata(value) {
  return `<![CDATA[${String(value ?? "").replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
}

function anilistDateToString(date) {
  const year = Number(date?.year) || 0;
  const month = Number(date?.month) || 0;
  const day = Number(date?.day) || 0;
  if (!year || !month || !day) {
    return "0000-00-00";
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function anilistDateRaw(date) {
  if (!date || (!date.year && !date.month && !date.day)) {
    return "";
  }
  return [date.year || "0000", date.month ? String(date.month).padStart(2, "0") : "00", date.day ? String(date.day).padStart(2, "0") : "00"].join("-");
}

function malPriority(priority) {
  const value = Number(priority) || 0;
  if (value >= 3) {
    return "HIGH";
  }
  if (value === 2) {
    return "MEDIUM";
  }
  return "LOW";
}

function downloadTextFile(filename, contentType, content) {
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportEntry(entry, metadata = {}) {
  const availability = metadata.availability || {};
  const rating = metadata.rating || {};
  const publicScore100 = Number(entry.publicScore) || 0;
  const listStatus = metadata.listStatus || entry.listStatus || entry.status;
  const rewatching = listStatus === "REPEATING" || entry.status === "REPEATING";
  return {
    listStatus,
    listName: metadata.listName || entry.listName || "",
    id: entry.id,
    mediaId: entry.mediaId,
    malId: entry.malId,
    status: entry.status,
    progress: entry.progress,
    personalScore: Number(entry.score) || 0,
    publicScore: formatPublicScore(publicScore100),
    publicScore100,
    title: entry.title,
    romajiTitle: entry.romajiTitle,
    englishTitle: entry.englishTitle,
    nativeTitle: entry.nativeTitle,
    description: stripHtml(entry.descriptionHtml),
    genres: entry.genres || [],
    synonyms: entry.synonyms || [],
    seasonYear: entry.seasonYear,
    format: entry.format,
    isAdult: entry.isAdult === true,
    totalEpisodes: entry.totalEpisodes,
    availabilityTotalEpisodes: availability.totalEpisodes ?? null,
    subEpisodes: availability.subEpisodes ?? null,
    dubEpisodes: availability.dubEpisodes ?? null,
    availabilitySource: availability.source || "",
    availabilityNote: availability.note || availability.matchedTitle || "",
    classRating: rating.rating || "",
    classRatingLabel: rating.ratingLabel || "",
    mediaStatus: entry.mediaStatus,
    isAiring: entry.isAiring === true,
    nextAiringEpisode: entry.nextAiringEpisode || null,
    anilistNotes: entry.notes || "",
    note: entry.notes || "",
    startedAt: anilistDateRaw(entry.startedAt),
    startedAtMal: anilistDateToString(entry.startedAt),
    completedAt: anilistDateRaw(entry.completedAt),
    completedAtMal: anilistDateToString(entry.completedAt),
    repeat: Number(entry.repeat) || 0,
    priority: Number(entry.priority) || 0,
    malPriority: malPriority(entry.priority),
    customLists: (entry.customLists || []).filter(Boolean),
    rewatching,
    rewatchingEpisodes: rewatching ? Math.max(0, Number(entry.progress) || 0) : 0,
    siteUrl: entry.siteUrl,
    coverImage: entry.coverImage,
    coverImageLarge: entry.coverImageLarge
  };
}

function buildCsvExport(entries) {
  const columns = [
    ["listName", "List Name"],
    ["mediaId", "AniList ID"],
    ["malId", "MAL ID"],
    ["title", "Title"],
    ["romajiTitle", "Romaji Title"],
    ["englishTitle", "English Title"],
    ["nativeTitle", "Native Title"],
    ["status", "Entry Status"],
    ["progress", "Progress"],
    ["personalScore", "Personal Score"],
    ["publicScore", "Public Score"],
    ["availabilityTotalEpisodes", "Availability Total Episodes"],
    ["subEpisodes", "Sub Episodes"],
    ["dubEpisodes", "Dub Episodes"],
    ["availabilitySource", "Availability Source"],
    ["classRating", "Class Rating"],
    ["classRatingLabel", "Class Rating Label"],
    ["seasonYear", "Year"],
    ["format", "Format"],
    ["mediaStatus", "Media Status"],
    ["isAiring", "Airing"],
    ["isAdult", "Adult"],
    ["genres", "Genres"],
    ["synonyms", "Synonyms"],
    ["anilistNotes", "AniList Notes"],
    ["startedAt", "Started At"],
    ["completedAt", "Completed At"],
    ["repeat", "Repeat Count"],
    ["priority", "Priority"],
    ["malPriority", "MAL Priority"],
    ["customLists", "Custom Lists"],
    ["rewatching", "Rewatching"],
    ["rewatchingEpisodes", "Rewatching Episodes"],
    ["description", "Description"],
    ["siteUrl", "AniList URL"],
    ["coverImage", "Cover Image"],
    ["coverImageLarge", "Large Cover Image"]
  ];
  return [
    columns.map(([, label]) => csvCell(label)).join(","),
    ...entries.map((entry) => columns.map(([key]) => csvCell(entry[key])).join(","))
  ].join("\r\n");
}

function buildMalXmlExport({ entries, user }) {
  const importableEntries = entries.filter((entry) => Number(entry.malId) > 0);
  const statusCounts = importableEntries.reduce((counts, entry) => {
    const status = MAL_STATUS_LABELS[entry.listStatus] || MAL_STATUS_LABELS[entry.status] || "Plan to Watch";
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
  const rows = importableEntries
    .filter((entry) => Number(entry.malId) > 0)
    .map((entry) => {
      const status = MAL_STATUS_LABELS[entry.listStatus] || MAL_STATUS_LABELS[entry.status] || "Plan to Watch";
      const totalEpisodes = Number(entry.availabilityTotalEpisodes || entry.totalEpisodes || 0) || 0;
      const watchedEpisodes = Math.max(0, Number(entry.progress) || 0);
      const score = Math.round(clampScore10(entry.personalScore));
      const rewatching = entry.rewatching === true;
      return `\t\t<anime>
\t\t\t<series_animedb_id>${xmlEscape(entry.malId)}</series_animedb_id>
\t\t\t<series_title>${cdata(entry.title)}</series_title>
\t\t\t<series_type>${xmlEscape(MAL_SERIES_TYPES[entry.format] || "")}</series_type>
\t\t\t<series_episodes>${xmlEscape(totalEpisodes)}</series_episodes>
\t\t\t<my_id>0</my_id>
\t\t\t<my_watched_episodes>${xmlEscape(watchedEpisodes)}</my_watched_episodes>
\t\t\t<my_start_date>${xmlEscape(entry.startedAtMal || "0000-00-00")}</my_start_date>
\t\t\t<my_finish_date>${xmlEscape(entry.completedAtMal || "0000-00-00")}</my_finish_date>
\t\t\t<my_rated></my_rated>
\t\t\t<my_score>${xmlEscape(score)}</my_score>
\t\t\t<my_storage></my_storage>
\t\t\t<my_storage_value>0.00</my_storage_value>
\t\t\t<my_status>${xmlEscape(status)}</my_status>
\t\t\t<my_comments>${cdata(entry.anilistNotes || "")}</my_comments>
\t\t\t<my_times_watched>${xmlEscape(entry.repeat || 0)}</my_times_watched>
\t\t\t<my_rewatch_value></my_rewatch_value>
\t\t\t<my_priority>${xmlEscape(entry.malPriority || "LOW")}</my_priority>
\t\t\t<my_tags>${cdata((entry.customLists || []).join(", "))}</my_tags>
\t\t\t<my_rewatching>${rewatching ? 1 : 0}</my_rewatching>
\t\t\t<my_rewatching_ep>${xmlEscape(entry.rewatchingEpisodes || 0)}</my_rewatching_ep>
\t\t\t<my_discuss>1</my_discuss>
\t\t\t<my_sns>default</my_sns>
\t\t\t<update_on_import>1</update_on_import>
\t\t</anime>`;
    });
  return `<?xml version="1.0" encoding="UTF-8" ?>
\t\t<!--
\t\t Created by AniList Manager Portable
\t\t MAL-compatible import XML
\t\t-->
<myanimelist>
\t<myinfo>
\t\t<user_id>0</user_id>
\t\t<user_name>${xmlEscape(user?.name || "")}</user_name>
\t\t<user_export_type>1</user_export_type>
\t\t<user_total_anime>${xmlEscape(importableEntries.length)}</user_total_anime>
\t\t<user_total_watching>${xmlEscape(statusCounts.Watching || 0)}</user_total_watching>
\t\t<user_total_completed>${xmlEscape(statusCounts.Completed || 0)}</user_total_completed>
\t\t<user_total_onhold>${xmlEscape(statusCounts["On-Hold"] || 0)}</user_total_onhold>
\t\t<user_total_dropped>${xmlEscape(statusCounts.Dropped || 0)}</user_total_dropped>
\t\t<user_total_plantowatch>${xmlEscape(statusCounts["Plan to Watch"] || 0)}</user_total_plantowatch>
\t</myinfo>
${rows.join("\n")}
</myanimelist>
`;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timeoutId = window.setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timeoutId);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true }
    );
  });
}

function formatAiring(nextAiringEpisode) {
  if (!nextAiringEpisode) {
    return "";
  }
  const date = new Date(nextAiringEpisode.airingAt * 1000);
  return `Ep ${nextAiringEpisode.episode} airs ${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  })}`;
}

function formatLabel(format) {
  if (!format) {
    return "";
  }
  return FORMAT_LABELS[format] || format.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function ratingClass(label) {
  return `rating-${String(label || "unknown").toLowerCase().replaceAll("+", "plus").replace(/[^a-z0-9]+/g, "-")}`;
}

function statusLabel(value) {
  return LIST_STATUSES.find((status) => status.value === value)?.label || value || "";
}

function formatQueueTimestamp(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatUpdateDate(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleDateString([], {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function sanitizePreviewSynopsis(value) {
  if (!value || typeof document === "undefined") {
    return "";
  }

  const parsed = new DOMParser().parseFromString(`<div>${value}</div>`, "text/html");
  const output = document.createElement("div");
  const blockedTags = new Set(["script", "style", "iframe", "object", "embed", "svg"]);

  function appendSafeNodes(source, target) {
    source.childNodes.forEach((child) => {
      if (child.nodeType === 3) {
        target.append(document.createTextNode(child.textContent || ""));
        return;
      }
      if (child.nodeType !== 1) {
        return;
      }

      const tag = child.tagName.toLowerCase();
      if (blockedTags.has(tag)) {
        return;
      }
      if (tag === "br") {
        target.append(document.createElement("br"));
        return;
      }

      const safeTag = tag === "p"
        ? "span"
        : tag === "b"
          ? "strong"
          : tag === "i"
            ? "em"
            : ["em", "strong"].includes(tag)
              ? tag
              : "";
      if (!safeTag) {
        appendSafeNodes(child, target);
        return;
      }

      const safeNode = document.createElement(safeTag);
      if (tag === "p") {
        safeNode.className = "cover-preview-paragraph";
      }
      appendSafeNodes(child, safeNode);
      target.append(safeNode);
    });
  }

  appendSafeNodes(parsed.body, output);
  output.querySelectorAll(".cover-preview-paragraph").forEach((paragraph) => {
    if (!paragraph.textContent.trim()) {
      paragraph.remove();
    }
  });

  function collapseBreakRuns(node) {
    let consecutiveBreaks = 0;
    [...node.childNodes].forEach((child) => {
      if (child.nodeType === 1 && child.tagName === "BR") {
        consecutiveBreaks += 1;
        if (consecutiveBreaks > 2) {
          child.remove();
        }
        return;
      }
      if (child.nodeType === 3 && !child.textContent.trim() && consecutiveBreaks > 0) {
        return;
      }

      consecutiveBreaks = 0;
      if (child.nodeType === 1) {
        collapseBreakRuns(child);
      }
    });
  }

  collapseBreakRuns(output);
  return output.innerHTML.trim();
}

function parseMarkdown(md) {
  if (!md) return "";

  const lines = md.split(/\r?\n/);
  const html = [];

  let currentBlock = null; // null, 'ul', 'ol', 'table', 'p'
  let listItems = [];
  let tableRows = [];
  let pLines = [];

  function closeCurrentBlock() {
    if (!currentBlock) return;
    if (currentBlock === 'ul') {
      html.push('<ul>' + listItems.map(item => `<li>${inline(item)}</li>`).join('') + '</ul>');
      listItems = [];
    } else if (currentBlock === 'ol') {
      html.push('<ol>' + listItems.map(item => `<li>${inline(item)}</li>`).join('') + '</ol>');
      listItems = [];
    } else if (currentBlock === 'table') {
      if (tableRows.length > 0) {
        let tableHtml = '<table>';
        const headers = parseTableRow(tableRows[0]);
        tableHtml += '<thead><tr>' + headers.map(h => `<th>${inline(h)}</th>`).join('') + '</tr></thead>';
        tableHtml += '<tbody>';
        const startIdx = (tableRows[1] && tableRows[1].includes('---')) ? 2 : 1;
        for (let i = startIdx; i < tableRows.length; i++) {
          const cells = parseTableRow(tableRows[i]);
          tableHtml += '<tr>' + cells.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>';
        }
        tableHtml += '</tbody></table>';
        html.push(tableHtml);
      }
      tableRows = [];
    } else if (currentBlock === 'p') {
      const content = pLines.join(' ');
      if (content.trim()) {
        html.push(`<p>${inline(content)}</p>`);
      }
      pLines = [];
    }
    currentBlock = null;
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function escapeAttribute(text) {
    return escapeHtml(text)
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function safeMarkdownUrl(url) {
    try {
      const parsedUrl = new URL(url, window.location.origin);
      if (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") {
        return parsedUrl.href;
      }
    } catch {
      // Ignore malformed or unsupported URLs.
    }
    return "";
  }

  function inline(text) {
    let output = escapeHtml(text);
    output = output.replace(/`([^`]+)`/g, "<code>$1</code>");
    output = output.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    output = output.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, url) => {
      const safeUrl = safeMarkdownUrl(url);
      return safeUrl ? `<a href="${escapeAttribute(safeUrl)}" target="_blank" rel="noreferrer">${label}</a>` : label;
    });

    return output;
  }

  function parseTableRow(rowText) {
    const clean = rowText.trim().replace(/^\||\|$/g, '');
    return clean.split('|').map(cell => cell.trim());
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      closeCurrentBlock();
      continue;
    }

    if (trimmed.startsWith('# ')) {
      closeCurrentBlock();
      html.push(`<h1>${inline(trimmed.slice(2))}</h1>`);
      continue;
    }
    if (trimmed.startsWith('## ')) {
      closeCurrentBlock();
      html.push(`<h2>${inline(trimmed.slice(3))}</h2>`);
      continue;
    }
    if (trimmed.startsWith('### ')) {
      closeCurrentBlock();
      html.push(`<h3>${inline(trimmed.slice(4))}</h3>`);
      continue;
    }

    if (trimmed.startsWith('- ')) {
      if (currentBlock !== 'ul') {
        closeCurrentBlock();
        currentBlock = 'ul';
      }
      listItems.push(trimmed.slice(2));
      continue;
    }

    const olMatch = trimmed.match(/^(\d+)\.\s+(.*)/);
    if (olMatch) {
      if (currentBlock !== 'ol') {
        closeCurrentBlock();
        currentBlock = 'ol';
      }
      listItems.push(olMatch[2]);
      continue;
    }

    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      if (currentBlock !== 'table') {
        closeCurrentBlock();
        currentBlock = 'table';
      }
      tableRows.push(trimmed);
      continue;
    }

    if (currentBlock !== 'p') {
      closeCurrentBlock();
      currentBlock = 'p';
    }
    pLines.push(trimmed);
  }

  closeCurrentBlock();
  return html.join('\n');
}

let apiSessionPromise = null;

function requiresApiSession(path, method) {
  return path.startsWith("/api/") && path !== "/api/session" && ["POST", "PUT", "PATCH", "DELETE"].includes(method);
}

async function apiSession() {
  if (!apiSessionPromise) {
    apiSessionPromise = fetch("/api/session", {
      headers: {
        Accept: "application/json"
      }
    }).then(async (response) => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.sessionToken || !payload.headerName) {
        throw new Error(payload.error || "Could not create a local API session.");
      }
      return payload;
    });
  }
  return apiSessionPromise;
}

async function api(path, options = {}, retrySession = true) {
  const method = (options.method || "GET").toUpperCase();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  if (requiresApiSession(path, method)) {
    const session = await apiSession();
    headers[session.headerName] = session.sessionToken;
  }

  const response = await fetch(path, {
    ...options,
    method,
    headers
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (retrySession && response.status === 403 && /session/i.test(payload.error || "")) {
      apiSessionPromise = null;
      return api(path, options, false);
    }
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
  return payload;
}

function autoAvailabilityStorageKey(status) {
  return `${AUTO_AVAILABILITY_STORAGE_PREFIX}${status}`;
}

function hasRecentAutoAvailability(status) {
  try {
    const checkedAt = Number(window.localStorage.getItem(autoAvailabilityStorageKey(status)));
    return Number.isFinite(checkedAt) && Date.now() - checkedAt < AUTO_AVAILABILITY_COOLDOWN_MS;
  } catch {
    return false;
  }
}

function markAutoAvailability(status) {
  try {
    window.localStorage.setItem(autoAvailabilityStorageKey(status), String(Date.now()));
  } catch {
    // Continue when browser storage is unavailable.
  }
}

function titleMatchesQuery(entry, query) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }
  return [entry.title, entry.romajiTitle, entry.englishTitle, entry.nativeTitle]
    .filter(Boolean)
    .some((title) => String(title).toLowerCase().includes(normalizedQuery));
}

function isUnreleased(entry) {
  return entry.mediaStatus === "NOT_YET_RELEASED";
}

function restoreWindowScroll({ top, left, shouldContinue }) {
  if (!Number.isFinite(top)) {
    return;
  }
  const scrollLeft = Number.isFinite(left) ? left : window.scrollX;
  let attempts = 0;

  function restore() {
    if (shouldContinue && !shouldContinue()) {
      return;
    }
    window.scrollTo({ left: scrollLeft, top });
    attempts += 1;
    if (attempts < 8) {
      window.requestAnimationFrame(restore);
    }
  }

  window.requestAnimationFrame(restore);
  window.setTimeout(() => {
    if (!shouldContinue || shouldContinue()) {
      window.scrollTo({ left: scrollLeft, top });
    }
  }, 150);
}

function ProgressControl({ entry, onUpdate, onRefreshNeeded, shouldRefreshAtTotal, offlineMode }) {
  const total = entry.totalEpisodes;
  const [value, setValue] = useState(String(entry.progress));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(String(entry.progress));
  }, [entry.progress]);

  async function saveProgress(nextProgress) {
    const normalized = Math.max(0, Number(nextProgress) || 0);
    const previousProgress = entry.progress;
    onUpdate({ ...entry, progress: normalized });
    setSaving(true);
    try {
      const payload = await api(`/api/entries/${entry.mediaId}`, {
        method: "PATCH",
        body: JSON.stringify({ progress: normalized })
      });
      onUpdate(payload.entry);
      if (!offlineMode && shouldRefreshAtTotal && Number.isFinite(total) && total > 0 && normalized >= total) {
        await onRefreshNeeded();
      }
    } catch (saveError) {
      onUpdate({ ...entry, progress: previousProgress });
      throw saveError;
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="row-control progress-wrapper">
      <span>Progress</span>
      <div className="progress-control" aria-label={`Progress for ${entry.title}`}>
        <button
          type="button"
          className="icon-button"
          disabled={saving || entry.progress <= 0}
          onClick={() => saveProgress(entry.progress - 1)}
          title="Decrease progress"
        >
          -
        </button>
        <input
          value={value}
          inputMode="numeric"
          aria-label="Watched episodes"
          onChange={(event) => setValue(event.target.value.replace(/[^0-9]/g, ""))}
          onBlur={() => saveProgress(value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
        />
        <span className="episode-total">/ {total ?? "?"}</span>
        <button
          type="button"
          className="icon-button"
          disabled={saving || (Number.isFinite(total) && entry.progress >= total)}
          onClick={() => saveProgress(entry.progress + 1)}
          title="Increase progress"
        >
          +
        </button>
      </div>
    </div>
  );
}

function ScoreControl({ entry, onUpdate }) {
  const [value, setValue] = useState(String(entry.score ?? 0));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(String(entry.score ?? 0));
  }, [entry.score]);

  async function saveScore(nextScore) {
    const normalized = Math.max(0, Number(nextScore) || 0);
    setSaving(true);
    try {
      const payload = await api(`/api/entries/${entry.mediaId}`, {
        method: "PATCH",
        body: JSON.stringify({ score: normalized })
      });
      const preserveScrollY = window.scrollY;
      const preserveScrollX = window.scrollX;
      onUpdate(payload.entry, { preserveScrollY, preserveScrollX });
    } finally {
      setSaving(false);
    }
  }

  return (
    <label className="row-control score-control" title="AniList score">
      <span>Score</span>
      <input
        value={value}
        disabled={saving}
        inputMode="decimal"
        aria-label={`AniList score for ${entry.title}`}
        onChange={(event) => setValue(event.target.value.replace(/[^0-9.]/g, ""))}
        onBlur={() => saveScore(value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

function NoteControl({ entry, onUpdate, onError }) {
  const [value, setValue] = useState(entry.notes || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(entry.notes || "");
  }, [entry.notes]);

  async function saveNote() {
    if (value.trim() === (entry.notes || "")) {
      return;
    }
    setSaving(true);
    try {
      const payload = await api(`/api/entries/${entry.mediaId}`, {
        method: "PATCH",
        body: JSON.stringify({ notes: value })
      });
      onUpdate(payload.entry);
    } catch (saveError) {
      setValue(entry.notes || "");
      onError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <label className="row-control note-control">
      <span>Notes</span>
      <textarea
        value={value}
        disabled={saving}
        rows={2}
        aria-label={`Notes for ${entry.title}`}
        onChange={(event) => setValue(event.target.value)}
        onBlur={saveNote}
      />
    </label>
  );
}

function isAvailabilityIncomplete(availability) {
  if (!availability || availability.status !== "found" || !availability.totalEpisodes) {
    return false;
  }
  if (availability.forceComplete) {
    return false;
  }
  return (
    Number(availability.subEpisodes) < availability.totalEpisodes ||
    (Number(availability.dubEpisodes) > 0 && Number(availability.dubEpisodes) < availability.totalEpisodes)
  );
}

function isAvailabilityComplete(availability) {
  if (!availability || availability.status !== "found" || !availability.totalEpisodes) {
    return false;
  }
  if (availability.forceComplete) {
    return true;
  }
  const totalEpisodes = Number(availability.totalEpisodes);
  const subEpisodes = Number(availability.subEpisodes);
  const dubEpisodes = Number(availability.dubEpisodes);
  return subEpisodes >= totalEpisodes && (dubEpisodes <= 0 || dubEpisodes >= totalEpisodes);
}

function isAvailabilityMissing(availability) {
  return (
    !availability ||
    availability.status === "not_found" ||
    availability.status === "error" ||
    (availability.subEpisodes == null && availability.dubEpisodes == null)
  );
}

function shouldRefreshAiringAvailability(entry, availability) {
  if (entry.isAiring || availability?.forceAiring === true) {
    return true;
  }
  return (
    availability?.forceComplete !== true &&
    Number(availability?.subEpisodes) > 0 &&
    Number(availability?.dubEpisodes) < Number(availability?.subEpisodes)
  );
}

function entryYear(entry) {
  if (entry.isAiring) {
    return new Date().getFullYear();
  }
  return Number(entry.seasonYear || entry.endDate?.year) || null;
}

function selectedWatchNowServer(watchNow) {
  return watchNow?.servers?.find((server) => server.id === watchNow.selectedServerId) || null;
}

function sortedWatchNowServers(watchNow) {
  return [...(watchNow?.servers || [])].sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" }));
}

function templateHasMediaId(template) {
  const normalizedTemplate = template?.toLowerCase() || "";
  return normalizedTemplate.includes("<anilistid>") || normalizedTemplate.includes("<malid>");
}

function urlFromTemplate(template, entry, episode) {
  if (!templateHasMediaId(template)) {
    return "";
  }

  if (template.toLowerCase().includes("<malid>") && !entry.malId) {
    return "";
  }

  let url = template
    .replaceAll(/<anilistid>/gi, encodeURIComponent(String(entry.mediaId)))
    .replaceAll(/<malid>/gi, encodeURIComponent(String(entry.malId)));
  if (episode !== undefined) {
    url = url.replaceAll(/<episode>/gi, encodeURIComponent(String(episode)));
  }
  return url;
}

function detailsUrl(watchNow, entry) {
  const server = selectedWatchNowServer(watchNow);
  if (watchNow?.useAniListDetails || !server?.detailsUrlTemplate) {
    return entry.siteUrl || "";
  }
  return detailsUrlForServer(server, entry) || entry.siteUrl || "";
}

function detailsUrlForServer(server, entry) {
  return urlFromTemplate(server?.detailsUrlTemplate || "", entry);
}

function nextEpisodeNumber(entry) {
  const total = Number(entry.totalEpisodes);
  const nextEpisode = Math.max(1, Number(entry.progress || 0) + 1);
  return Number.isFinite(total) && total > 0 ? Math.min(nextEpisode, total) : nextEpisode;
}

function watchUrlForServer(server, entry, episode) {
  return urlFromTemplate(server?.watchUrlTemplate || "", entry, episode);
}

function nextEpisodeUrl(watchNow, entry) {
  if (watchNow?.hideWatchNow) {
    return "";
  }

  const server = selectedWatchNowServer(watchNow);
  if (!server?.watchUrlTemplate) {
    return "";
  }

  return watchUrlForServer(server, entry, nextEpisodeNumber(entry));
}

function watchNowUrl(watchNow, entry) {
  if (watchNow?.hideWatchNow) {
    return "";
  }

  const server = selectedWatchNowServer(watchNow);
  if (!server?.watchUrlTemplate) {
    return "";
  }

  return watchUrlForServer(server, entry, 1);
}

function linkMenuPosition(event, width = 220, height = 260) {
  return {
    x: Math.min(event.clientX, Math.max(12, window.innerWidth - width)),
    y: Math.min(event.clientY, Math.max(12, window.innerHeight - height))
  };
}

function disabledWatchServerReason(server, entry, templateKey) {
  const template = server?.[templateKey] || "";
  if (!template) {
    return "No URL template configured.";
  }
  if (template.toLowerCase().includes("<malid>") && !entry.malId) {
    return "This entry has no MAL ID.";
  }
  return "";
}

function buildDetailsServerOptions(watchNow, entry) {
  const selectedServer = selectedWatchNowServer(watchNow);
  return [
    {
      id: "__anilist__",
      label: "AniList",
      url: entry.siteUrl || "",
      active: watchNow?.useAniListDetails === true || !selectedServer,
      disabled: !entry.siteUrl,
      reason: entry.siteUrl ? "" : "AniList URL is unavailable."
    },
    ...sortedWatchNowServers(watchNow).map((server) => {
      const reason = disabledWatchServerReason(server, entry, "detailsUrlTemplate");
      const url = reason ? "" : detailsUrlForServer(server, entry);
      return {
        id: server.id,
        label: server.name || "Unnamed server",
        url,
        active: watchNow?.useAniListDetails !== true && server.id === selectedServer?.id,
        disabled: !url,
        reason: reason || (!url ? "Details URL could not be built." : "")
      };
    })
  ];
}

function buildWatchServerOptions(watchNow, entry, episode) {
  const servers = sortedWatchNowServers(watchNow);
  if (servers.length === 0) {
    return [{ id: "__empty__", label: "No Watch Now servers saved", url: "", disabled: true, reason: "" }];
  }
  return servers.map((server) => {
    const reason = disabledWatchServerReason(server, entry, "watchUrlTemplate");
    const url = reason ? "" : watchUrlForServer(server, entry, episode);
    return {
      id: server.id,
      label: server.name || "Unnamed server",
      url,
      active: server.id === watchNow?.selectedServerId,
      disabled: !url,
      reason: reason || (!url ? "Watch URL could not be built." : "")
    };
  });
}

function availabilityAlertLabel({ showSubAlert, showDubAlert }) {
  if (showSubAlert && showDubAlert) {
    return "Unwatched sub and dub episodes available";
  }
  if (showSubAlert) {
    return "Unwatched sub episodes available";
  }
  if (showDubAlert) {
    return "Unwatched dub episodes available";
  }
  return "";
}

function availabilityAlertState(entry, availability, activeStatus, watchNow) {
  if (!availability
    || availability.status === "not_found"
    || availability.status === "error"
    || !AVAILABILITY_ALERT_STATUSES.has(activeStatus)) {
    return { showSubAlert: false, showDubAlert: false, label: "" };
  }

  const progress = Math.max(0, Number(entry.progress) || 0);
  const showSubAlert = watchNow?.showUnwatchedSubAlert === true
    && Number(availability.subEpisodes) > progress;
  const showDubAlert = watchNow?.showUnwatchedDubAlert === true
    && Number(availability.dubEpisodes) > progress;
  return {
    showSubAlert,
    showDubAlert,
    label: availabilityAlertLabel({ showSubAlert, showDubAlert })
  };
}

function alertIconOption(iconId) {
  return ALERT_ICON_OPTIONS.find((option) => option.value === iconId) || ALERT_ICON_OPTIONS[0];
}

function AvailabilityAlertIcon({ label, iconId = ALERT_ICON_OPTIONS[0].value }) {
  if (!label) {
    return null;
  }
  const iconOption = alertIconOption(iconId);
  return (
    <span
      className={`availability-alert-icon availability-alert-icon-${iconOption.value}`}
      role="img"
      aria-label={label}
      title={label}
    />
  );
}

function AvailabilityBadge({ entry, availability, activeStatus, watchNow, alertIconId, onEdit }) {
  function editOverride(event) {
    event.preventDefault();
    onEdit?.(entry, availability);
  }

  if (!availability) {
    return <span className="availability-badge muted" onContextMenu={editOverride}>Sub/Dub ...</span>;
  }
  if (availability.status === "not_found") {
    return <span className="availability-badge muted" onContextMenu={editOverride}>Sub/Dub n/a</span>;
  }
  if (availability.status === "error") {
    return <span className="availability-badge warning" onContextMenu={editOverride}>Sub/Dub error</span>;
  }

  const total = availability.totalEpisodes ?? "?";
  const incomplete = isAvailabilityIncomplete(availability);
  const forceComplete = availability.forceComplete === true;
  const forceAiring = availability.forceAiring === true;
  const hasCountOverride = availability.source === "local-override" || availability.totalSource === "override";
  const isAiring = entry.isAiring || forceAiring;
  const hasDub = Number(availability.dubEpisodes) > 0;
  const alertLabel = availabilityAlertState(entry, availability, activeStatus, watchNow).label;
  const subComplete = Number(availability.subEpisodes) >= Number(availability.totalEpisodes);
  const dubComplete = hasDub && Number(availability.dubEpisodes) >= Number(availability.totalEpisodes);
  const title = forceComplete
    ? "Completed"
    : isAiring && dubComplete
      ? "airing and dub complete"
      : isAiring
        ? "still airing"
        : hasDub && Number(availability.dubEpisodes) < Number(availability.totalEpisodes)
          ? "dub not complete"
          : subComplete && dubComplete
            ? "sub and dub complete"
            : subComplete && !hasDub
              ? "sub complete"
              : availability.matchedTitle || "";
  return (
    <span className="availability-badge-wrap">
      <span
        className={[
          "availability-badge",
          !forceComplete && (incomplete || isAiring) ? "incomplete" : "",
          hasCountOverride ? "override" : ""
        ].filter(Boolean).join(" ")}
        title={title}
        onContextMenu={editOverride}
      >
        [{total}] Sub {availability.subEpisodes ?? "?"}
        {hasDub ? ` / Dub ${availability.dubEpisodes}` : ""}
      </span>
      <AvailabilityAlertIcon label={alertLabel} iconId={alertIconId} />
    </span>
  );
}

function RefreshAvailabilityDialog({ open, onClose, onRefresh }) {
  if (!open) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="choice-dialog" role="dialog" aria-modal="true" aria-labelledby="refresh-availability-title">
        <div className="dialog-header">
          <h2 id="refresh-availability-title">Refresh Availability</h2>
          <button type="button" className="icon-close" onClick={onClose} aria-label="Close refresh options">
            x
          </button>
        </div>
        <div className="choice-dialog-body">
          <p>Choose which entries to check against the availability provider.</p>
          <div className="choice-actions">
            <button type="button" onClick={() => onRefresh("missing")}>
              Missing
            </button>
            <button type="button" onClick={() => onRefresh("airing")}>
              Airing
            </button>
            <button type="button" onClick={() => onRefresh("all")}>
              All
            </button>
            <button type="button" className="secondary-button" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function ExportDialog({ open, loading, exporting, progress, onClose, onExport }) {
  const [scope, setScope] = useState("all");
  const [format, setFormat] = useState("malXml");

  useEffect(() => {
    if (!open) {
      return;
    }
    setScope("all");
    setFormat("malXml");
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !exporting && onClose()}>
      <section className="choice-dialog export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-dialog-title">
        <div className="dialog-header">
          <h2 id="export-dialog-title">Export</h2>
          <button type="button" className="icon-close" disabled={exporting} onClick={onClose} aria-label="Close export options">
            x
          </button>
        </div>
        <div className="choice-dialog-body export-dialog-body">
          <label className="field-stack">
            <span>Scope</span>
            <select value={scope} disabled={exporting} onChange={(event) => setScope(event.target.value)}>
              <option value="all">All lists</option>
              <option value="filtered">Current filtered</option>
            </select>
          </label>
          <label className="field-stack">
            <span>Format</span>
            <select value={format} disabled={exporting} onChange={(event) => setFormat(event.target.value)}>
              <option value="malXml">MyAnimeList Import XML</option>
              <option value="csv">Full CSV Export</option>
            </select>
          </label>
          {progress ? <p className="export-progress">{progress}</p> : null}
          <div className="choice-actions">
            <button type="button" className="secondary-button" disabled={exporting} onClick={onClose}>
              Cancel
            </button>
            <button type="button" disabled={loading || exporting} onClick={() => onExport({ scope, format })}>
              {exporting ? "Exporting..." : "Export"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function OfflineDisableDialog({ open, queued, busy, onSync, onDiscard, onCancel }) {
  if (!open) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onCancel()}>
      <section className="choice-dialog offline-disable-dialog" role="dialog" aria-modal="true" aria-labelledby="offline-disable-title">
        <div className="dialog-header">
          <h2 id="offline-disable-title">Turn Off Offline Mode</h2>
          <button type="button" className="icon-close" disabled={busy} onClick={onCancel} aria-label="Close offline mode options">
            x
          </button>
        </div>
        <div className="choice-dialog-body offline-disable-body">
          <p>{queued} queued offline edit{queued === 1 ? "" : "s"} can be synced to AniList or discarded before Offline Mode is turned off.</p>
          <div className="choice-actions">
            <button type="button" className="secondary-button" disabled={busy} onClick={onCancel}>
              Cancel
            </button>
            <button type="button" className="danger-button" disabled={busy} onClick={onDiscard}>
              Discard edits
            </button>
            <button type="button" disabled={busy} onClick={onSync}>
              {busy ? "Working..." : "Sync edits"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function OfflineSyncFailureDialog({ open, failures, busy, onRetry, onDiscard, onStayOffline }) {
  if (!open) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onStayOffline()}>
      <section className="choice-dialog offline-sync-failure-dialog" role="dialog" aria-modal="true" aria-labelledby="offline-sync-failure-title">
        <div className="dialog-header">
          <h2 id="offline-sync-failure-title">Sync Failed</h2>
          <button type="button" className="icon-close" disabled={busy} onClick={onStayOffline} aria-label="Close sync failure options">
            x
          </button>
        </div>
        <div className="choice-dialog-body offline-disable-body">
          <p>{failures.length} queued edit{failures.length === 1 ? "" : "s"} could not sync.</p>
          <div className="offline-failure-list">
            {failures.map((item, index) => (
              <article className="offline-queue-item" key={item.id || `${item.kind}-${item.mediaId}-${index}`}>
                <strong>{item.title || "Queued item"}</strong>
                <span>{item.summary || "Queued change"}</span>
                {Array.isArray(item.details) && item.details.length > 1 ? (
                  <small>{item.details.slice(1).join(" · ")}</small>
                ) : null}
                {item.error ? <small className="offline-failure-error">{item.error}</small> : null}
              </article>
            ))}
          </div>
          <div className="choice-actions offline-failure-actions">
            <button type="button" className="secondary-button" disabled={busy} onClick={onStayOffline}>
              Stay offline
            </button>
            <button type="button" className="danger-button" disabled={busy} onClick={onDiscard}>
              Discard failed edits
            </button>
            <button type="button" disabled={busy} onClick={onRetry}>
              {busy ? "Working..." : "Retry sync"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function AvailabilityOverrideDialog({ overrideTarget, onClose, onSave, onRemove }) {
  const entry = overrideTarget?.entry;
  const current = overrideTarget?.availability;
  const [totalEpisodes, setTotalEpisodes] = useState("");
  const [subEpisodes, setSubEpisodes] = useState("");
  const [dubEpisodes, setDubEpisodes] = useState("");
  const [note, setNote] = useState("");
  const [forceComplete, setForceComplete] = useState(false);
  const [forceAiring, setForceAiring] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!entry) {
      return;
    }
    setTotalEpisodes(String(current?.totalEpisodes ?? entry.totalEpisodes ?? ""));
    setSubEpisodes(String(current?.subEpisodes ?? 0));
    setDubEpisodes(String(current?.dubEpisodes ?? 0));
    setNote(current?.note || "");
    setForceComplete(current?.forceComplete === true);
    setForceAiring(current?.forceAiring === true);
    setSaving(false);
    setError("");
  }, [entry, current]);

  if (!entry) {
    return null;
  }

  const hasOverride = current?.override === true || current?.source === "local-override" || current?.totalSource === "override";

  async function saveOverride() {
    setSaving(true);
    setError("");
    try {
      await onSave(entry, {
        totalEpisodes: Number(totalEpisodes),
        subEpisodes: Number(subEpisodes),
        dubEpisodes: Number(dubEpisodes),
        note: note.trim() || null,
        matchedTitle: note.trim() || null,
        forceComplete,
        forceAiring
      });
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  async function removeOverride() {
    setSaving(true);
    setError("");
    try {
      await onRemove(entry);
    } catch (removeError) {
      setError(removeError.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="override-dialog" role="dialog" aria-modal="true" aria-labelledby="availability-override-title">
        <div className="dialog-header">
          <h2 id="availability-override-title">Availability Override</h2>
          <button type="button" className="icon-close" onClick={onClose} aria-label="Close availability override">
            x
          </button>
        </div>
        <div className="override-body">
          <div className="override-title">{entry.title}</div>
          <label className="field-stack">
            <span>Total episodes</span>
            <input type="number" min="1" value={totalEpisodes} onChange={(event) => setTotalEpisodes(event.target.value)} />
          </label>
          <label className="field-stack">
            <span>Sub episodes</span>
            <input type="number" min="0" value={subEpisodes} onChange={(event) => setSubEpisodes(event.target.value)} />
          </label>
          <label className="field-stack">
            <span>Dub episodes</span>
            <input type="number" min="0" value={dubEpisodes} onChange={(event) => setDubEpisodes(event.target.value)} />
          </label>
          <label className="field-stack">
            <span>Note</span>
            <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional note" />
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={forceComplete} onChange={(event) => setForceComplete(event.target.checked)} />
            <span>Force completed</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={forceAiring} onChange={(event) => setForceAiring(event.target.checked)} />
            <span>Force airing</span>
          </label>
          {error ? <div className="error-banner compact">{error}</div> : null}
          <div className="override-actions">
            {hasOverride ? (
              <button type="button" className="danger-button" disabled={saving} onClick={removeOverride}>
                Clear override
              </button>
            ) : null}
            <button type="button" className="secondary-button" disabled={saving} onClick={onClose}>
              Cancel
            </button>
            <button type="button" disabled={saving} onClick={saveOverride}>
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function RowTitleMenu({ menu, onClose }) {
  useEffect(() => {
    if (!menu) {
      return undefined;
    }
    function closeOnKey(event) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("click", onClose);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("keydown", closeOnKey);
    return () => {
      window.removeEventListener("click", onClose);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("keydown", closeOnKey);
    };
  }, [menu, onClose]);

  if (!menu) {
    return null;
  }

  async function copyValue(value) {
    await navigator.clipboard.writeText(String(value ?? ""));
    onClose();
  }

  return (
    <div
      className="row-title-menu"
      style={{ left: menu.x, top: menu.y }}
      onClick={(event) => event.stopPropagation()}
      role="menu"
      aria-label={`Copy details for ${menu.entry.title}`}
    >
      <button type="button" role="menuitem" onClick={() => copyValue(menu.entry.title)}>
        Copy name
      </button>
      <button type="button" role="menuitem" onClick={() => copyValue(menu.entry.mediaId)}>
        Copy AniList ID
      </button>
      <button type="button" role="menuitem" disabled={!menu.entry.malId} onClick={() => copyValue(menu.entry.malId)}>
        Copy MAL ID
      </button>
    </div>
  );
}

function WatchServerMenu({ menu, onClose }) {
  useEffect(() => {
    if (!menu) {
      return undefined;
    }
    function closeOnKey(event) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("click", onClose);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("keydown", closeOnKey);
    return () => {
      window.removeEventListener("click", onClose);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("keydown", closeOnKey);
    };
  }, [menu, onClose]);

  if (!menu) {
    return null;
  }

  function openOption(option) {
    if (option.disabled || !option.url) {
      return;
    }
    window.open(option.url, "_blank", "noreferrer");
    onClose();
  }

  return (
    <div
      className="watch-server-menu"
      style={{ left: menu.x, top: menu.y }}
      onClick={(event) => event.stopPropagation()}
      role="menu"
      aria-label={menu.label}
    >
      <strong>{menu.label}</strong>
      {menu.options.map((option) => (
        <button
          type="button"
          role="menuitem"
          className={option.active ? "active" : ""}
          disabled={option.disabled}
          title={option.reason || ""}
          onClick={() => openOption(option)}
          key={option.id}
        >
          <span>{option.label}</span>
          {option.active ? <small>Active</small> : null}
        </button>
      ))}
    </div>
  );
}

function EntryPreviewContent({ entry }) {
  const previewSynopsis = useMemo(() => sanitizePreviewSynopsis(entry.descriptionHtml), [entry.descriptionHtml]);
  const previewGenres = Array.isArray(entry.genres) ? entry.genres.filter(Boolean) : [];
  const publicScore = formatPublicScore(entry.publicScore);

  return (
    <>
      <span className="cover-preview-cover">
        {entry.coverImageLarge || entry.coverImage ? (
          <img src={entry.coverImageLarge || entry.coverImage} alt="" className="cover-preview-image" loading="lazy" />
        ) : (
          <span className="cover-preview-image cover-preview-image-missing" />
        )}
        {publicScore ? <span className="cover-preview-public-score">{publicScore}</span> : null}
      </span>
      <span className="cover-preview-info">
        <strong className="cover-preview-title">{entry.title}</strong>
        {previewSynopsis ? (
          <span className="cover-preview-synopsis" dangerouslySetInnerHTML={{ __html: previewSynopsis }} />
        ) : (
          <span className="cover-preview-synopsis cover-preview-empty">Synopsis not available.</span>
        )}
        <span className="cover-preview-genres">
          {previewGenres.length > 0 ? previewGenres.map((genre) => (
            <span className="cover-preview-genre" key={genre}>{genre}</span>
          )) : <span className="cover-preview-empty">No genres listed.</span>}
        </span>
      </span>
    </>
  );
}

function updateHoverPreviewPosition(trigger) {
  const panel = trigger?.querySelector(".cover-preview-panel");
  if (!trigger || !panel) {
    return;
  }

  const viewportMargin = 16;
  const triggerRect = trigger.getBoundingClientRect();
  const fallbackPanelHeight = Math.min(440, Math.max(0, window.innerHeight - viewportMargin * 2));
  const panelHeight = panel.offsetHeight || fallbackPanelHeight;
  const centeredTop = triggerRect.top + triggerRect.height / 2 - panelHeight / 2;
  const maxTop = Math.max(viewportMargin, window.innerHeight - viewportMargin - panelHeight);
  const clampedTop = Math.min(Math.max(centeredTop, viewportMargin), maxTop);
  trigger.style.setProperty("--cover-preview-top", `${clampedTop - triggerRect.top}px`);
  trigger.style.setProperty("--cover-preview-translate-y", "0px");
}

function resetHoverPreviewPosition(trigger) {
  trigger?.style.removeProperty("--cover-preview-top");
  trigger?.style.removeProperty("--cover-preview-translate-y");
}

function focusedPreviewAnimationStyle(origin) {
  if (!origin || typeof window === "undefined") {
    return undefined;
  }

  const targetWidth = Math.min(676, window.innerWidth - 36);
  const targetHeight = Math.min(430, window.innerHeight - 36);
  if (targetWidth <= 0 || targetHeight <= 0 || origin.width <= 0 || origin.height <= 0) {
    return undefined;
  }

  return {
    "--focused-preview-shift-x": `${origin.left + origin.width / 2 - window.innerWidth / 2}px`,
    "--focused-preview-shift-y": `${origin.top + origin.height / 2 - window.innerHeight / 2}px`,
    "--focused-preview-scale-x": origin.width / targetWidth,
    "--focused-preview-scale-y": origin.height / targetHeight
  };
}

function FocusedEntryPreview({ entry, origin, onClose }) {
  if (!entry) {
    return null;
  }

  const animationStyle = focusedPreviewAnimationStyle(origin);

  return (
    <section
      className={animationStyle ? "cover-preview-focused from-hover-preview" : "cover-preview-focused"}
      style={animationStyle}
      aria-label={`Focused preview for ${entry.title}`}
    >
      <button type="button" className="icon-close cover-preview-focused-close" onClick={onClose} aria-label="Close focused preview">
        x
      </button>
      <EntryPreviewContent entry={entry} />
    </section>
  );
}

function entrySubtitleDetails(entry) {
  const synonyms = Array.isArray(entry.synonyms)
    ? entry.synonyms.map((synonym) => String(synonym || "").trim()).filter(Boolean)
    : [];
  const romajiTitle = entry.romajiTitle || "";
  const englishTitle = entry.englishTitle || "";
  const trimmedRomajiTitle = romajiTitle.trim();
  const trimmedEnglishTitle = englishTitle.trim();
  const displayedTitle = String(entry.title || "").trim();
  const showRomajiSubtitle = trimmedRomajiTitle && trimmedRomajiTitle !== displayedTitle;
  const showSynonymSubtitle =
    !showRomajiSubtitle &&
    trimmedRomajiTitle &&
    trimmedEnglishTitle &&
    trimmedRomajiTitle === trimmedEnglishTitle &&
    synonyms.length > 0;

  return {
    subtitle: showRomajiSubtitle ? romajiTitle : showSynonymSubtitle ? synonyms[0] : "",
    synonyms
  };
}

function EntrySubtitle({ entry, showSynonymInfoIcon }) {
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const subtitleRef = useRef(null);
  const { subtitle, synonyms } = entrySubtitleDetails(entry);
  const showTooltip = Boolean(showSynonymInfoIcon && subtitle && synonyms.length > 0);

  useEffect(() => {
    if (!tooltipOpen) {
      return undefined;
    }

    function closeOnOutsideClick(event) {
      if (!subtitleRef.current?.contains(event.target)) {
        setTooltipOpen(false);
      }
    }

    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [tooltipOpen]);

  return (
    <div ref={subtitleRef} className={showTooltip && tooltipOpen ? "subtitle synonym-subtitle open" : showTooltip ? "subtitle synonym-subtitle" : "subtitle"}>
      <span>{subtitle}</span>
      {showTooltip ? (
        <>
          <button
            type="button"
            className="synonym-info-button"
            aria-label={`Show synonyms for ${entry.title}`}
            aria-expanded={tooltipOpen}
            onClick={() => setTooltipOpen((currentOpen) => !currentOpen)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setTooltipOpen(false);
              }
            }}
          >
            i
          </button>
          <span className="synonym-tooltip" role="tooltip">
            <span className="synonym-tooltip-heading">Synonyms</span>
            {synonyms.map((synonym, index) => (
              <span className="synonym-tooltip-item" key={`${synonym}-${index}`}>
                {synonym}
              </span>
            ))}
          </span>
        </>
      ) : null}
    </div>
  );
}

function EntryRow({ entry, selected, onSelectedChange, onUpdate, onDelete, activeStatus, availability, rating, watchNow, alertIconId, showSynonymInfoIcon, onRefreshNeeded, onAvailabilityOverride, onPreviewFocus, previewFocused, showNotes, onNoteError, offlineMode, onOpenWatchServerMenu }) {
  const [moving, setMoving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [titleMenu, setTitleMenu] = useState(null);
  const year = entryYear(entry);
  const metaIsAiring = entry.isAiring || availability?.forceAiring === true;
  const forcedMetaAiring = availability?.forceAiring === true || availability?.forceComplete === true;
  const mediaFormat = formatLabel(entry.format);
  const detailsLink = detailsUrl(watchNow, entry);
  const episodeLink = activeStatus === "CURRENT" ? nextEpisodeUrl(watchNow, entry) : watchNowUrl(watchNow, entry);
  const publicScore = formatPublicScore(entry.publicScore);

  function openTitleMenu(event) {
    event.preventDefault();
    setTitleMenu({
      entry,
      x: Math.min(event.clientX, window.innerWidth - 180),
      y: Math.min(event.clientY, window.innerHeight - 132)
    });
  }

  function openDetailsServerMenu(event) {
    event.preventDefault();
    event.stopPropagation();
    onOpenWatchServerMenu({
      ...linkMenuPosition(event),
      label: "Open Details With",
      options: buildDetailsServerOptions(watchNow, entry)
    });
  }

  function openEpisodeServerMenu(event) {
    event.preventDefault();
    event.stopPropagation();
    const isNextEpisode = activeStatus === "CURRENT";
    onOpenWatchServerMenu({
      ...linkMenuPosition(event),
      label: isNextEpisode ? "Open Next Episode With" : "Open Watch Now With",
      options: buildWatchServerOptions(watchNow, entry, isNextEpisode ? nextEpisodeNumber(entry) : 1)
    });
  }

  async function moveTo(status) {
    if (status === "__REMOVE__") {
      await deleteEntry();
      return;
    }
    if (status === activeStatus) {
      return;
    }
    setMoving(true);
    try {
      const payload = await api(`/api/entries/${entry.mediaId}`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
      onUpdate(payload.entry, { removeFromCurrent: true });
    } finally {
      setMoving(false);
    }
  }

  async function deleteEntry() {
    if (!window.confirm(`Remove "${entry.title}" from your AniList completely?`)) {
      return;
    }
    setDeleting(true);
    try {
      await api(`/api/list-entries/${entry.id}`, { method: "DELETE" });
      onDelete(entry.mediaId);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <article className="entry-row">
      <label className="select-cell">
        <input
          type="checkbox"
          checked={selected}
          onChange={(event) => onSelectedChange(entry.mediaId, event.target.checked)}
          aria-label={`Select ${entry.title}`}
        />
      </label>
      <button
        type="button"
        className={previewFocused ? "cover-preview focused-preview-open" : "cover-preview"}
        aria-label={`Preview cover for ${entry.title}`}
        onMouseEnter={(event) => updateHoverPreviewPosition(event.currentTarget)}
        onMouseLeave={(event) => resetHoverPreviewPosition(event.currentTarget)}
        onFocus={(event) => updateHoverPreviewPosition(event.currentTarget)}
        onBlur={(event) => resetHoverPreviewPosition(event.currentTarget)}
        onClick={(event) => onPreviewFocus(entry.mediaId, event)}
      >
        <img src={entry.coverImage || ""} alt="" className="cover" loading="lazy" />
        {publicScore ? <span className="cover-thumbnail-public-score">{publicScore}</span> : null}
        <span className="cover-preview-panel" aria-hidden="true">
          <EntryPreviewContent entry={entry} />
        </span>
      </button>
      <div className={`entry-main ${entry.nextAiringEpisode ? "has-airing-row" : ""}`}>
        <div className="title-line">
          {offlineMode ? (
          <span className="title-link offline-title" onContextMenu={openTitleMenu}>
            {entry.title}
          </span>
          ) : (
          <a href={entry.siteUrl} target="_blank" rel="noreferrer" className="title-link" onContextMenu={openTitleMenu}>
            {entry.title}
          </a>
          )}
          <RowTitleMenu menu={titleMenu} onClose={() => setTitleMenu(null)} />
        </div>
        <EntrySubtitle entry={entry} showSynonymInfoIcon={showSynonymInfoIcon} />
        {entry.nextAiringEpisode ? <div className="airing">{formatAiring(entry.nextAiringEpisode)}</div> : null}
        <div className="availability-line">
          {offlineMode ? (
          <span className="watch-now-badge disabled-link-badge">
            Details
          </span>
          ) : (
          <a
            href={detailsLink || entry.siteUrl}
            target="_blank"
            rel="noreferrer"
            className="watch-now-badge"
            onContextMenu={openDetailsServerMenu}
          >
            Details
          </a>
          )}
          {episodeLink && !offlineMode ? (
            <a
              href={episodeLink}
              target="_blank"
              rel="noreferrer"
              className="next-episode-badge"
              onContextMenu={openEpisodeServerMenu}
            >
              {activeStatus === "CURRENT" ? "Next Episode" : "Watch Now"}
            </a>
          ) : null}
          <AvailabilityBadge entry={entry} availability={availability} activeStatus={activeStatus} watchNow={watchNow} alertIconId={alertIconId} onEdit={onAvailabilityOverride} />
        </div>
      </div>
      <div className="meta-pill-stack" aria-label="Anime metadata">
        <span className="meta-pill-slot">
          {metaIsAiring ? (
            <span className={forcedMetaAiring ? "airing-tag override" : "airing-tag"}>Airing</span>
          ) : isUnreleased(entry) ? (
            <span className="unreleased-tag">Unreleased</span>
          ) : year ? (
            <span className="year-tag">{year}</span>
          ) : null}
        </span>
        <span className="meta-pill-slot">
          {mediaFormat ? <span className="format-tag">{mediaFormat}</span> : null}
        </span>
        <span className="meta-pill-slot">
          {rating?.ratingLabel ? (
            <span className={`rating-tag ${ratingClass(rating.ratingLabel)}`} title={rating.rating || "MAL rating"}>{rating.ratingLabel}</span>
          ) : entry.isAdult ? (
            <span className="adult-tag">18+</span>
          ) : null}
        </span>
      </div>
      <ProgressControl
        entry={entry}
        onUpdate={onUpdate}
        onRefreshNeeded={onRefreshNeeded}
          shouldRefreshAtTotal={activeStatus !== "COMPLETED"}
          offlineMode={offlineMode}
        />
      <ScoreControl entry={entry} onUpdate={onUpdate} />
      {showNotes ? (
        <NoteControl entry={entry} onUpdate={onUpdate} onError={onNoteError} />
      ) : (
        <label className="row-control list-control">
          <span>List</span>
          <select
            className="status-select"
            value={activeStatus}
            disabled={moving || deleting}
            onChange={(event) => moveTo(event.target.value)}
            aria-label={`Move ${entry.title}`}
          >
            {LIST_STATUSES.map((status) => (
              <option value={status.value} key={status.value}>
                {status.label}
              </option>
            ))}
            <option value="__REMOVE__">Remove from list</option>
          </select>
        </label>
      )}
    </article>
  );
}

function AddSearchResultRow({ entry, availability, watchNow, alertIconId, showSynonymInfoIcon, onAdded, onPreviewFocus, previewFocused, offlineMode, onOpenWatchServerMenu }) {
  const [targetStatus, setTargetStatus] = useState("PLANNING");
  const [adding, setAdding] = useState(false);
  const year = entryYear(entry);
  const mediaFormat = formatLabel(entry.format);
  const publicScore = formatPublicScore(entry.publicScore);
  const listedStatus = entry.listStatus || entry.status;
  const detailsLink = detailsUrl(watchNow, entry);

  async function addEntry() {
    setAdding(true);
    try {
      const payload = await api(`/api/entries/${entry.mediaId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: targetStatus })
      });
      onAdded(entry.mediaId, payload.entry);
    } finally {
      setAdding(false);
    }
  }

  function openDetailsServerMenu(event) {
    event.preventDefault();
    event.stopPropagation();
    onOpenWatchServerMenu({
      ...linkMenuPosition(event),
      label: "Open Details With",
      options: buildDetailsServerOptions(watchNow, entry)
    });
  }

  return (
    <article className="entry-row add-search-row">
      <span className="select-cell" aria-hidden="true" />
      <button
        type="button"
        className={previewFocused ? "cover-preview focused-preview-open" : "cover-preview"}
        aria-label={`Preview cover for ${entry.title}`}
        onMouseEnter={(event) => updateHoverPreviewPosition(event.currentTarget)}
        onMouseLeave={(event) => resetHoverPreviewPosition(event.currentTarget)}
        onFocus={(event) => updateHoverPreviewPosition(event.currentTarget)}
        onBlur={(event) => resetHoverPreviewPosition(event.currentTarget)}
        onClick={(event) => onPreviewFocus(entry.mediaId, event)}
      >
        <img src={entry.coverImage || ""} alt="" className="cover" loading="lazy" />
        {publicScore ? <span className="cover-thumbnail-public-score">{publicScore}</span> : null}
        <span className="cover-preview-panel" aria-hidden="true">
          <EntryPreviewContent entry={entry} />
        </span>
      </button>
      <div className={`entry-main ${entry.nextAiringEpisode ? "has-airing-row" : ""}`}>
        <div className="title-line">
          {offlineMode ? (
          <span className="title-link offline-title">
            {entry.title}
          </span>
          ) : (
          <a href={entry.siteUrl} target="_blank" rel="noreferrer" className="title-link">
            {entry.title}
          </a>
          )}
        </div>
        <EntrySubtitle entry={entry} showSynonymInfoIcon={showSynonymInfoIcon} />
        {entry.nextAiringEpisode ? <div className="airing">{formatAiring(entry.nextAiringEpisode)}</div> : null}
        <div className="availability-line">
          {offlineMode ? (
          <span className="watch-now-badge disabled-link-badge">
            Details
          </span>
          ) : (
          <a href={detailsLink || entry.siteUrl} target="_blank" rel="noreferrer" className="watch-now-badge" onContextMenu={openDetailsServerMenu}>
            Details
          </a>
          )}
          <AvailabilityBadge entry={entry} availability={availability} activeStatus={ADD_STATUS} watchNow={watchNow} alertIconId={alertIconId} />
        </div>
      </div>
      <div className="meta-pill-stack" aria-label="Anime metadata">
        <span className="meta-pill-slot">
          {entry.isAiring ? (
            <span className="airing-tag">Airing</span>
          ) : isUnreleased(entry) ? (
            <span className="unreleased-tag">Unreleased</span>
          ) : year ? (
            <span className="year-tag">{year}</span>
          ) : null}
        </span>
        <span className="meta-pill-slot">
          {mediaFormat ? <span className="format-tag">{mediaFormat}</span> : null}
        </span>
        <span className="meta-pill-slot">
          {entry.isAdult ? <span className="adult-tag">18+</span> : null}
        </span>
      </div>
      <span aria-hidden="true" />
      <span aria-hidden="true" />
      {listedStatus ? (
        <div className="row-control add-result-control">
          <span>Already in</span>
          <strong>{statusLabel(listedStatus)}</strong>
        </div>
      ) : (
        <div className="row-control add-result-control">
          <span>Add to</span>
          <select className="status-select" value={targetStatus} disabled={adding} onChange={(event) => setTargetStatus(event.target.value)}>
            {LIST_STATUSES.map((status) => (
              <option value={status.value} key={status.value}>
                {status.label}
              </option>
            ))}
          </select>
          <button type="button" disabled={adding || offlineMode} onClick={addEntry}>
            {adding ? "Adding..." : "Add"}
          </button>
        </div>
      )}
    </article>
  );
}

function BulkMoveBar({ entries, selectedIds, activeStatus, onMoved, onClear }) {
  const [targetStatus, setTargetStatus] = useState("PLANNING");
  const [saving, setSaving] = useState(false);
  const isRemoving = targetStatus === "__REMOVE__";

  useEffect(() => {
    if (targetStatus === activeStatus) {
      setTargetStatus(LIST_STATUSES.find((status) => status.value !== activeStatus)?.value || "PLANNING");
    }
  }, [activeStatus, targetStatus]);

  if (selectedIds.size === 0) {
    return null;
  }

  async function applyMove() {
    const selectedEntries = entries.filter((entry) => selectedIds.has(entry.mediaId));
    if (isRemoving) {
      if (!window.confirm(`Remove ${selectedEntries.length} selected entries from your AniList completely?`)) {
        return;
      }
      setSaving(true);
      try {
        await api("/api/bulk/delete", {
          method: "POST",
          body: JSON.stringify({ entryIds: selectedEntries.map((entry) => entry.id) })
        });
        onMoved(Array.from(selectedIds));
      } finally {
        setSaving(false);
      }
      return;
    }

    setSaving(true);
    try {
      await api("/api/bulk/status", {
        method: "POST",
        body: JSON.stringify({ mediaIds: Array.from(selectedIds), status: targetStatus })
      });
      onMoved(Array.from(selectedIds));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="bulk-bar" aria-label="Bulk actions">
      <strong>{selectedIds.size} selected</strong>
      <select value={targetStatus} onChange={(event) => setTargetStatus(event.target.value)} aria-label="Bulk move target">
        {LIST_STATUSES.filter((status) => status.value !== activeStatus).map((status) => (
          <option value={status.value} key={status.value}>
            Move to {status.label}
          </option>
        ))}
        <option value="__REMOVE__">Remove from list</option>
      </select>
      <button type="button" disabled={saving} onClick={applyMove}>
        {saving ? (isRemoving ? "Removing..." : "Moving...") : isRemoving ? "Apply Remove" : "Apply Move"}
      </button>
      <button type="button" className="ghost-button" onClick={onClear}>
        Clear
      </button>
    </section>
  );
}

function AuthSettingsDialog({ open, onClose, onAuthChanged, settings, onSettingsChanged, offlineMode }) {
  const [auth, setAuth] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("auth");
  const [tokenInput, setTokenInput] = useState("");
  const [clientId, setClientId] = useState("");
  const [selectedServerId, setSelectedServerId] = useState("");
  const [hideWatchNow, setHideWatchNow] = useState(false);
  const [useAniListDetails, setUseAniListDetails] = useState(false);
  const [showUnwatchedDubAlert, setShowUnwatchedDubAlert] = useState(false);
  const [showUnwatchedSubAlert, setShowUnwatchedSubAlert] = useState(false);
  const [serverName, setServerName] = useState("");
  const [detailsUrlTemplate, setDetailsUrlTemplate] = useState("");
  const [watchUrlTemplate, setWatchUrlTemplate] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const watchNowServers = settings?.watchNow?.servers || [];
  const sortedWatchNowServers = useMemo(
    () => [...watchNowServers].sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" })),
    [watchNowServers]
  );

  function syncWatchNowControls(nextSettings = settings) {
    setSelectedServerId(nextSettings?.watchNow?.selectedServerId || "");
    setHideWatchNow(nextSettings?.watchNow?.hideWatchNow === true);
    setUseAniListDetails(nextSettings?.watchNow?.useAniListDetails === true);
    setShowUnwatchedDubAlert(nextSettings?.watchNow?.showUnwatchedDubAlert === true);
    setShowUnwatchedSubAlert(nextSettings?.watchNow?.showUnwatchedSubAlert === true);
  }

  function clearServerForm() {
    setServerName("");
    setDetailsUrlTemplate("");
    setWatchUrlTemplate("");
  }

  async function loadAuth() {
    setLoading(true);
    setError("");
    try {
      setAuth(await api("/api/auth"));
    } catch (authError) {
      setError(authError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) {
      setActiveTab("auth");
      setTokenInput("");
      setMessage("");
      syncWatchNowControls();
      clearServerForm();
      loadAuth();
    }
  }, [open]);

  useEffect(() => {
    if (open) {
      syncWatchNowControls(settings);
    }
  }, [settings?.watchNow, open]);

  if (!open) {
    return null;
  }

  async function saveToken() {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const payload = await api("/api/auth/token", {
        method: "POST",
        body: JSON.stringify({ token: tokenInput })
      });
      setAuth(payload);
      setTokenInput("");
      setMessage(payload.message || "Token saved.");
      await onAuthChanged();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  async function logout() {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const payload = await api("/api/auth/token", { method: "DELETE" });
      setAuth(payload);
      setMessage(payload.message || "Logged out.");
      await onAuthChanged();
    } catch (logoutError) {
      setError(logoutError.message);
    } finally {
      setSaving(false);
    }
  }

  async function importCliToken() {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const payload = await api("/api/auth/import-cli", { method: "POST" });
      setAuth(payload);
      setMessage(payload.message || "Imported token from anilist-cli.");
      await onAuthChanged();
    } catch (importError) {
      setError(importError.message);
    } finally {
      setSaving(false);
    }
  }

  function openAuthorizationLink() {
    if (offlineMode) {
      setError("Token authorization is disabled while Offline Mode is active.");
      return;
    }
    const normalizedClientId = clientId.trim();
    if (!/^\d+$/.test(normalizedClientId)) {
      setError("Enter the numeric AniList client ID first.");
      return;
    }
    setError("");
    window.open(
      `https://anilist.co/api/v2/oauth/authorize?client_id=${encodeURIComponent(normalizedClientId)}&response_type=token`,
      "_blank",
      "noreferrer"
    );
  }

  async function saveWatchNowSettings() {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const payload = await api("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({
          watchNow: {
            selectedServerId,
            hideWatchNow,
            useAniListDetails,
            showUnwatchedDubAlert,
            showUnwatchedSubAlert
          }
        })
      });
      onSettingsChanged(payload);
      syncWatchNowControls(payload);
      setMessage("Watch Now settings saved.");
    } catch (settingsError) {
      setError(settingsError.message);
    } finally {
      setSaving(false);
    }
  }

  async function addWatchNowServer() {
    const normalizedName = serverName.trim();
    const normalizedDetailsTemplate = detailsUrlTemplate.trim();
    const normalizedWatchTemplate = watchUrlTemplate.trim();
    if (!normalizedName) {
      setError("Enter a Watch Now server name.");
      return;
    }
    if (!templateHasMediaId(normalizedDetailsTemplate)) {
      setError("Details URL template must include <anilistid> or <malid>.");
      return;
    }
    if (!templateHasMediaId(normalizedWatchTemplate)
      || !normalizedWatchTemplate.toLowerCase().includes("<episode>")) {
      setError("Watch URL template must include <episode> and one of <anilistid> or <malid>.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    try {
      const payload = await api("/api/watch-now/servers", {
        method: "POST",
        body: JSON.stringify({
          name: normalizedName,
          detailsUrlTemplate: normalizedDetailsTemplate,
          watchUrlTemplate: normalizedWatchTemplate
        })
      });
      onSettingsChanged(payload);
      clearServerForm();
      setMessage("Watch Now server added.");
    } catch (settingsError) {
      setError(settingsError.message);
    } finally {
      setSaving(false);
    }
  }

  async function removeWatchNowServer(server) {
    if (!window.confirm(`Remove "${server.name}" from Watch Now servers?`)) {
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    try {
      const payload = await api(`/api/watch-now/servers/${encodeURIComponent(server.id)}`, { method: "DELETE" });
      onSettingsChanged(payload);
      syncWatchNowControls(payload);
      setMessage("Watch Now server removed.");
    } catch (settingsError) {
      setError(settingsError.message);
    } finally {
      setSaving(false);
    }
  }

  async function saveAppearance(nextAppearance) {
    const previousSettings = settings;
    const optimisticSettings = normalizeSettings({
      ...settings,
      appearance: {
        ...settings.appearance,
        ...nextAppearance
      }
    });
    onSettingsChanged(optimisticSettings);
    setSaving(true);
    setError("");
    setMessage("");
    try {
      onSettingsChanged(await api("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ appearance: nextAppearance })
      }));
      setMessage("Appearance updated.");
    } catch (settingsError) {
      onSettingsChanged(previousSettings);
      setError(settingsError.message);
    } finally {
      setSaving(false);
    }
  }

  async function saveUpdateSettings(nextUpdates) {
    const previousSettings = settings;
    const optimisticSettings = normalizeSettings({
      ...settings,
      updates: {
        ...settings.updates,
        ...nextUpdates
      }
    });
    onSettingsChanged(optimisticSettings);
    setSaving(true);
    setError("");
    setMessage("");
    try {
      onSettingsChanged(await api("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ updates: nextUpdates })
      }));
      setMessage("Update settings saved.");
    } catch (settingsError) {
      onSettingsChanged(previousSettings);
      setError(settingsError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="dialog-header">
          <h2 id="settings-title">Settings</h2>
          <button type="button" className="icon-close" onClick={onClose} aria-label="Close settings">
            x
          </button>
        </div>

        {message ? <div className="success-banner compact settings-status-banner">{message}</div> : null}

        <div className="settings-tabs" role="tablist" aria-label="Settings tabs">
          <button type="button" className={activeTab === "auth" ? "active" : ""} onClick={() => setActiveTab("auth")}>
            Authentication
          </button>
          <button type="button" className={activeTab === "watch" ? "active" : ""} onClick={() => setActiveTab("watch")}>
            Watch Now
          </button>
          <button type="button" className={activeTab === "appearance" ? "active" : ""} onClick={() => setActiveTab("appearance")}>
            Appearance
          </button>
          <button type="button" className={activeTab === "updates" ? "active" : ""} onClick={() => setActiveTab("updates")}>
            Updates
          </button>
        </div>

        {activeTab === "auth" ? (
          <div className="settings-tab-panel">
            <div className="settings-section">
              <h3>Authentication</h3>
              {loading ? <p>Checking auth...</p> : null}
              {!loading ? (
                <dl className="auth-summary">
                  <div>
                    <dt>Status</dt>
                    <dd>{auth?.valid ? `Signed in as ${auth.user?.name}` : auth?.tokenPresent ? "Token present but not valid" : "Token missing"}</dd>
                  </div>
                  <div>
                    <dt>Config</dt>
                    <dd>{auth?.configPath || "Not found"}</dd>
                  </div>
                </dl>
              ) : null}
              {auth?.authError ? <div className="inline-warning">{auth.authError}</div> : null}
              <div className="settings-actions">
                {auth?.cliImportAvailable && !auth?.portableTokenPresent ? (
                  <button type="button" disabled={offlineMode || saving} onClick={importCliToken}>
                    Import from anilist-cli
                  </button>
                ) : null}
                <button type="button" className="danger-button" disabled={saving || !auth?.tokenPresent} onClick={logout}>
                  Logout
                </button>
              </div>
            </div>

            <div className="settings-section">
              <h3>Create Token</h3>
              <p>Use redirect URL https://anilist.co/api/v2/oauth/pin when creating or editing the AniList API client.</p>
              <div className="settings-actions">
                <button type="button" disabled={offlineMode} onClick={() => window.open("https://anilist.co/login", "_blank", "noreferrer")}>
                  Open AniList Login
                </button>
                <button type="button" disabled={offlineMode} onClick={() => window.open("https://anilist.co/settings/developer", "_blank", "noreferrer")}>
                  Open AniList Developer Page
                </button>
              </div>
              <label className="field-stack">
                <span>Client ID</span>
                <input value={clientId} onChange={(event) => setClientId(event.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" />
              </label>
              <button type="button" className="token-auth-button" disabled={offlineMode} onClick={openAuthorizationLink}>
                Open token authorization link
              </button>
            </div>

            <div className="settings-section">
              <h3>Save Token</h3>
              <label className="field-stack">
                <span>New AniList token *</span>
                <textarea
                  value={tokenInput}
                  onChange={(event) => setTokenInput(event.target.value)}
                  placeholder="Paste token"
                  rows={4}
                  spellCheck="false"
                />
              </label>
              <button type="button" className="save-token-button" disabled={offlineMode || saving || tokenInput.trim().length === 0} onClick={saveToken}>
                {saving ? "Saving..." : "Save token"}
              </button>
            </div>
          </div>
        ) : activeTab === "watch" ? (
          <div className="settings-tab-panel">
            <div className="settings-section">
              <h3>Watch Now Links</h3>
              <label className="field-stack">
                <span>Active server</span>
                <select value={selectedServerId} onChange={(event) => setSelectedServerId(event.target.value)}>
                  <option value="">AniList Details fallback</option>
                  {sortedWatchNowServers.map((server) => (
                    <option value={server.id} key={server.id}>
                      {server.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="checkbox-row">
                <input type="checkbox" checked={hideWatchNow} onChange={(event) => setHideWatchNow(event.target.checked)} />
                Hide Watch Now episode links
              </label>
              <label className="checkbox-row">
                <input type="checkbox" checked={useAniListDetails} onChange={(event) => setUseAniListDetails(event.target.checked)} />
                Force use AniList for Details links
              </label>
              <button type="button" className="save-watch-settings-button" disabled={saving} onClick={saveWatchNowSettings}>
                {saving ? "Saving..." : "Save Watch Now settings"}
              </button>
            </div>

            <div className="settings-section">
              <h3>Servers</h3>
              {watchNowServers.length === 0 ? <p>No Watch Now servers saved.</p> : (
                <div className="watch-server-list">
                  {sortedWatchNowServers.map((server) => (
                    <div className="watch-server-item" key={server.id}>
                      <div className="watch-server-copy">
                        <strong>{server.name}</strong>
                        <span>Details <code>{server.detailsUrlTemplate}</code></span>
                        <span>Watch <code>{server.watchUrlTemplate}</code></span>
                      </div>
                      <button type="button" className="danger-button" disabled={saving} onClick={() => removeWatchNowServer(server)}>
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="settings-section">
              <h3>Add Server</h3>
              <label className="field-stack">
                <span>Name</span>
                <input value={serverName} onChange={(event) => setServerName(event.target.value)} placeholder="My server" />
              </label>
              <label className="field-stack">
                <span>Details URL template</span>
                <input
                  value={detailsUrlTemplate}
                  onChange={(event) => setDetailsUrlTemplate(event.target.value)}
                  placeholder="https://example.com/anime/<anilistid>"
                />
              </label>
              <label className="field-stack">
                <span>Watch URL template</span>
                <input
                  value={watchUrlTemplate}
                  onChange={(event) => setWatchUrlTemplate(event.target.value)}
                  placeholder="https://example.com/watch/<malid>?ep=<episode>"
                />
              </label>
              <button type="button" className="add-server-button" disabled={saving} onClick={addWatchNowServer}>
                {saving ? "Saving..." : "Add server"}
              </button>
            </div>
          </div>
        ) : activeTab === "appearance" ? (
          <div className="settings-tab-panel">
            <div className="settings-section">
              <h3>Color Mode</h3>
              <div className="appearance-options" role="group" aria-label="Color mode">
                {COLOR_MODES.map((mode) => (
                  <button
                    type="button"
                    className={settings.appearance.colorMode === mode.value ? "appearance-option active" : "appearance-option"}
                    disabled={saving}
                    onClick={() => saveAppearance({ colorMode: mode.value })}
                    key={mode.value}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="settings-section">
              <h3>Accent Theme</h3>
              <div className="appearance-options accent-options" role="group" aria-label="Accent theme">
                {ACCENT_THEMES.map((theme) => (
                  <button
                    type="button"
                    className={settings.appearance.accentTheme === theme.value ? "appearance-option accent-option active" : "appearance-option accent-option"}
                    data-accent-preview={theme.value}
                    disabled={saving}
                    onClick={() => saveAppearance({ accentTheme: theme.value })}
                    key={theme.value}
                  >
                    <span className="accent-swatch" aria-hidden="true" />
                    {theme.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="settings-section">
              <h3>Alert Icon</h3>
              <div className="appearance-options alert-icon-options" role="group" aria-label="Alert icon">
                {ALERT_ICON_OPTIONS.map((option) => (
                  <button
                    type="button"
                    className={settings.appearance.alertIcon === option.value ? "appearance-option alert-icon-option active" : "appearance-option alert-icon-option"}
                    disabled={saving}
                    onClick={() => saveAppearance({ alertIcon: option.value })}
                    key={option.value}
                  >
                    <AvailabilityAlertIcon label={`${option.label} alert icon preview`} iconId={option.value} />
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="settings-section">
              <h3>Watch Now Links</h3>
              <label className="checkbox-row">
                <input type="checkbox" checked={showUnwatchedDubAlert} onChange={(event) => setShowUnwatchedDubAlert(event.target.checked)} />
                Show alert when unwatched dub is available
              </label>
              <label className="checkbox-row">
                <input type="checkbox" checked={showUnwatchedSubAlert} onChange={(event) => setShowUnwatchedSubAlert(event.target.checked)} />
                Show alert when unwatched sub is available
              </label>
              <button type="button" className="save-watch-settings-button" disabled={saving} onClick={saveWatchNowSettings}>
                {saving ? "Saving..." : "Save alert settings"}
              </button>
            </div>
            <div className="settings-section">
              <h3>Synonyms</h3>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={settings.appearance.showSynonymInfoIcon}
                  disabled={saving}
                  onChange={(event) => saveAppearance({ showSynonymInfoIcon: event.target.checked })}
                />
                Show info icon for synonyms
              </label>
            </div>
          </div>
        ) : null}

        {activeTab === "updates" ? (
          <div className="settings-tab-panel">
            <div className="settings-section">
              <h3>Updates</h3>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={settings.updates.autoCheckEnabled}
                  disabled={saving}
                  onChange={(event) => saveUpdateSettings({ autoCheckEnabled: event.target.checked })}
                />
                Check daily for updates
              </label>
            </div>
          </div>
        ) : null}

        {error ? <div className="error-banner compact">{error}</div> : null}
      </section>
    </div>
  );
}

function AboutDialog({ open, onClose, updateInfo, onLoadUpdate, onCheckUpdate, onIgnoreUpdate }) {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeView, setActiveView] = useState("about");
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateMessage, setUpdateMessage] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }
    setActiveView("about");
    setUpdateMessage("");
    setLoading(true);
    setError("");
    setContent("");
    onLoadUpdate?.();
    api("/api/readme")
      .then((payload) => {
        setContent(parseMarkdown(payload.content || ""));
      })
      .catch((err) => {
        setError(err.message || "Failed to load README.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [open]);

  if (!open) {
    return null;
  }

  async function checkForUpdates() {
    setUpdateBusy(true);
    setUpdateMessage("");
    try {
      const payload = await onCheckUpdate();
      setUpdateMessage(payload?.updateAvailable ? "Update information refreshed." : "You are on the latest available version.");
    } catch (checkError) {
      setUpdateMessage(checkError.message || "Could not check for updates.");
    } finally {
      setUpdateBusy(false);
    }
  }

  async function ignoreUpdate() {
    setUpdateBusy(true);
    setUpdateMessage("");
    try {
      await onIgnoreUpdate();
      setUpdateMessage("This update has been ignored.");
    } catch (ignoreError) {
      setUpdateMessage(ignoreError.message || "Could not ignore this update.");
    } finally {
      setUpdateBusy(false);
    }
  }

  const updateAvailable = updateInfo?.updateAvailable === true;
  const releaseNotes = updateInfo?.releaseNotes ? parseMarkdown(updateInfo.releaseNotes) : "";
  const releaseDate = formatUpdateDate(updateInfo?.publishedAt);
  const latestVersion = updateInfo?.latestTagName || (updateInfo?.latestVersion ? `v${updateInfo.latestVersion}` : "Unknown");

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="about-dialog" role="dialog" aria-modal="true" aria-labelledby="about-dialog-title">
        <div className="dialog-header">
          <div className="dialog-title-row">
            <h2 id="about-dialog-title">About</h2>
            <span className="app-version">{APP_VERSION}</span>
          </div>
          <button type="button" className="update-info-toggle" onClick={() => setActiveView(activeView === "update" ? "about" : "update")}>
            {activeView === "update" ? "View About" : "View Update Info"}
          </button>
          <button type="button" className="icon-close" onClick={onClose} aria-label="Close about">
            x
          </button>
        </div>
        <div className="about-dialog-body">
          {activeView === "about" ? (
            <>
              {loading ? <p className="about-loading">Loading…</p> : null}
              {error ? <div className="error-banner compact">{error}</div> : null}
              {!loading && !error && content ? (
                <div className="readme-content" dangerouslySetInnerHTML={{ __html: content }} />
              ) : null}
            </>
          ) : (
            <section className="update-info-view">
              <div className={updateAvailable ? "success-banner compact" : "inline-warning"}>
                {updateAvailable ? "A newer version is available." : updateInfo?.error ? "Could not check updates." : "No update is currently available."}
              </div>
              {updateMessage ? <div className="success-banner compact">{updateMessage}</div> : null}
              {updateInfo?.error ? <div className="error-banner compact">{updateInfo.error}</div> : null}

              <dl className="update-summary">
                <div>
                  <dt>Installed version</dt>
                  <dd>v{updateInfo?.currentVersion || APP_VERSION.replace(/^v/i, "")}</dd>
                </div>
                <div>
                  <dt>{updateAvailable ? "Latest version" : "GitHub release"}</dt>
                  <dd>{latestVersion}</dd>
                </div>
                {releaseDate ? (
                  <div>
                    <dt>Release date</dt>
                    <dd>{releaseDate}</dd>
                  </div>
                ) : null}
              </dl>

              <div className="settings-actions update-actions">
                {updateInfo?.releaseUrl ? (
                  <button type="button" onClick={() => window.open(updateInfo.releaseUrl, "_blank", "noreferrer")}>
                    View Release
                  </button>
                ) : null}
                {updateAvailable && updateInfo?.downloadUrl ? (
                  <button type="button" onClick={() => window.open(updateInfo.downloadUrl, "_blank", "noreferrer")}>
                    Download ZIP
                  </button>
                ) : null}
                {!updateAvailable ? (
                  <button type="button" disabled={updateBusy} onClick={checkForUpdates}>
                    {updateBusy ? "Checking..." : "Check for Updates"}
                  </button>
                ) : null}
                {updateAvailable ? (
                  <button type="button" className="ghost-button" disabled={updateBusy || updateInfo?.ignored} onClick={ignoreUpdate}>
                    {updateInfo?.ignored ? "Update Ignored" : updateBusy ? "Ignoring..." : "Ignore this update"}
                  </button>
                ) : null}
              </div>

              {updateAvailable ? (
                <div className="settings-section update-instructions">
                  <h3>Update Instructions</h3>
                  <ol>
                    <li>Download the ZIP from the release.</li>
                    <li>Exit AniList Manager Portable from the tray menu.</li>
                    <li>Replace <code>AniListManagerPortable.exe</code> and <code>README.md</code> with the files from the ZIP.</li>
                    <li>Keep the existing <code>data\</code> folder untouched.</li>
                    <li>Restart AniList Manager Portable.</li>
                  </ol>
                </div>
              ) : null}

              <div className="readme-content update-release-notes">
                <h2>Release Notes</h2>
                {releaseNotes ? (
                  <div dangerouslySetInnerHTML={{ __html: releaseNotes }} />
                ) : (
                  <p>No release notes are available yet.</p>
                )}
              </div>
            </section>
          )}
        </div>
      </section>
    </div>
  );
}

function App() {
  const [activeStatus, setActiveStatus] = useState("CURRENT");
  const [entries, setEntries] = useState([]);
  const [user, setUser] = useState(null);
  const [health, setHealth] = useState(null);
  const [offline, setOffline] = useState({ enabled: false, queued: 0 });
  const [offlineBusy, setOfflineBusy] = useState(false);
  const [offlineProgress, setOfflineProgress] = useState("");
  const [offlineNotice, setOfflineNotice] = useState(null);
  const [offlineQueueOpen, setOfflineQueueOpen] = useState(false);
  const [offlineQueue, setOfflineQueue] = useState({ queued: 0, items: [] });
  const [offlineQueueLoading, setOfflineQueueLoading] = useState(false);
  const [offlineQueueError, setOfflineQueueError] = useState("");
  const [offlineDisableOpen, setOfflineDisableOpen] = useState(false);
  const [offlineSyncFailures, setOfflineSyncFailures] = useState([]);
  const [settings, setSettings] = useState(() => defaultSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState("");
  const [exportNotice, setExportNotice] = useState(null);
  const [refreshChoiceOpen, setRefreshChoiceOpen] = useState(false);
  const [overrideTarget, setOverrideTarget] = useState(null);
  const [watchServerMenu, setWatchServerMenu] = useState(null);
  const [query, setQuery] = useState("");
  const [addQuery, setAddQuery] = useState("");
  const [addSearchResults, setAddSearchResults] = useState([]);
  const [addSearchLoading, setAddSearchLoading] = useState(false);
  const [addSearchError, setAddSearchError] = useState("");
  const [addSearchNotice, setAddSearchNotice] = useState("");
  const [addSearchLimit, setAddSearchLimit] = useState("100");
  const [addTitleOnly, setAddTitleOnly] = useState(false);
  const [addDubOnly, setAddDubOnly] = useState(false);
  const [addAvailabilityReady, setAddAvailabilityReady] = useState(false);
  const [availability, setAvailability] = useState({});
  const [ratings, setRatings] = useState({});
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityProgress, setAvailabilityProgress] = useState({ checked: 0, total: 0 });
  const [availabilityWarning, setAvailabilityWarning] = useState("");
  const [showNotes, setShowNotes] = useState(() => defaultSettings().showNotes);
  const [completeOnly, setCompleteOnly] = useState(false);
  const [incompleteOnly, setIncompleteOnly] = useState(false);
  const [dubOnly, setDubOnly] = useState(false);
  const [unwatchedAlertOnly, setUnwatchedAlertOnly] = useState(false);
  const [sortOrder, setSortOrder] = useState("english");
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [updatingCompletedProgress, setUpdatingCompletedProgress] = useState(false);
  const [completedProgressUpdate, setCompletedProgressUpdate] = useState({ checked: 0, total: 0 });
  const [focusedPreviewId, setFocusedPreviewId] = useState(null);
  const [focusedPreviewOrigin, setFocusedPreviewOrigin] = useState(null);
  const [error, setError] = useState("");
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches === true);
  const listRunId = useRef(0);
  const listAbortController = useRef(null);
  const addSearchRunId = useRef(0);
  const availabilityRunId = useRef(0);
  const availabilityAbortController = useRef(null);
  const ratingRunId = useRef(0);
  const ratingAbortController = useRef(null);
  const completedProgressAbortController = useRef(null);
  const scrollRestoreRunId = useRef(0);
  const offlineQueueRef = useRef(null);
  const alertsFilterEnabled = settings.watchNow.showUnwatchedDubAlert === true || settings.watchNow.showUnwatchedSubAlert === true;
  const activeUnwatchedAlertOnly = unwatchedAlertOnly && alertsFilterEnabled;
  const isAddTab = activeStatus === ADD_STATUS;
  const offlineEnabled = offline?.enabled === true;
  const showUpdateMarker = updateInfo?.updateAvailable === true && updateInfo?.ignored !== true;

  async function load(status = activeStatus) {
    if (status === ADD_STATUS) {
      setLoading(false);
      return;
    }
    const runId = listRunId.current + 1;
    listRunId.current = runId;
    listAbortController.current?.abort();
    const abortController = new AbortController();
    listAbortController.current = abortController;
    setLoading(true);
    setError("");
    try {
      const healthPayload = await api("/api/health", { signal: abortController.signal });
      if (listRunId.current !== runId) {
        return;
      }
      setHealth(healthPayload);
      setOffline(healthPayload.offline || { enabled: false, queued: 0 });
      if (!healthPayload.tokenPresent && healthPayload.offline?.enabled !== true) {
        setUser(null);
        setEntries([]);
        setAvailability({});
        setAvailabilityProgress({ checked: 0, total: 0 });
        setAvailabilityWarning("");
        setSelectedIds(new Set());
        setError(healthPayload.cliImportAvailable
          ? "AniList token is missing. Open Settings to import your anilist-cli token or save a new token."
          : "AniList token is missing. Open Settings to save a token.");
        return;
      }

      const listPayload = await api(`/api/lists?status=${encodeURIComponent(status)}&type=ANIME`, { signal: abortController.signal });
      if (listRunId.current !== runId) {
        return;
      }
      setUser(listPayload.user);
      setEntries(listPayload.entries);
      setOffline(listPayload.offline ? { ...(healthPayload.offline || {}), enabled: true, queued: listPayload.queued ?? healthPayload.offline?.queued ?? 0 } : healthPayload.offline || { enabled: false, queued: 0 });
      setAvailability(listPayload.availability || {});
      setRatings(listPayload.ratings || {});
      setAvailabilityProgress({ checked: 0, total: 0 });
      setAvailabilityWarning("");
      setSelectedIds(new Set());
      if (!listPayload.offline) {
        const cacheOnly = hasRecentAutoAvailability(status);
        if (!cacheOnly) {
          markAutoAvailability(status);
        }
        loadAvailability(listPayload.entries, false, { cacheOnly });
        loadRatings(listPayload.entries);
      }
    } catch (loadError) {
      if (loadError.name === "AbortError" || listRunId.current !== runId) {
        return;
      }
      setEntries([]);
      setAvailability({});
      setAvailabilityProgress({ checked: 0, total: 0 });
      setAvailabilityWarning("");
      setSelectedIds(new Set());
      setError(loadError.message);
    } finally {
      if (listRunId.current === runId) {
        setLoading(false);
        listAbortController.current = null;
      }
    }
  }

  function switchStatus(status) {
    if (status === activeStatus) {
      return;
    }
    if (offlineEnabled && status === ADD_STATUS) {
      setAvailabilityWarning("Add search is disabled while Offline Mode is active.");
      return;
    }

    listRunId.current += 1;
    listAbortController.current?.abort();
    listAbortController.current = null;
    addSearchRunId.current += 1;
    availabilityRunId.current += 1;
    availabilityAbortController.current?.abort();
    availabilityAbortController.current = null;
    ratingRunId.current += 1;
    ratingAbortController.current?.abort();
    ratingAbortController.current = null;
    completedProgressAbortController.current?.abort();
    completedProgressAbortController.current = null;

    setLoading(status !== ADD_STATUS);
    setEntries([]);
    if (status === ADD_STATUS) {
      setAddSearchResults([]);
      setAddSearchError("");
      setAddSearchNotice("");
      setAddDubOnly(false);
      setAddAvailabilityReady(false);
    }
    setAvailability({});
    setAvailabilityLoading(false);
    setAvailabilityProgress({ checked: 0, total: 0 });
    setAvailabilityWarning("");
    setSelectedIds(new Set());
    setRefreshChoiceOpen(false);
    setOverrideTarget(null);
    setWatchServerMenu(null);
    setUpdatingCompletedProgress(false);
    setCompletedProgressUpdate({ checked: 0, total: 0 });
    setFocusedPreviewId(null);
    setFocusedPreviewOrigin(null);
    setError("");
    setActiveStatus(status);
  }

  async function loadSettings() {
    try {
      const settingsPayload = await api("/api/settings");
      const nextSettings = normalizeSettings(settingsPayload);
      setSettings(nextSettings);
      if (settingsPayload.offline) {
        setOffline(settingsPayload.offline);
      }
      setShowNotes(nextSettings.showNotes);
    } catch {
      const fallbackSettings = defaultSettings();
      setSettings(fallbackSettings);
      setShowNotes(fallbackSettings.showNotes);
    }
  }

  async function loadUpdateInfo() {
    try {
      setUpdateInfo(await api("/api/update"));
    } catch (updateError) {
      console.warn("Update info failed.", updateError);
    }
  }

  async function checkUpdateInfo() {
    const payload = await api("/api/update/check", { method: "POST" });
    setUpdateInfo(payload);
    return payload;
  }

  async function ignoreUpdateInfo() {
    const payload = await api("/api/update/ignore", { method: "POST" });
    setUpdateInfo(payload);
    return payload;
  }

  useEffect(() => {
    loadSettings();
    loadUpdateInfo();
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mediaQuery) {
      return undefined;
    }
    function updateSystemMode(event) {
      setSystemDark(event.matches);
    }
    mediaQuery.addEventListener("change", updateSystemMode);
    return () => mediaQuery.removeEventListener("change", updateSystemMode);
  }, []);

  useEffect(() => {
    const appearance = settings.appearance || defaultSettings().appearance;
    const resolvedMode = appearance.colorMode === "system"
      ? (systemDark ? "dark" : "light")
      : appearance.colorMode;
    document.documentElement.dataset.colorMode = resolvedMode;
    document.documentElement.dataset.appearanceMode = appearance.colorMode;
    document.documentElement.dataset.accentTheme = appearance.accentTheme;
  }, [settings.appearance, systemDark]);

  async function toggleNotesMode() {
    const nextShowNotes = !showNotes;
    setShowNotes(nextShowNotes);
    try {
      const nextSettings = normalizeSettings(await api("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ showNotes: nextShowNotes })
      }));
      setSettings(nextSettings);
      setShowNotes(nextSettings.showNotes);
    } catch (settingsError) {
      setShowNotes(!nextShowNotes);
      setError(settingsError.message);
    }
  }

  async function loadAvailability(entriesToCheck = entries, refresh = false, options = {}) {
    if (offlineEnabled) {
      return true;
    }
    const runId = availabilityRunId.current + 1;
    availabilityRunId.current = runId;
    availabilityAbortController.current?.abort();
    const abortController = new AbortController();
    availabilityAbortController.current = abortController;

    const showProgress = !options.background;
    const forceRefresh = options.force === true;
    const cacheOnly = options.cacheOnly === true;
    setAvailabilityLoading(showProgress);
    setAvailabilityProgress({ checked: 0, total: showProgress ? entriesToCheck.length : 0 });
    setAvailabilityWarning("");
    try {
      let index = 0;
      while (index < entriesToCheck.length) {
        const chunk = entriesToCheck.slice(index, index + AVAILABILITY_CHUNK_SIZE);
        const payload = await api("/api/availability/batch", {
          method: "POST",
          signal: abortController.signal,
          body: JSON.stringify({
            refresh,
            force: forceRefresh,
            cacheOnly,
            entries: chunk.map((entry) => ({
              mediaId: entry.mediaId,
              malId: entry.malId,
              status: entry.status,
              title: entry.title,
              romajiTitle: entry.romajiTitle,
              englishTitle: entry.englishTitle,
              nativeTitle: entry.nativeTitle,
              synonyms: entry.synonyms || [],
              endDate: entry.endDate,
              format: entry.format,
              mediaStatus: entry.mediaStatus,
              totalEpisodes: entry.totalEpisodes
            }))
          })
        });
        if (availabilityRunId.current !== runId) {
          return false;
        }
        setAvailability((currentAvailability) => ({
          ...currentAvailability,
          ...Object.fromEntries(payload.entries.map((entry) => [entry.mediaId, entry]))
        }));
        if (showProgress) {
          const completedEntries = Number(payload.checked || 0) + Number(payload.cached || 0);
          setAvailabilityLoading(true);
          setAvailabilityProgress({
            checked: Math.min(index + Math.max(completedEntries, payload.entries?.length || chunk.length), entriesToCheck.length),
            total: entriesToCheck.length
          });
        }
        index += chunk.length;
        if (payload.rateLimited) {
          setAvailabilityWarning("Availability provider is rate limited. Results may be slower or incomplete.");
        }
      }
      return true;
    } catch (availabilityError) {
      if (availabilityRunId.current === runId) {
        if (availabilityError.name !== "AbortError") {
          setAvailabilityWarning(availabilityError.message);
        }
      }
      return false;
    } finally {
      if (availabilityRunId.current === runId) {
        setAvailabilityLoading(false);
        availabilityAbortController.current = null;
      }
    }
  }

  async function loadRatings(entriesToCheck = entries) {
    if (offlineEnabled) {
      return;
    }
    const ratingEntries = entriesToCheck.filter((entry) => entry.malId);
    const runId = ratingRunId.current + 1;
    ratingRunId.current = runId;
    ratingAbortController.current?.abort();
    const abortController = new AbortController();
    ratingAbortController.current = abortController;

    try {
      const savedPayload = await api("/api/ratings/batch", {
        method: "POST",
        signal: abortController.signal,
        body: JSON.stringify({
          cacheOnly: true,
          entries: ratingEntries.map((entry) => ({
            mediaId: entry.mediaId,
            malId: entry.malId
          }))
        })
      });
      if (ratingRunId.current !== runId) {
        return;
      }
      setRatings((currentRatings) => ({
        ...currentRatings,
        ...Object.fromEntries(savedPayload.entries.map((entry) => [entry.mediaId, entry]))
      }));

      const savedMediaIds = new Set(savedPayload.entries.map((entry) => entry.mediaId));
      const missingRatingEntries = ratingEntries.filter((entry) => !savedMediaIds.has(entry.mediaId));
      for (let index = 0; index < missingRatingEntries.length; index += RATING_CHUNK_SIZE) {
        const chunk = missingRatingEntries.slice(index, index + RATING_CHUNK_SIZE);
        const payload = await api("/api/ratings/batch", {
          method: "POST",
          signal: abortController.signal,
          body: JSON.stringify({
            entries: chunk.map((entry) => ({
              mediaId: entry.mediaId,
              malId: entry.malId
            }))
          })
        });
        if (ratingRunId.current !== runId) {
          return;
        }
        setRatings((currentRatings) => ({
          ...currentRatings,
          ...Object.fromEntries(payload.entries.map((entry) => [entry.mediaId, entry]))
        }));
        if (payload.rateLimited) {
          return;
        }
        if (index + RATING_CHUNK_SIZE < missingRatingEntries.length) {
          await sleep(RATING_BATCH_DELAY_MS, abortController.signal);
        }
      }
    } catch (ratingError) {
      if (ratingError.name !== "AbortError") {
        console.warn("Rating lookup failed.", ratingError);
      }
    } finally {
      if (ratingRunId.current === runId) {
        ratingAbortController.current = null;
      }
    }
  }

  function cancelAvailabilityRefresh() {
    availabilityRunId.current += 1;
    availabilityAbortController.current?.abort();
    availabilityAbortController.current = null;
    setAvailabilityLoading(false);
  }

  function startAvailabilityRefresh(mode) {
    const targets = actionTargetEntries();
    const entriesToRefresh = mode === "missing"
      ? targets.filter((entry) => isAvailabilityMissing(availability[entry.mediaId]))
      : mode === "airing"
        ? targets.filter((entry) => shouldRefreshAiringAvailability(entry, availability[entry.mediaId]))
        : targets;
    setRefreshChoiceOpen(false);
    if (entriesToRefresh.length === 0) {
      setAvailabilityWarning(mode === "airing"
        ? "No airing or dub-behind-sub availability entries in the current target set."
        : "No missing availability entries in the current target set.");
      return;
    }
    loadAvailability(entriesToRefresh, true, { force: true });
  }

  async function recheckEpisodes() {
    if (offlineEnabled) {
      setAvailabilityWarning("Recheck Episodes is disabled while Offline Mode is active.");
      return;
    }
    if (isAddTab) {
      setAddAvailabilityReady(false);
      const completed = await loadAvailability(sortedAddSearchResults, true, { force: true });
      setAddAvailabilityReady(completed && sortedAddSearchResults.length > 0);
      return;
    }
    setRefreshChoiceOpen(true);
  }

  async function saveAvailabilityOverride(entry, values) {
    const payload = await api(`/api/availability/overrides/${entry.mediaId}`, {
      method: "PUT",
      body: JSON.stringify(values)
    });
    setAvailability((currentAvailability) => ({
      ...currentAvailability,
      [entry.mediaId]: payload.availability
    }));
    setOverrideTarget(null);
    refreshOfflineStatus();
  }

  async function removeAvailabilityOverride(entry) {
    await api(`/api/availability/overrides/${entry.mediaId}`, { method: "DELETE" });
    setOverrideTarget(null);
    setAvailability((currentAvailability) => {
      const nextAvailability = { ...currentAvailability };
      delete nextAvailability[entry.mediaId];
      return nextAvailability;
    });
    if (!offlineEnabled) {
      loadAvailability([entry], true, { force: true, background: true });
    }
    refreshOfflineStatus();
  }

  async function refreshOfflineStatus() {
    try {
      setOffline(await api("/api/offline"));
      if (offlineQueueOpen) {
        loadOfflineQueue();
      }
    } catch {
      setOffline({ enabled: false, queued: 0 });
    }
  }

  async function loadOfflineQueue() {
    if (!offlineEnabled) {
      setOfflineQueue({ queued: 0, items: [] });
      return;
    }
    setOfflineQueueLoading(true);
    setOfflineQueueError("");
    try {
      const payload = await api("/api/offline/queue");
      setOfflineQueue({
        queued: Number(payload.queued || 0),
        items: Array.isArray(payload.items) ? payload.items : []
      });
    } catch (queueError) {
      setOfflineQueueError(queueError.message);
    } finally {
      setOfflineQueueLoading(false);
    }
  }

  function toggleOfflineQueue() {
    if (!offlineEnabled) {
      return;
    }
    setOfflineQueueOpen((open) => !open);
  }

  async function enableOfflineMode() {
    if (!window.confirm("Enable Offline Mode? All lists and cover images will be packaged locally. Missing cached availability or ratings will be reported after packaging.")) {
      return;
    }
    setOfflineBusy(true);
    setOfflineNotice(null);
    setOfflineProgress("Starting Offline Mode packaging...");
    setError("");
    try {
      const started = await api("/api/offline/enable", { method: "POST" });
      let job = started;
      while (job.state !== "completed" && job.state !== "error") {
        setOfflineProgress(job.message || "Packaging offline data...");
        await sleep(800);
        job = await api(`/api/offline/enable/${encodeURIComponent(job.jobId)}`);
      }
      if (job.state === "error") {
        throw new Error(job.error || job.message || "Offline Mode packaging failed.");
      }
      const status = job.result || await api("/api/offline");
      setOffline(status);
      const warnings = [];
      if (Number(status.missingAvailability) > 0) {
        warnings.push(`availability missing for ${status.missingAvailability} entries`);
      }
      if (Number(status.missingRatings) > 0) {
        warnings.push(`ratings missing for ${status.missingRatings} entries`);
      }
      if (Number(status.imageFailures) > 0) {
        warnings.push(`${status.imageFailures} cover images missing`);
      }
      setOfflineNotice({
        type: warnings.length > 0 ? "warning" : "success",
        text: warnings.length > 0
          ? `Offline Mode enabled; ${warnings.join("; ")}. Run Recheck Episodes before enabling next time to improve cached metadata.`
          : `Offline Mode enabled with ${status.entryCount || 0} packaged entries.`
      });
      if (activeStatus === ADD_STATUS) {
        switchStatus("CURRENT");
      } else {
        await load(activeStatus);
      }
    } catch (offlineError) {
      setError(offlineError.message);
    } finally {
      setOfflineBusy(false);
      setOfflineProgress("");
    }
  }

  async function disableOfflineMode() {
    const queued = Number(offline?.queued || 0);
    if (queued > 0) {
      setOfflineDisableOpen(true);
      return;
    }
    await finishOfflineDisable({ discardQueued: false });
  }

  async function syncQueuedThenDisable() {
    setOfflineDisableOpen(false);
    setOfflineSyncFailures([]);
    setOfflineBusy(true);
    setOfflineNotice(null);
    setOfflineProgress("Syncing queued edits...");
    setError("");
    try {
      const syncPayload = await api("/api/offline/sync", { method: "POST" });
      if (Number(syncPayload.failed || 0) > 0) {
        setOfflineSyncFailures(Array.isArray(syncPayload.failures) ? syncPayload.failures : []);
        setOffline(await api("/api/offline"));
        await load(activeStatus === ADD_STATUS ? "CURRENT" : activeStatus);
        return;
      }
      await finishOfflineDisable({ discardQueued: false, syncPayload });
    } catch (offlineError) {
      setError(offlineError.message);
    } finally {
      setOfflineBusy(false);
      setOfflineProgress("");
    }
  }

  async function discardQueuedThenDisable() {
    setOfflineDisableOpen(false);
    setOfflineSyncFailures([]);
    await finishOfflineDisable({ discardQueued: true });
  }

  async function stayOfflineAfterSyncFailure() {
    setOfflineSyncFailures([]);
    await refreshOfflineStatus();
    await load(activeStatus === ADD_STATUS ? "CURRENT" : activeStatus);
  }

  async function finishOfflineDisable({ discardQueued, syncPayload = null }) {
    const removeData = window.confirm("Remove packaged offline data after Offline Mode is disabled?");
    setOfflineBusy(true);
    setOfflineNotice(null);
    setOfflineProgress("Turning off Offline Mode...");
    setError("");
    try {
      const payload = await api("/api/offline/disable", {
        method: "POST",
        body: JSON.stringify({ discardQueued, removeData })
      });
      setOffline(payload);
      setOfflineNotice({
        type: "success",
        text: syncPayload
          ? `Offline Mode disabled. Synced ${syncPayload.synced || 0} queued edit${syncPayload.synced === 1 ? "" : "s"}.`
          : discardQueued
            ? "Offline Mode disabled. Queued edits were discarded."
          : "Offline Mode disabled."
      });
      await load(activeStatus === ADD_STATUS ? "CURRENT" : activeStatus);
    } catch (offlineError) {
      setError(offlineError.message);
    } finally {
      setOfflineBusy(false);
      setOfflineProgress("");
    }
  }

  function toggleOfflineMode() {
    if (offlineEnabled) {
      disableOfflineMode();
    } else {
      enableOfflineMode();
    }
  }

  useEffect(() => {
    if (!offlineEnabled && offlineQueueOpen) {
      setOfflineQueueOpen(false);
      setOfflineQueue({ queued: 0, items: [] });
    }
  }, [offlineEnabled, offlineQueueOpen]);

  useEffect(() => {
    if (offlineQueueOpen) {
      loadOfflineQueue();
    }
  }, [offlineQueueOpen, offlineEnabled, offline?.queued]);

  useEffect(() => {
    if (!offlineQueueOpen) {
      return undefined;
    }

    function closeQueuePopover(event) {
      if (event.key === "Escape") {
        setOfflineQueueOpen(false);
        return;
      }
      if (event.type === "mousedown" && offlineQueueRef.current && !offlineQueueRef.current.contains(event.target)) {
        setOfflineQueueOpen(false);
      }
    }

    document.addEventListener("mousedown", closeQueuePopover);
    document.addEventListener("keydown", closeQueuePopover);
    return () => {
      document.removeEventListener("mousedown", closeQueuePopover);
      document.removeEventListener("keydown", closeQueuePopover);
    };
  }, [offlineQueueOpen]);

  useEffect(() => {
    if (activeStatus !== ADD_STATUS) {
      load(activeStatus);
    }
  }, [activeStatus]);

  useEffect(() => {
    if (!alertsFilterEnabled && unwatchedAlertOnly) {
      setUnwatchedAlertOnly(false);
    }
  }, [alertsFilterEnabled, unwatchedAlertOnly]);

  const filteredEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = entries.filter((entry) => {
      const matchesQuery = !normalizedQuery ||
        [entry.title, entry.romajiTitle, entry.nativeTitle, entry.notes].filter(Boolean).some((value) => value.toLowerCase().includes(normalizedQuery));
      const matchesComplete = !completeOnly || isAvailabilityComplete(availability[entry.mediaId]);
      const matchesIncomplete = !incompleteOnly || isAvailabilityIncomplete(availability[entry.mediaId]);
      const matchesDub = !dubOnly || Number(availability[entry.mediaId]?.dubEpisodes || 0) > 0;
      const matchesUnwatchedAlert = !activeUnwatchedAlertOnly || Boolean(availabilityAlertState(entry, availability[entry.mediaId], activeStatus, settings.watchNow).label);
      return matchesQuery && matchesComplete && matchesIncomplete && matchesDub && matchesUnwatchedAlert;
    });
    return [...filtered].sort((a, b) => {
      const availabilityA = availability[a.mediaId] || {};
      const availabilityB = availability[b.mediaId] || {};
      if (sortOrder === "romaji") {
        return (a.romajiTitle || a.title).localeCompare(b.romajiTitle || b.title);
      }
      if (sortOrder === "year") {
        return (entryYear(b) || 0) - (entryYear(a) || 0) || a.title.localeCompare(b.title);
      }
      if (sortOrder === "progress") {
        return b.progress - a.progress || a.title.localeCompare(b.title);
      }
      if (sortOrder === "total") {
        return (availabilityB.totalEpisodes || b.totalEpisodes || 0) - (availabilityA.totalEpisodes || a.totalEpisodes || 0) || a.title.localeCompare(b.title);
      }
      if (sortOrder === "sub") {
        return (availabilityB.subEpisodes || 0) - (availabilityA.subEpisodes || 0) || a.title.localeCompare(b.title);
      }
      if (sortOrder === "dub") {
        return (availabilityB.dubEpisodes || 0) - (availabilityA.dubEpisodes || 0) || a.title.localeCompare(b.title);
      }
      if (sortOrder === "personalScore") {
        const scoreA = Number(a.score) || 0;
        const scoreB = Number(b.score) || 0;
        return Number(scoreA <= 0) - Number(scoreB <= 0) || scoreB - scoreA || a.title.localeCompare(b.title);
      }
      if (sortOrder === "publicScore") {
        const scoreA = Number(a.publicScore) || 0;
        const scoreB = Number(b.publicScore) || 0;
        return Number(scoreA <= 0) - Number(scoreB <= 0) || scoreB - scoreA || a.title.localeCompare(b.title);
      }
      if (sortOrder === "notes") {
        const noteA = a.notes?.trim() || "";
        const noteB = b.notes?.trim() || "";
        return Number(!noteA) - Number(!noteB) || noteA.localeCompare(noteB) || a.title.localeCompare(b.title);
      }
      if (sortOrder === "rating") {
        const ratingA = ratings[a.mediaId]?.ratingLabel || "";
        const ratingB = ratings[b.mediaId]?.ratingLabel || "";
        return (RATING_SORT_RANKS[ratingB] || 0) - (RATING_SORT_RANKS[ratingA] || 0) || ratingA.localeCompare(ratingB) || a.title.localeCompare(b.title);
      }
      return a.title.localeCompare(b.title);
    });
  }, [activeStatus, activeUnwatchedAlertOnly, availability, completeOnly, entries, incompleteOnly, dubOnly, query, ratings, settings.watchNow, sortOrder]);
  const sortedAddSearchResults = useMemo(() => {
    return addSearchResults.filter((entry) => (
      !addDubOnly || Number(availability[entry.mediaId]?.dubEpisodes || 0) > 0
    )).sort((a, b) => {
      if (sortOrder === "romaji") {
        return (a.romajiTitle || a.title).localeCompare(b.romajiTitle || b.title);
      }
      if (sortOrder === "year") {
        return (entryYear(b) || 0) - (entryYear(a) || 0) || a.title.localeCompare(b.title);
      }
      if (sortOrder === "progress") {
        return b.progress - a.progress || a.title.localeCompare(b.title);
      }
      if (sortOrder === "total") {
        return (b.totalEpisodes || 0) - (a.totalEpisodes || 0) || a.title.localeCompare(b.title);
      }
      if (sortOrder === "personalScore") {
        const scoreA = Number(a.score) || 0;
        const scoreB = Number(b.score) || 0;
        return Number(scoreA <= 0) - Number(scoreB <= 0) || scoreB - scoreA || a.title.localeCompare(b.title);
      }
      if (sortOrder === "publicScore") {
        const scoreA = Number(a.publicScore) || 0;
        const scoreB = Number(b.publicScore) || 0;
        return Number(scoreA <= 0) - Number(scoreB <= 0) || scoreB - scoreA || a.title.localeCompare(b.title);
      }
      if (sortOrder === "notes") {
        const noteA = a.notes?.trim() || "";
        const noteB = b.notes?.trim() || "";
        return Number(!noteA) - Number(!noteB) || noteA.localeCompare(noteB) || a.title.localeCompare(b.title);
      }
      return a.title.localeCompare(b.title);
    });
  }, [addDubOnly, addSearchResults, availability, sortOrder]);
  const focusedPreviewEntry = (isAddTab ? sortedAddSearchResults : filteredEntries)
    .find((entry) => entry.mediaId === focusedPreviewId) || null;

  useEffect(() => {
    if (focusedPreviewId && !focusedPreviewEntry) {
      setFocusedPreviewId(null);
      setFocusedPreviewOrigin(null);
    }
  }, [focusedPreviewEntry, focusedPreviewId]);

  function openFocusedPreview(mediaId, event) {
    const panel = event.currentTarget.querySelector(".cover-preview-panel");
    const rect = panel?.getBoundingClientRect();
    const panelVisible = panel && window.getComputedStyle(panel).opacity !== "0";
    setFocusedPreviewOrigin(panelVisible && rect ? {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    } : null);
    setFocusedPreviewId(mediaId);
  }

  function closeFocusedPreview() {
    setFocusedPreviewId(null);
    setFocusedPreviewOrigin(null);
  }

  useEffect(() => {
    if (!focusedPreviewEntry) {
      return undefined;
    }

    function closeOnBackground(event) {
      if (event.target instanceof Element && event.target.matches("html, body, #root, main")) {
        closeFocusedPreview();
      }
    }

    document.addEventListener("mousedown", closeOnBackground);
    return () => document.removeEventListener("mousedown", closeOnBackground);
  }, [focusedPreviewEntry]);

  function updateEntry(updatedEntry, options = {}) {
    if (options.removeFromCurrent) {
      setEntries((currentEntries) => currentEntries.filter((entry) => entry.mediaId !== updatedEntry.mediaId));
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(updatedEntry.mediaId);
        return next;
      });
      if (offlineEnabled) {
        refreshOfflineStatus();
      }
      return;
    }
    setEntries((currentEntries) =>
      currentEntries.map((entry) => {
        if (entry.mediaId !== updatedEntry.mediaId) {
          return entry;
        }
        const nextEntry = { ...entry, ...updatedEntry };
        if (!updatedEntry.nextAiringEpisode && entry.nextAiringEpisode) {
          nextEntry.nextAiringEpisode = entry.nextAiringEpisode;
        }
        if (entry.isAiring && nextEntry.nextAiringEpisode) {
          nextEntry.isAiring = true;
        }
        return nextEntry;
      })
    );
    if (Number.isFinite(options.preserveScrollY)) {
      const restoreRunId = scrollRestoreRunId.current + 1;
      scrollRestoreRunId.current = restoreRunId;
      restoreWindowScroll({
        top: options.preserveScrollY,
        left: options.preserveScrollX,
        shouldContinue: () => scrollRestoreRunId.current === restoreRunId
      });
    }
    if (offlineEnabled) {
      refreshOfflineStatus();
    }
  }

  function setSelected(mediaId, checked) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(mediaId);
      } else {
        next.delete(mediaId);
      }
      return next;
    });
  }

  function selectVisible(checked) {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const entry of filteredEntries) {
        if (checked) {
          next.add(entry.mediaId);
        } else {
          next.delete(entry.mediaId);
        }
      }
      return next;
    });
  }

  async function searchAddAnime() {
    if (offlineEnabled) {
      setAddSearchError("AniList search is disabled while Offline Mode is active.");
      setAddSearchResults([]);
      return;
    }
    const runId = addSearchRunId.current + 1;
    addSearchRunId.current = runId;
    const normalizedQuery = addQuery.trim();
    setAddSearchError("");
    setAddSearchNotice("");
    setAddDubOnly(false);
    setAddAvailabilityReady(false);
    if (!normalizedQuery) {
      setAddSearchError("Enter a search query.");
      setAddSearchResults([]);
      return;
    }

    setAddSearchLoading(true);
    try {
      const numericLimit = addSearchLimit === "all" ? null : Number(addSearchLimit);
      const results = [];
      let page = 1;

      while (numericLimit === null || results.length < numericLimit) {
        const remainingLimit = numericLimit === null ? 50 : numericLimit - results.length;
        const perPage = addTitleOnly ? 50 : Math.min(50, remainingLimit);
        const payload = await api(`/api/search/anime?query=${encodeURIComponent(normalizedQuery)}&page=${page}&perPage=${perPage}`);
        if (addSearchRunId.current !== runId) {
          return;
        }
        const pageEntries = payload.entries || [];
        if (pageEntries.length === 0) {
          break;
        }
        const visibleEntries = addTitleOnly
          ? pageEntries.filter((entry) => titleMatchesQuery(entry, normalizedQuery))
          : pageEntries;
        results.push(...(numericLimit === null ? visibleEntries : visibleEntries.slice(0, numericLimit - results.length)));
        if (!payload.pageInfo?.hasNextPage) {
          break;
        }
        page += 1;
      }

      setAddSearchResults(results);
      if (results.length === 0) {
        setAddSearchNotice("No AniList results found.");
      } else {
        loadCachedAddAvailability(results, runId);
      }
    } catch (searchError) {
      if (addSearchRunId.current !== runId) {
        return;
      }
      setAddSearchResults([]);
      setAddSearchError(searchError.message);
    } finally {
      if (addSearchRunId.current === runId) {
        setAddSearchLoading(false);
      }
    }
  }

  async function loadCachedAddAvailability(results, searchRunId) {
    try {
      const cachedEntries = [];
      for (let index = 0; index < results.length; index += AVAILABILITY_CHUNK_SIZE) {
        if (addSearchRunId.current !== searchRunId) {
          return;
        }
        const chunk = results.slice(index, index + AVAILABILITY_CHUNK_SIZE);
        const payload = await api("/api/availability/batch", {
          method: "POST",
          body: JSON.stringify({
            cacheOnly: true,
            entries: chunk.map((entry) => ({
              mediaId: entry.mediaId,
              malId: entry.malId,
              status: entry.status,
              title: entry.title,
              romajiTitle: entry.romajiTitle,
              englishTitle: entry.englishTitle,
              nativeTitle: entry.nativeTitle,
              synonyms: entry.synonyms || [],
              endDate: entry.endDate,
              format: entry.format,
              mediaStatus: entry.mediaStatus,
              totalEpisodes: entry.totalEpisodes
            }))
          })
        });
        if (addSearchRunId.current !== searchRunId) {
          return;
        }
        cachedEntries.push(...(payload.entries || []));
      }
      if (cachedEntries.length === 0 || addSearchRunId.current !== searchRunId) {
        return;
      }
      setAvailability((currentAvailability) => ({
        ...currentAvailability,
        ...Object.fromEntries(cachedEntries.map((entry) => [entry.mediaId, entry]))
      }));
      setAddAvailabilityReady(true);
    } catch (cacheError) {
      if (addSearchRunId.current === searchRunId) {
        console.warn("Cached Add availability lookup failed.", cacheError);
      }
    }
  }

  function updateAddSearchResult(mediaId, updatedEntry) {
    setAddSearchResults((currentResults) =>
      currentResults.map((entry) =>
        entry.mediaId === mediaId
          ? {
              ...entry,
              ...updatedEntry,
              listed: true,
              listEntryId: updatedEntry.id,
              listStatus: updatedEntry.status
            }
          : entry
      )
    );
    setAddSearchNotice(`Added "${updatedEntry.title}" to ${statusLabel(updatedEntry.status)}.`);
  }

  function removeMoved(mediaIds) {
    const movedIds = new Set(mediaIds);
    setEntries((currentEntries) => currentEntries.filter((entry) => !movedIds.has(entry.mediaId)));
    setSelectedIds(new Set());
    if (offlineEnabled) {
      refreshOfflineStatus();
    }
  }

  function removeDeleted(mediaId) {
    setEntries((currentEntries) => currentEntries.filter((entry) => entry.mediaId !== mediaId));
    setAvailability((currentAvailability) => {
      const next = { ...currentAvailability };
      delete next[mediaId];
      return next;
    });
    setSelectedIds((current) => {
      const next = new Set(current);
      next.delete(mediaId);
      return next;
    });
    if (offlineEnabled) {
      refreshOfflineStatus();
    }
  }

  function actionTargetEntries() {
    if (selectedIds.size === 0) {
      return entries;
    }
    return entries.filter((entry) => selectedIds.has(entry.mediaId));
  }

  async function loadCachedExportAvailability(targetEntries, onProgress) {
    const availabilityById = {};
    for (let index = 0; index < targetEntries.length; index += EXPORT_AVAILABILITY_CHUNK_SIZE) {
      const chunk = targetEntries.slice(index, index + EXPORT_AVAILABILITY_CHUNK_SIZE);
      onProgress?.(`Loading cached availability ${Math.min(index + chunk.length, targetEntries.length)}/${targetEntries.length}...`);
      const payload = await api("/api/availability/batch", {
        method: "POST",
        body: JSON.stringify({
          cacheOnly: true,
          entries: chunk.map((entry) => ({
            mediaId: entry.mediaId,
            malId: entry.malId,
            status: entry.status,
            title: entry.title,
            romajiTitle: entry.romajiTitle,
            englishTitle: entry.englishTitle,
            nativeTitle: entry.nativeTitle,
            synonyms: entry.synonyms || [],
            endDate: entry.endDate,
            format: entry.format,
            mediaStatus: entry.mediaStatus,
            totalEpisodes: entry.totalEpisodes
          }))
        })
      });
      for (const availabilityEntry of payload.entries || []) {
        availabilityById[availabilityEntry.mediaId] = availabilityEntry;
      }
    }
    return availabilityById;
  }

  async function loadCachedExportRatings(targetEntries, onProgress) {
    const ratingTargets = targetEntries.filter((entry) => entry.malId);
    const ratingsById = {};
    for (let index = 0; index < ratingTargets.length; index += EXPORT_RATING_CHUNK_SIZE) {
      const chunk = ratingTargets.slice(index, index + EXPORT_RATING_CHUNK_SIZE);
      onProgress?.(`Loading cached ratings ${Math.min(index + chunk.length, ratingTargets.length)}/${ratingTargets.length}...`);
      const payload = await api("/api/ratings/batch", {
        method: "POST",
        body: JSON.stringify({
          cacheOnly: true,
          entries: chunk.map((entry) => ({
            mediaId: entry.mediaId,
            malId: entry.malId
          }))
        })
      });
      for (const ratingEntry of payload.entries || []) {
        ratingsById[ratingEntry.mediaId] = ratingEntry;
      }
    }
    return ratingsById;
  }

  function buildExportEntries(sourceEntries, metadata) {
    const availabilityMap = metadata.availability || {};
    const ratingsMap = metadata.ratings || {};
    return sourceEntries.map((entry) => exportEntry(entry, {
      listStatus: entry.listStatus || metadata.listStatus,
      listName: entry.listName || metadata.listName,
      availability: availabilityMap[entry.mediaId],
      rating: ratingsMap[entry.mediaId]
    }));
  }

  async function prepareAllListExport() {
    const dedupedEntries = new Map();
    let exportUser = user;

    for (let index = 0; index < EXPORT_STATUSES.length; index += 1) {
      const status = EXPORT_STATUSES[index];
      setExportProgress(`Preparing export ${index + 1}/${EXPORT_STATUSES.length}...`);
      const payload = await api(`/api/lists?status=${encodeURIComponent(status)}&type=ANIME`);
      exportUser = payload.user || exportUser;
      for (const entry of payload.entries || []) {
        if (!dedupedEntries.has(entry.mediaId)) {
          dedupedEntries.set(entry.mediaId, {
            ...entry,
            listStatus: status,
            listName: payload.listName || status
          });
        }
      }
    }

    const allEntries = Array.from(dedupedEntries.values());
    const availabilityMap = await loadCachedExportAvailability(allEntries, setExportProgress);
    const ratingsMap = await loadCachedExportRatings(allEntries, setExportProgress);
    return {
      scope: "all",
      statuses: EXPORT_STATUSES,
      user: exportUser,
      entries: buildExportEntries(allEntries, {
        availability: availabilityMap,
        ratings: ratingsMap
      }),
      missingAvailability: allEntries.filter((entry) => isAvailabilityMissing(availabilityMap[entry.mediaId])).length,
      missingRatings: allEntries.filter((entry) => entry.malId && !ratingsMap[entry.mediaId]).length
    };
  }

  function prepareFilteredExport() {
    return {
      scope: "filtered",
      statuses: [activeStatus],
      user,
      entries: buildExportEntries(filteredEntries.map((entry) => ({
        ...entry,
        listStatus: activeStatus
      })), {
        listStatus: activeStatus,
        availability,
        ratings
      }),
      missingAvailability: filteredEntries.filter((entry) => isAvailabilityMissing(availability[entry.mediaId])).length,
      missingRatings: filteredEntries.filter((entry) => entry.malId && !ratings[entry.mediaId]).length
    };
  }

  async function exportEntries({ scope, format }) {
    setExporting(true);
    setExportProgress(scope === "all" ? `Preparing export 0/${EXPORT_STATUSES.length}...` : "Preparing export...");
    setExportNotice(null);
    setError("");
    try {
      const prepared = scope === "all" ? await prepareAllListExport() : prepareFilteredExport();
      const stamp = todayStamp();
      let skippedMal = 0;

      if (format === "malXml") {
        skippedMal = prepared.entries.filter((entry) => !(Number(entry.malId) > 0)).length;
        downloadTextFile(
          `mal-import-anime-${stamp}.xml`,
          "application/xml;charset=utf-8",
          buildMalXmlExport({ entries: prepared.entries, user: prepared.user })
        );
      } else {
        downloadTextFile(
          `anilist-manager-export-${stamp}.csv`,
          "text/csv;charset=utf-8",
          buildCsvExport(prepared.entries)
        );
      }

      const warnings = [];
      if (prepared.missingAvailability > 0) {
        warnings.push(`Availability missing for ${prepared.missingAvailability} entries`);
      }
      if (prepared.missingRatings > 0) {
        warnings.push(`ratings missing for ${prepared.missingRatings} entries`);
      }
      if (skippedMal > 0) {
        warnings.push(`${skippedMal} entries without MAL IDs skipped`);
      }
      setExportNotice({
        type: warnings.length > 0 ? "warning" : "success",
        text: warnings.length > 0
          ? `${warnings.join("; ")}. Export downloaded.`
          : `Export downloaded (${prepared.entries.length} entries).`
      });
      setExportOpen(false);
    } catch (exportError) {
      setError(exportError.message);
    } finally {
      setExporting(false);
      setExportProgress("");
    }
  }

  async function updateCompletedProgressToTotals() {
    const targetEntries = actionTargetEntries();
    const updates = targetEntries
      .filter((entry) => entry.status === "COMPLETED")
      .map((entry) => ({
        entry,
        targetProgress: availability[entry.mediaId]?.totalEpisodes || entry.totalEpisodes
      }))
      .filter((item) => Number.isFinite(item.targetProgress) && item.targetProgress > 0 && item.entry.progress !== item.targetProgress);

    if (updates.length === 0) {
      setAvailabilityWarning(
        selectedIds.size > 0
          ? "Selected completed entries already match known totals."
          : "Completed entries already match known totals."
      );
      return;
    }
    const selectedText = selectedIds.size > 0 ? " selected" : "";
    if (!window.confirm(`Update watched progress for ${updates.length}${selectedText} completed entries to their known totals?`)) {
      return;
    }

    setUpdatingCompletedProgress(true);
    setCompletedProgressUpdate({ checked: 0, total: updates.length });
    completedProgressAbortController.current?.abort();
    const abortController = new AbortController();
    completedProgressAbortController.current = abortController;
    setError("");
    try {
      const updatedEntries = [];
      for (let index = 0; index < updates.length; index += BULK_PROGRESS_CHUNK_SIZE) {
        const chunk = updates.slice(index, index + BULK_PROGRESS_CHUNK_SIZE);
        const payload = await api("/api/bulk/progress", {
          method: "POST",
          signal: abortController.signal,
          body: JSON.stringify({
            updates: chunk.map((item) => ({
              mediaId: item.entry.mediaId,
              progress: item.targetProgress
            }))
          })
        });
        updatedEntries.push(...payload.entries);
        setCompletedProgressUpdate({
          checked: Math.min(index + chunk.length, updates.length),
          total: updates.length
        });
      }
      setEntries((currentEntries) =>
        currentEntries.map((entry) => updatedEntries.find((updatedEntry) => updatedEntry.mediaId === entry.mediaId) || entry)
      );
      setAvailabilityWarning(`Updated ${updatedEntries.length} completed entr${updatedEntries.length === 1 ? "y" : "ies"}.`);
    } catch (updateError) {
      if (updateError.name !== "AbortError") {
        setError(updateError.message);
      }
    } finally {
      setUpdatingCompletedProgress(false);
      completedProgressAbortController.current = null;
    }
  }

  function cancelCompletedProgressUpdate() {
    completedProgressAbortController.current?.abort();
    completedProgressAbortController.current = null;
    setUpdatingCompletedProgress(false);
  }

  return (
    <main>
      <section className="top-shell" aria-label="List controls">
        <header className="app-header">
          <div className="app-identity">
            <img className="app-logo" src="/logo.png" alt="" aria-hidden="true" />
            <div>
              <h1>AniList Manager</h1>
              <p>
                {offlineEnabled ? (
                  <span className="offline-status-wrap" ref={offlineQueueRef}>
                    <button
                      type="button"
                      className="offline-status-badge"
                      aria-expanded={offlineQueueOpen}
                      aria-haspopup="dialog"
                      onClick={toggleOfflineQueue}
                    >
                      Offline{Number(offline?.queued || 0) > 0 ? ` · ${offline.queued} queued` : ""}
                    </button>
                    {offlineQueueOpen ? (
                      <section className="offline-queue-popover" role="dialog" aria-label="Queued offline changes">
                        <div className="offline-queue-header">
                          <strong>Queued Offline Changes</strong>
                          <span>{Number(offlineQueue.queued || 0)} change{Number(offlineQueue.queued || 0) === 1 ? "" : "s"} waiting to sync</span>
                        </div>
                        {offlineQueueError ? <div className="inline-warning">{offlineQueueError}</div> : null}
                        {offlineQueueLoading ? <div className="offline-queue-empty">Loading queued changes...</div> : null}
                        {!offlineQueueLoading && !offlineQueueError && offlineQueue.items.length === 0 ? (
                          <div className="offline-queue-empty">No queued changes.</div>
                        ) : null}
                        {!offlineQueueLoading && !offlineQueueError && offlineQueue.items.length > 0 ? (
                          <div className="offline-queue-list">
                            {offlineQueue.items.map((item, index) => (
                              <article className="offline-queue-item" key={item.id || `${item.kind}-${item.mediaId}-${index}`}>
                                <strong>{item.title || "Queued item"}</strong>
                                <span>{item.summary || "Queued change"}</span>
                                {Array.isArray(item.details) && item.details.length > 1 ? (
                                  <small>{item.details.slice(1).join(" · ")}</small>
                                ) : null}
                                {item.createdAt ? <time>{formatQueueTimestamp(item.createdAt)}</time> : null}
                              </article>
                            ))}
                          </div>
                        ) : null}
                      </section>
                    ) : null}
                  </span>
                ) : user ? `Signed in as ${user.name}` : "Local list manager"}
              </p>
            </div>
          </div>
          <div className="header-actions command-group">
            <button type="button" className={showUpdateMarker ? "about-button update-available" : "about-button"} onClick={() => setAboutOpen(true)}>
              About
              {showUpdateMarker ? <span className="update-marker" aria-label="Update available" /> : null}
            </button>
            <button type="button" onClick={() => setSettingsOpen(true)}>
              Settings
            </button>
            <button
              type="button"
              className="refresh-availability"
              disabled={offlineEnabled || availabilityLoading || (isAddTab ? addSearchLoading || sortedAddSearchResults.length === 0 : loading)}
              onClick={recheckEpisodes}
              title={offlineEnabled ? "Disabled while Offline Mode is active." : ""}
            >
              {availabilityLoading
                ? (availabilityProgress.total > 0 ? `Checking ${availabilityProgress.checked}/${availabilityProgress.total}...` : "Checking...")
                : "Recheck Episodes"}
            </button>
            {availabilityLoading ? (
              <button type="button" className="stop-refresh" onClick={cancelAvailabilityRefresh} aria-label="Stop episode recheck" title="Stop episode recheck" />
            ) : null}
            <button
              type="button"
              className="donate-button"
              title="Support development"
              onClick={() => window.open("https://www.paypal.com/donate/?hosted_button_id=JK8ZEGCDMWP94", "_blank", "noreferrer")}
            >
              Donate <span className="heart" aria-hidden="true">❤</span>
            </button>
          </div>
        </header>

        <div className="status-strip">
          <nav className="tabs" aria-label="Anime list status">
            {STATUSES.map((status) => (
              <button
                type="button"
                key={status.value}
                disabled={offlineEnabled && status.value === ADD_STATUS}
                className={[
                  status.value === activeStatus ? "active" : "",
                  status.value === ADD_STATUS ? "add-tab" : ""
                ].filter(Boolean).join(" ")}
                onClick={() => switchStatus(status.value)}
              >
                {status.label}
              </button>
            ))}
          </nav>
          <div className="list-actions command-group">
            {activeStatus === "COMPLETED" && !isAddTab ? (
              <button
                type="button"
                className="ghost-button"
                disabled={loading || updatingCompletedProgress}
                onClick={updateCompletedProgressToTotals}
              >
                {updatingCompletedProgress
                  ? `Updating ${completedProgressUpdate.checked}/${completedProgressUpdate.total}...`
                : "Update progress"}
              </button>
            ) : null}
            {updatingCompletedProgress && !isAddTab ? (
              <button type="button" className="stop-refresh" onClick={cancelCompletedProgressUpdate} aria-label="Stop progress update" title="Stop progress update" />
            ) : null}
            <button type="button" className="ghost-button" disabled={isAddTab || loading} onClick={toggleNotesMode}>
              {showNotes ? "View Lists" : "View Notes"}
            </button>
            <button type="button" className="ghost-button" disabled={isAddTab || loading || exporting} onClick={() => setExportOpen(true)}>
              {exporting ? "Exporting..." : "Export"}
            </button>
            <button type="button" className={offlineEnabled ? "ghost-button offline-toggle active" : "ghost-button offline-toggle"} disabled={offlineBusy} onClick={toggleOfflineMode}>
              {offlineBusy ? "Offline..." : offlineEnabled ? "Turn Off Offline" : "Offline Mode"}
            </button>
          </div>
        </div>

        <section className={isAddTab ? "toolbar add-toolbar" : "toolbar"}>
          <div className={isAddTab ? "search-stack add-search-stack" : "search-stack"}>
            {isAddTab ? (
              <div className="search-box add-search-box">
                <span>Search</span>
                <input
                  value={addQuery}
                  disabled={offlineEnabled}
                  onChange={(event) => setAddQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      searchAddAnime();
                    }
                  }}
                  placeholder="Search AniList anime"
                />
                <button type="button" disabled={offlineEnabled || addSearchLoading} onClick={searchAddAnime}>
                  {addSearchLoading ? "Searching..." : "Search"}
                </button>
                <label className="add-search-option add-limit-box">
                  <span>Limit</span>
                  <select value={addSearchLimit} disabled={offlineEnabled || addSearchLoading} onChange={(event) => setAddSearchLimit(event.target.value)}>
                    {ADD_SEARCH_LIMIT_OPTIONS.map((limit) => (
                      <option value={limit} key={limit}>
                        {limit === "all" ? "All" : limit}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : (
              <label className="search-box">
                <span>Search</span>
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter titles or notes" />
              </label>
            )}
            {!isAddTab ? (
              <label className="filter-chip select-visible-chip">
                <input
                  type="checkbox"
                  checked={filteredEntries.length > 0 && filteredEntries.every((entry) => selectedIds.has(entry.mediaId))}
                  onChange={(event) => selectVisible(event.target.checked)}
                />
                Select visible
              </label>
            ) : null}
          </div>
          {isAddTab ? (
            <div className="filter-strip" aria-label="Add filters">
              <label className="filter-chip">
                <input
                  type="checkbox"
                  checked={addTitleOnly}
                  disabled={addSearchLoading}
                  onChange={(event) => setAddTitleOnly(event.target.checked)}
                />
                Title only
              </label>
              <label
                className={addAvailabilityReady ? "filter-chip" : "filter-chip disabled"}
                title={addAvailabilityReady ? "" : "Run Recheck Episodes before filtering by dub availability."}
              >
                <input
                  type="checkbox"
                  checked={addDubOnly}
                  disabled={!addAvailabilityReady}
                  onChange={(event) => setAddDubOnly(event.target.checked)}
                />
                Dub available
              </label>
            </div>
          ) : (
            <div className="filter-strip" aria-label="List filters">
              <label className="filter-chip">
                <input
                  type="checkbox"
                  checked={completeOnly}
                  onChange={(event) => {
                    setCompleteOnly(event.target.checked);
                    if (event.target.checked) {
                      setIncompleteOnly(false);
                    }
                  }}
                />
                Complete
              </label>
              <label className="filter-chip">
                <input
                  type="checkbox"
                  checked={incompleteOnly}
                  onChange={(event) => {
                    setIncompleteOnly(event.target.checked);
                    if (event.target.checked) {
                      setCompleteOnly(false);
                    }
                  }}
                />
                Incomplete
              </label>
              <label className="filter-chip">
                <input
                  type="checkbox"
                  checked={dubOnly}
                  onChange={(event) => setDubOnly(event.target.checked)}
                />
                Has dub
              </label>
              <label
                className={alertsFilterEnabled ? "filter-chip" : "filter-chip disabled"}
                title={alertsFilterEnabled ? "" : "Enable an unwatched sub or dub alert in Watch Now settings to use this filter."}
              >
                <input
                  type="checkbox"
                  checked={activeUnwatchedAlertOnly}
                  disabled={!alertsFilterEnabled}
                  onChange={(event) => setUnwatchedAlertOnly(event.target.checked)}
                />
                Alerts
              </label>
            </div>
          )}
          <div className="list-state">
            <label className="sort-box">
              <span>Order</span>
              <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value)}>
                {SORT_OPTIONS.map((option) => (
                  <option value={option.value} key={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <span className="count">{isAddTab ? `${sortedAddSearchResults.length} results` : `${filteredEntries.length} entries`}</span>
          </div>
        </section>
      </section>

      <AuthSettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onAuthChanged={() => load(activeStatus)}
        settings={settings}
        offlineMode={offlineEnabled}
        onSettingsChanged={(nextSettings) => setSettings(normalizeSettings(nextSettings))}
      />

      <AboutDialog
        open={aboutOpen}
        onClose={() => setAboutOpen(false)}
        updateInfo={updateInfo}
        onLoadUpdate={loadUpdateInfo}
        onCheckUpdate={checkUpdateInfo}
        onIgnoreUpdate={ignoreUpdateInfo}
      />

      <RefreshAvailabilityDialog
        open={refreshChoiceOpen}
        onClose={() => setRefreshChoiceOpen(false)}
        onRefresh={startAvailabilityRefresh}
      />

      <ExportDialog
        open={exportOpen}
        loading={loading}
        exporting={exporting}
        progress={exportProgress}
        onClose={() => setExportOpen(false)}
        onExport={exportEntries}
      />

      <OfflineDisableDialog
        open={offlineDisableOpen}
        queued={Number(offline?.queued || 0)}
        busy={offlineBusy}
        onSync={syncQueuedThenDisable}
        onDiscard={discardQueuedThenDisable}
        onCancel={() => setOfflineDisableOpen(false)}
      />

      <OfflineSyncFailureDialog
        open={offlineSyncFailures.length > 0}
        failures={offlineSyncFailures}
        busy={offlineBusy}
        onRetry={syncQueuedThenDisable}
        onDiscard={discardQueuedThenDisable}
        onStayOffline={stayOfflineAfterSyncFailure}
      />

      <AvailabilityOverrideDialog
        overrideTarget={overrideTarget}
        onClose={() => setOverrideTarget(null)}
        onSave={saveAvailabilityOverride}
        onRemove={removeAvailabilityOverride}
      />
      <WatchServerMenu menu={watchServerMenu} onClose={() => setWatchServerMenu(null)} />
      <FocusedEntryPreview entry={focusedPreviewEntry} origin={focusedPreviewOrigin} onClose={closeFocusedPreview} />

      {error ? <div className="error-banner">{error}</div> : null}
      {isAddTab && addSearchError ? <div className="error-banner">{addSearchError}</div> : null}
      {availabilityWarning ? <div className="warning-banner">{availabilityWarning}</div> : null}
      {isAddTab && addSearchNotice ? <div className="success-banner">{addSearchNotice}</div> : null}
      {exportNotice ? <div className={exportNotice.type === "warning" ? "warning-banner" : "success-banner"}>{exportNotice.text}</div> : null}
      {offlineProgress ? <div className="warning-banner">{offlineProgress}</div> : null}
      {offlineNotice ? <div className={offlineNotice.type === "warning" ? "warning-banner" : "success-banner"}>{offlineNotice.text}</div> : null}

      {!isAddTab ? (
        <BulkMoveBar
          entries={entries}
          selectedIds={selectedIds}
          activeStatus={activeStatus}
          onMoved={removeMoved}
          onClear={() => setSelectedIds(new Set())}
        />
      ) : null}

      <section className="list-panel">
        {isAddTab ? (
          <>
            {addSearchLoading ? <div className="empty-state">Searching AniList...</div> : null}
            {!addSearchLoading && sortedAddSearchResults.length === 0 ? <div className="empty-state">Search AniList to add anime to your lists.</div> : null}
            {!addSearchLoading
              ? sortedAddSearchResults.map((entry) => (
                  <AddSearchResultRow
                    key={entry.mediaId}
                    entry={entry}
                    availability={availability[entry.mediaId]}
                    watchNow={settings.watchNow}
                    alertIconId={settings.appearance.alertIcon}
                    showSynonymInfoIcon={settings.appearance.showSynonymInfoIcon}
                    offlineMode={offlineEnabled}
                    onAdded={updateAddSearchResult}
                    onPreviewFocus={openFocusedPreview}
                    previewFocused={Boolean(focusedPreviewEntry)}
                    onOpenWatchServerMenu={setWatchServerMenu}
                  />
                ))
              : null}
          </>
        ) : (
          <>
            {loading && entries.length === 0 ? <div className="empty-state">Loading...</div> : null}
            {!loading && filteredEntries.length === 0 ? <div className="empty-state">No entries found.</div> : null}
            {entries.length > 0
          ? filteredEntries.map((entry) => (
              <EntryRow
                key={entry.mediaId}
                entry={entry}
                selected={selectedIds.has(entry.mediaId)}
                onSelectedChange={setSelected}
                onUpdate={updateEntry}
                onDelete={removeDeleted}
                activeStatus={activeStatus}
                availability={availability[entry.mediaId]}
                rating={ratings[entry.mediaId]}
                watchNow={settings.watchNow}
                alertIconId={settings.appearance.alertIcon}
                showSynonymInfoIcon={settings.appearance.showSynonymInfoIcon}
                showNotes={showNotes}
                onNoteError={setError}
                offlineMode={offlineEnabled}
                onPreviewFocus={openFocusedPreview}
                previewFocused={Boolean(focusedPreviewEntry)}
                onOpenWatchServerMenu={setWatchServerMenu}
                onRefreshNeeded={() => load(activeStatus)}
                onAvailabilityOverride={(entryToEdit, currentAvailability) => setOverrideTarget({ entry: entryToEdit, availability: currentAvailability })}
              />
            ))
          : null}
          </>
        )}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
