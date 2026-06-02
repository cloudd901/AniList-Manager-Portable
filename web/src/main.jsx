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
const SORT_DIRECTIONS = [
  { value: "asc", label: "Ascending" },
  { value: "desc", label: "Descending" }
];
const NUMERIC_FILTER_OPERATORS = [
  { value: ">", label: ">" },
  { value: ">=", label: ">=" },
  { value: "<", label: "<" },
  { value: "<=", label: "<=" },
  { value: "=", label: "=" }
];
const NUMERIC_FILTER_FIELDS = [
  { value: "year", label: "Year" },
  { value: "publicScore", label: "Public score" },
  { value: "episodeCount", label: "Episode count" },
  { value: "progress", label: "Progress" },
  { value: "subEpisodes", label: "Sub episodes" },
  { value: "dubEpisodes", label: "Dub episodes" }
];
const ADVANCED_FILTER_VERSION = 1;
const ADD_SEARCH_LIMIT_OPTIONS = ["all", "200", "100", "50", "20"];
const LIST_CHUNK_SIZE = 100;
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

function defaultSortDirection(field) {
  return field === "english" || field === "romaji" || field === "notes" ? "asc" : "desc";
}

function defaultNumericFilters() {
  return Object.fromEntries(NUMERIC_FILTER_FIELDS.map((field) => [field.value, { operator: "", value: "" }]));
}

function defaultAdvancedFilter() {
  return {
    version: ADVANCED_FILTER_VERSION,
    query: "",
    title: "",
    notes: "",
    completeOnly: false,
    incompleteOnly: false,
    dubOnly: false,
    unwatchedAlertOnly: false,
    progressCompleteOnly: false,
    progressIncompleteOnly: false,
    availabilityOverrideOnly: false,
    hasNotesOnly: false,
    hasScoreOnly: false,
    missingScoreOnly: false,
    formats: [],
    genres: [],
    ratings: [],
    numeric: defaultNumericFilters(),
    sort: {
      primary: "english",
      primaryDirection: "asc",
      secondary: "",
      secondaryDirection: "desc"
    }
  };
}

function normalizeArrayStrings(value, allowedValues = null) {
  const allowed = allowedValues ? new Set(allowedValues) : null;
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => String(item || "").trim())
    .filter((item) => item && (!allowed || allowed.has(item))))];
}

function normalizeNumericFilters(input) {
  const normalized = defaultNumericFilters();
  for (const field of NUMERIC_FILTER_FIELDS) {
    const source = input?.[field.value] || {};
    const operator = NUMERIC_FILTER_OPERATORS.some((option) => option.value === source.operator) ? source.operator : "";
    const value = source.value === 0 || source.value ? String(source.value) : "";
    normalized[field.value] = { operator, value };
  }
  return normalized;
}

function normalizeAdvancedFilter(filter) {
  const fallback = defaultAdvancedFilter();
  const primary = SORT_OPTIONS.some((option) => option.value === filter?.sort?.primary) ? filter.sort.primary : fallback.sort.primary;
  const secondary = SORT_OPTIONS.some((option) => option.value === filter?.sort?.secondary) ? filter.sort.secondary : "";
  const primaryDirection = SORT_DIRECTIONS.some((option) => option.value === filter?.sort?.primaryDirection)
    ? filter.sort.primaryDirection
    : defaultSortDirection(primary);
  const secondaryDirection = SORT_DIRECTIONS.some((option) => option.value === filter?.sort?.secondaryDirection)
    ? filter.sort.secondaryDirection
    : defaultSortDirection(secondary || "year");
  const completeOnly = filter?.completeOnly === true;
  const progressCompleteOnly = filter?.progressCompleteOnly === true;
  const hasScoreOnly = filter?.hasScoreOnly === true;

  return {
    ...fallback,
    query: String(filter?.query || ""),
    title: String(filter?.title || ""),
    notes: String(filter?.notes || ""),
    completeOnly,
    incompleteOnly: !completeOnly && filter?.incompleteOnly === true,
    dubOnly: filter?.dubOnly === true,
    unwatchedAlertOnly: filter?.unwatchedAlertOnly === true,
    progressCompleteOnly,
    progressIncompleteOnly: !progressCompleteOnly && filter?.progressIncompleteOnly === true,
    availabilityOverrideOnly: filter?.availabilityOverrideOnly === true,
    hasNotesOnly: filter?.hasNotesOnly === true,
    hasScoreOnly,
    missingScoreOnly: !hasScoreOnly && filter?.missingScoreOnly === true,
    formats: normalizeArrayStrings(filter?.formats, Object.keys(FORMAT_LABELS)),
    genres: normalizeArrayStrings(filter?.genres),
    ratings: normalizeArrayStrings(filter?.ratings),
    numeric: normalizeNumericFilters(filter?.numeric),
    sort: {
      primary,
      primaryDirection,
      secondary: secondary === primary ? "" : secondary,
      secondaryDirection
    }
  };
}

function normalizeAdvancedFilters(value) {
  const filters = [];
  const seenIds = new Set();
  for (const savedFilter of Array.isArray(value?.filters) ? value.filters : []) {
    const id = String(savedFilter?.id || "").trim();
    const name = String(savedFilter?.name || "").trim().slice(0, 80);
    if (!id || !name || seenIds.has(id)) {
      continue;
    }
    seenIds.add(id);
    filters.push({
      id,
      name,
      filter: normalizeAdvancedFilter(savedFilter.filter)
    });
  }

  const defaultByStatus = {};
  for (const status of LIST_STATUSES) {
    const savedId = String(value?.defaultByStatus?.[status.value] || "").trim();
    if (savedId && seenIds.has(savedId)) {
      defaultByStatus[status.value] = savedId;
    }
  }

  return { filters, defaultByStatus };
}

function defaultSettings() {
  return {
    showNotes: false,
    simplifiedView: false,
    advancedFilters: normalizeAdvancedFilters(),
    appearance: {
      colorMode: "soft",
      accentTheme: "teal",
      alertIcon: "green-dot",
      showSynonymSubtitle: true,
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
    simplifiedView: settings?.simplifiedView === true,
    advancedFilters: normalizeAdvancedFilters(settings?.advancedFilters),
    appearance: {
      colorMode: COLOR_MODES.some((mode) => mode.value === appearance.colorMode) ? appearance.colorMode : "soft",
      accentTheme: ACCENT_THEMES.some((theme) => theme.value === appearance.accentTheme) ? appearance.accentTheme : "teal",
      alertIcon: ALERT_ICON_OPTIONS.some((option) => option.value === appearance.alertIcon) ? appearance.alertIcon : "green-dot",
      showSynonymSubtitle: appearance.showSynonymSubtitle === undefined
        ? appearance.hideSynonymSubtitle !== true
        : appearance.showSynonymSubtitle !== false,
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

  const lines = stripMarkdownSection(md, "screenshots").split(/\r?\n/);
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

function stripMarkdownSection(md, sectionName) {
  const lines = md.split(/\r?\n/);
  const filtered = [];
  let skipping = false;
  let skipLevel = 0;
  const normalizedSectionName = sectionName.trim().toLowerCase();

  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const level = heading[1].length;
      const title = heading[2].trim().toLowerCase().replace(/[:.!?]+$/g, "");
      if (skipping && level <= skipLevel) {
        skipping = false;
      }
      if (!skipping && title === normalizedSectionName) {
        skipping = true;
        skipLevel = level;
        continue;
      }
    }

    if (!skipping) {
      filtered.push(line);
    }
  }

  return filtered.join("\n").trim();
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
    const error = new Error(payload.error || `Request failed: ${response.status}`);
    error.details = payload.details || null;
    error.status = response.status;
    throw error;
  }
  return payload;
}

function formatLoadDiagnostics(diagnostics) {
  if (!diagnostics) {
    return "";
  }
  const localMs = Number(diagnostics.localApiMs);
  const remoteMs = Number(diagnostics.remoteMs);
  const entryCount = Number(diagnostics.entryCount);
  const source = diagnostics.source === "local-offline" ? "Local" : "AniList";
  const parts = [];
  if (diagnostics.cacheHit === true) {
    parts.push("cached");
  }
  if (Number.isFinite(localMs)) {
    parts.push(`local ${(localMs / 1000).toFixed(1)}s`);
  }
  if (Number.isFinite(remoteMs) && diagnostics.cacheHit !== true) {
    parts.push(`remote ${(remoteMs / 1000).toFixed(1)}s`);
  }
  if (Number.isFinite(entryCount)) {
    parts.push(`${entryCount} entries`);
  }
  return parts.length > 0 ? `${source}: ${parts.join(" / ")}` : "";
}

function combineChunkDiagnostics(chunks, entryCount) {
  const last = chunks[chunks.length - 1]?.diagnostics || {};
  const cacheHit = chunks.length > 0 && chunks.every((chunk) => chunk.diagnostics?.cacheHit === true);
  return {
    ...last,
    cacheHit,
    entryCount,
    chunkCount: chunks.length,
    localApiMs: chunks.reduce((total, chunk) => total + (Number(chunk.diagnostics?.localApiMs) || 0), 0),
    remoteMs: chunks.reduce((total, chunk) => total + (Number(chunk.diagnostics?.remoteMs) || 0), 0),
    hasNextChunk: false
  };
}

function mergeUniqueEntries(existingEntries, nextEntries) {
  const byMediaId = new Map(existingEntries.map((entry) => [entry.mediaId, entry]));
  for (const entry of nextEntries || []) {
    byMediaId.set(entry.mediaId, entry);
  }
  return Array.from(byMediaId.values());
}

function availabilityRequestEntries(entries) {
  return entries.map((entry) => ({
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
  }));
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

function ListStatusControl({ entry, activeStatus, moving, deleting, onMove }) {
  return (
    <label className="row-control list-control">
      <span>List</span>
      <select
        className="status-select"
        value={activeStatus}
        disabled={moving || deleting}
        onChange={(event) => onMove(event.target.value)}
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

function isPermanentAvailability(availability) {
  if (!availability || availability.cachePermanent !== true) {
    return false;
  }
  return availability.matchConfidence === "high" || availability.source === "local-override" || availability.override === true;
}

function isLocalAvailabilityOverride(availability) {
  return availability?.source === "local-override"
    || availability?.override === true
    || availability?.totalSource === "override"
    || availability?.forceAiring === true;
}

function hasFinalizedAvailabilityTotalMismatch(entry, availability) {
  if (!entry || !availability || availability.status !== "found" || availability.cachePermanent !== true) {
    return false;
  }
  const isAiring = entry.isAiring || availability.forceAiring === true;
  const availabilityTotal = Number(availability.totalEpisodes);
  const anilistTotal = Number(entry.totalEpisodes);
  return !isAiring
    && Number.isFinite(availabilityTotal)
    && Number.isFinite(anilistTotal)
    && availabilityTotal > 0
    && anilistTotal > 0
    && availabilityTotal !== anilistTotal;
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

function knownEpisodeTotal(entry, availability) {
  const availabilityTotal = Number(availability?.totalEpisodes);
  if (Number.isFinite(availabilityTotal) && availabilityTotal > 0) {
    return availabilityTotal;
  }
  const entryTotal = Number(entry?.totalEpisodes);
  return Number.isFinite(entryTotal) && entryTotal > 0 ? entryTotal : null;
}

function numericFilterValue(field, entry, availability) {
  if (field === "year") {
    return entryYear(entry);
  }
  if (field === "publicScore") {
    const score = Number(entry.publicScore);
    return Number.isFinite(score) && score > 0 ? score / 10 : null;
  }
  if (field === "episodeCount") {
    return knownEpisodeTotal(entry, availability);
  }
  if (field === "progress") {
    const progress = Number(entry.progress);
    return Number.isFinite(progress) ? progress : null;
  }
  if (field === "subEpisodes") {
    const subEpisodes = Number(availability?.subEpisodes);
    return Number.isFinite(subEpisodes) ? subEpisodes : null;
  }
  if (field === "dubEpisodes") {
    const dubEpisodes = Number(availability?.dubEpisodes);
    return Number.isFinite(dubEpisodes) ? dubEpisodes : null;
  }
  return null;
}

function matchesNumericFilter(value, filter) {
  const target = Number(filter?.value);
  if (!filter?.operator || !Number.isFinite(target)) {
    return true;
  }
  if (!Number.isFinite(value)) {
    return false;
  }
  if (filter.operator === ">") {
    return value > target;
  }
  if (filter.operator === ">=") {
    return value >= target;
  }
  if (filter.operator === "<") {
    return value < target;
  }
  if (filter.operator === "<=") {
    return value <= target;
  }
  return value === target;
}

function entryMatchesAdvancedFilter(entry, context) {
  const filter = normalizeAdvancedFilter(context.filter);
  const availability = context.availability?.[entry.mediaId] || {};
  const normalizedQuery = filter.query.trim().toLowerCase();
  const normalizedTitle = filter.title.trim().toLowerCase();
  const normalizedNotes = filter.notes.trim().toLowerCase();
  const notes = String(entry.notes || "");
  const titles = [entry.title, entry.romajiTitle, entry.englishTitle, entry.nativeTitle].filter(Boolean).map((value) => String(value).toLowerCase());

  const matchesQuery = !normalizedQuery || [...titles, notes.toLowerCase()].some((value) => value.includes(normalizedQuery));
  const matchesTitle = !normalizedTitle || titles.some((value) => value.includes(normalizedTitle));
  const matchesNotes = !normalizedNotes || notes.toLowerCase().includes(normalizedNotes);
  const matchesComplete = !filter.completeOnly || isAvailabilityComplete(availability);
  const matchesIncomplete = !filter.incompleteOnly || isAvailabilityIncomplete(availability);
  const matchesDub = !filter.dubOnly || Number(availability.dubEpisodes || 0) > 0;
  const matchesUnwatchedAlert = !filter.unwatchedAlertOnly || Boolean(availabilityAlertState(entry, availability, context.activeStatus, context.watchNow).label);
  const totalEpisodes = knownEpisodeTotal(entry, availability);
  const matchesProgressComplete = !filter.progressCompleteOnly || (Number.isFinite(totalEpisodes) && totalEpisodes > 0 && Number(entry.progress) >= totalEpisodes);
  const matchesProgressIncomplete = !filter.progressIncompleteOnly || (Number.isFinite(totalEpisodes) && totalEpisodes > 0 && Number(entry.progress) < totalEpisodes);
  const matchesOverride = !filter.availabilityOverrideOnly || isLocalAvailabilityOverride(availability);
  const matchesHasNotes = !filter.hasNotesOnly || notes.trim().length > 0;
  const personalScore = Number(entry.score);
  const hasPersonalScore = Number.isFinite(personalScore) && personalScore > 0;
  const matchesHasScore = !filter.hasScoreOnly || hasPersonalScore;
  const matchesMissingScore = !filter.missingScoreOnly || !hasPersonalScore;
  const matchesFormat = filter.formats.length === 0 || filter.formats.includes(entry.format);
  const entryGenres = new Set((entry.genres || []).map((genre) => String(genre)));
  const matchesGenres = filter.genres.length === 0 || filter.genres.every((genre) => entryGenres.has(genre));
  const ratingLabel = String(context.ratings?.[entry.mediaId]?.ratingLabel || "").trim();
  const matchesRatings = filter.ratings.length === 0 || filter.ratings.includes(ratingLabel);
  const matchesNumeric = NUMERIC_FILTER_FIELDS.every((field) => matchesNumericFilter(numericFilterValue(field.value, entry, availability), filter.numeric[field.value]));

  return matchesQuery
    && matchesTitle
    && matchesNotes
    && matchesComplete
    && matchesIncomplete
    && matchesDub
    && matchesUnwatchedAlert
    && matchesProgressComplete
    && matchesProgressIncomplete
    && matchesOverride
    && matchesHasNotes
    && matchesHasScore
    && matchesMissingScore
    && matchesFormat
    && matchesGenres
    && matchesRatings
    && matchesNumeric;
}

function compareTextValues(a, b, direction) {
  const valueA = String(a || "").trim();
  const valueB = String(b || "").trim();
  if (!valueA && !valueB) {
    return 0;
  }
  if (!valueA) {
    return 1;
  }
  if (!valueB) {
    return -1;
  }
  const compared = valueA.localeCompare(valueB, undefined, { sensitivity: "base" });
  return direction === "desc" ? -compared : compared;
}

function compareNumberValues(a, b, direction) {
  const validA = Number.isFinite(a);
  const validB = Number.isFinite(b);
  if (!validA && !validB) {
    return 0;
  }
  if (!validA) {
    return 1;
  }
  if (!validB) {
    return -1;
  }
  return direction === "asc" ? a - b : b - a;
}

function compareEntriesBySortField(a, b, field, direction, context) {
  const availabilityA = context.availability?.[a.mediaId] || {};
  const availabilityB = context.availability?.[b.mediaId] || {};
  if (field === "english") {
    return compareTextValues(a.title, b.title, direction);
  }
  if (field === "romaji") {
    return compareTextValues(a.romajiTitle || a.title, b.romajiTitle || b.title, direction);
  }
  if (field === "notes") {
    return compareTextValues(a.notes, b.notes, direction);
  }
  if (field === "personalScore") {
    const scoreA = Number(a.score) || null;
    const scoreB = Number(b.score) || null;
    return compareNumberValues(scoreA && scoreA > 0 ? scoreA : null, scoreB && scoreB > 0 ? scoreB : null, direction);
  }
  if (field === "rating") {
    const ratingA = RATING_SORT_RANKS[context.ratings?.[a.mediaId]?.ratingLabel || ""] || null;
    const ratingB = RATING_SORT_RANKS[context.ratings?.[b.mediaId]?.ratingLabel || ""] || null;
    return compareNumberValues(ratingA, ratingB, direction);
  }
  if (field === "total") {
    return compareNumberValues(knownEpisodeTotal(a, availabilityA), knownEpisodeTotal(b, availabilityB), direction);
  }
  if (field === "sub") {
    return compareNumberValues(Number(availabilityA.subEpisodes), Number(availabilityB.subEpisodes), direction);
  }
  if (field === "dub") {
    return compareNumberValues(Number(availabilityA.dubEpisodes), Number(availabilityB.dubEpisodes), direction);
  }
  if (field === "publicScore") {
    const scoreA = Number(a.publicScore) || null;
    const scoreB = Number(b.publicScore) || null;
    return compareNumberValues(scoreA && scoreA > 0 ? scoreA : null, scoreB && scoreB > 0 ? scoreB : null, direction);
  }
  if (field === "progress") {
    return compareNumberValues(Number(a.progress), Number(b.progress), direction);
  }
  if (field === "year") {
    return compareNumberValues(entryYear(a), entryYear(b), direction);
  }
  return compareTextValues(a.title, b.title, direction);
}

function compareEntriesByAdvancedSort(a, b, context) {
  const sort = normalizeAdvancedFilter(context.filter).sort;
  const primary = compareEntriesBySortField(a, b, sort.primary, sort.primaryDirection, context);
  if (primary !== 0) {
    return primary;
  }
  if (sort.secondary) {
    const secondary = compareEntriesBySortField(a, b, sort.secondary, sort.secondaryDirection, context);
    if (secondary !== 0) {
      return secondary;
    }
  }
  return compareTextValues(a.title, b.title, "asc");
}

function compareAddSearchEntries(a, b, sortOrder) {
  const field = SORT_OPTIONS.some((option) => option.value === sortOrder) ? sortOrder : "english";
  return compareEntriesByAdvancedSort(a, b, {
    filter: {
      sort: {
        primary: field,
        primaryDirection: defaultSortDirection(field),
        secondary: "",
        secondaryDirection: "desc"
      }
    },
    availability: {},
    ratings: {}
  });
}

function availableGenreOptions(entries) {
  return [...new Set(entries.flatMap((entry) => entry.genres || []).map((genre) => String(genre)).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function availableRatingOptions(entries, ratings) {
  return [...new Set(entries.map((entry) => ratings?.[entry.mediaId]?.ratingLabel).map((rating) => String(rating || "").trim()).filter(Boolean))]
    .sort((a, b) => {
      const rankA = RATING_SORT_RANKS[a] || 0;
      const rankB = RATING_SORT_RANKS[b] || 0;
      return rankB - rankA || a.localeCompare(b, undefined, { sensitivity: "base" });
    });
}

function advancedFilterHasActiveCriteria(filter) {
  const normalized = normalizeAdvancedFilter(filter);
  return Boolean(
    normalized.query.trim()
    || normalized.title.trim()
    || normalized.notes.trim()
    || normalized.completeOnly
    || normalized.incompleteOnly
    || normalized.dubOnly
    || normalized.unwatchedAlertOnly
    || normalized.progressCompleteOnly
    || normalized.progressIncompleteOnly
    || normalized.availabilityOverrideOnly
    || normalized.hasNotesOnly
    || normalized.hasScoreOnly
    || normalized.missingScoreOnly
    || normalized.formats.length > 0
    || normalized.genres.length > 0
    || normalized.ratings.length > 0
    || NUMERIC_FILTER_FIELDS.some((field) => normalized.numeric[field.value].operator && normalized.numeric[field.value].value !== "")
    || normalized.sort.primary !== "english"
    || normalized.sort.primaryDirection !== "asc"
    || normalized.sort.secondary
  );
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
  const hasFinalizedTotalMismatch = hasFinalizedAvailabilityTotalMismatch(entry, availability);
  const hasDub = Number(availability.dubEpisodes) > 0;
  const alertLabel = availabilityAlertState(entry, availability, activeStatus, watchNow).label;
  const subComplete = Number(availability.subEpisodes) >= Number(availability.totalEpisodes);
  const dubComplete = hasDub && Number(availability.dubEpisodes) >= Number(availability.totalEpisodes);
  const title = forceComplete
    ? "Completed"
    : hasFinalizedTotalMismatch
      ? "MAL/Jikan discrepancy with AniList. Right-click to override."
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
          hasFinalizedTotalMismatch ? "total-mismatch" : "",
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
        Copy Name
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

function AdvancedFilterMenu({ menu, onClose, onClear }) {
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

  function clearFilter() {
    onClear();
    onClose();
  }

  return (
    <div
      className="row-title-menu"
      style={{ left: menu.x, top: menu.y }}
      onClick={(event) => event.stopPropagation()}
      role="menu"
      aria-label="Advanced filter actions"
    >
      <button type="button" role="menuitem" onClick={clearFilter}>
        Clear Filter
      </button>
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
    subtitleSource: showRomajiSubtitle ? "romaji" : showSynonymSubtitle ? "synonym" : "",
    synonyms
  };
}

function EntrySubtitle({ entry, showSynonymSubtitle, showSynonymInfoIcon }) {
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const subtitleRef = useRef(null);
  const { subtitle, synonyms } = entrySubtitleDetails(entry);
  const hasSynonymSubtitle = Boolean(subtitle && synonyms.length > 0);
  const visibleSubtitle = !showSynonymSubtitle && hasSynonymSubtitle ? "" : subtitle;
  const showTooltip = Boolean(showSynonymInfoIcon && visibleSubtitle && synonyms.length > 0);

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

  if (!showSynonymSubtitle && hasSynonymSubtitle) {
    return null;
  }

  return (
    <div ref={subtitleRef} className={showTooltip && tooltipOpen ? "subtitle synonym-subtitle open" : showTooltip ? "subtitle synonym-subtitle" : "subtitle"}>
      <span>{visibleSubtitle}</span>
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

function hasHiddenSynonymSubtitle(entry, showSynonymSubtitle) {
  if (showSynonymSubtitle) {
    return false;
  }
  const { subtitle, synonyms } = entrySubtitleDetails(entry);
  return Boolean(subtitle && synonyms.length > 0);
}

function EntryRow({ entry, selected, onSelectedChange, onUpdate, onDelete, activeStatus, availability, rating, watchNow, alertIconId, showSynonymSubtitle, showSynonymInfoIcon, onRefreshNeeded, onAvailabilityOverride, onPreviewFocus, previewFocused, showNotes, simplifiedView, onNoteError, offlineMode, onOpenWatchServerMenu }) {
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
    <article className={simplifiedView ? "entry-row simplified-entry-row" : "entry-row"}>
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
      <div className="entry-main">
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
        {!simplifiedView ? (
          <div className={hasHiddenSynonymSubtitle(entry, showSynonymSubtitle) ? "entry-detail-band subtitle-hidden" : "entry-detail-band"}>
            <EntrySubtitle entry={entry} showSynonymSubtitle={showSynonymSubtitle} showSynonymInfoIcon={showSynonymInfoIcon} />
            <div className="airing">{entry.nextAiringEpisode ? formatAiring(entry.nextAiringEpisode) : ""}</div>
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
        ) : null}
      </div>
      {!simplifiedView ? (
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
      ) : null}
      <ProgressControl
        entry={entry}
        onUpdate={onUpdate}
        onRefreshNeeded={onRefreshNeeded}
        shouldRefreshAtTotal={activeStatus !== "COMPLETED" && !simplifiedView}
        offlineMode={offlineMode}
      />
      <ScoreControl entry={entry} onUpdate={onUpdate} />
      {simplifiedView ? (
        <>
          <NoteControl entry={entry} onUpdate={onUpdate} onError={onNoteError} />
          <ListStatusControl entry={entry} activeStatus={activeStatus} moving={moving} deleting={deleting} onMove={moveTo} />
        </>
      ) : showNotes ? (
        <NoteControl entry={entry} onUpdate={onUpdate} onError={onNoteError} />
      ) : (
        <ListStatusControl entry={entry} activeStatus={activeStatus} moving={moving} deleting={deleting} onMove={moveTo} />
      )}
    </article>
  );
}

function AddSearchResultRow({ entry, availability, watchNow, alertIconId, showSynonymSubtitle, showSynonymInfoIcon, onAdded, onPreviewFocus, previewFocused, offlineMode, onOpenWatchServerMenu }) {
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
      <div className="entry-main">
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
        <div className={hasHiddenSynonymSubtitle(entry, showSynonymSubtitle) ? "entry-detail-band subtitle-hidden" : "entry-detail-band"}>
          <EntrySubtitle entry={entry} showSynonymSubtitle={showSynonymSubtitle} showSynonymInfoIcon={showSynonymInfoIcon} />
          <div className="airing">{entry.nextAiringEpisode ? formatAiring(entry.nextAiringEpisode) : ""}</div>
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

function AdvancedFilterDialog({ open, activeStatus, filter, advancedFilters, genreOptions, ratingOptions, alertsFilterEnabled, onClose, onApply, onSaveAdvancedFilters }) {
  const [draft, setDraft] = useState(() => normalizeAdvancedFilter(filter));
  const [saveName, setSaveName] = useState("");
  const [saveAsDefault, setSaveAsDefault] = useState(false);
  const [selectedSavedId, setSelectedSavedId] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const savedFilters = advancedFilters?.filters || [];
  const defaultSavedId = advancedFilters?.defaultByStatus?.[activeStatus] || "";

  useEffect(() => {
    if (open) {
      setDraft(normalizeAdvancedFilter(filter));
      setSaveName("");
      setSaveAsDefault(false);
      setSelectedSavedId(defaultSavedId || "");
      setMessage("");
      setError("");
    }
  }, [open, filter, defaultSavedId]);

  if (!open) {
    return null;
  }

  function updateDraft(updater) {
    setDraft((current) => normalizeAdvancedFilter(typeof updater === "function" ? updater(current) : { ...current, ...updater }));
  }

  function updateBoolean(name, checked) {
    updateDraft((current) => ({
      ...current,
      completeOnly: name === "incompleteOnly" && checked ? false : current.completeOnly,
      incompleteOnly: name === "completeOnly" && checked ? false : current.incompleteOnly,
      progressCompleteOnly: name === "progressIncompleteOnly" && checked ? false : current.progressCompleteOnly,
      progressIncompleteOnly: name === "progressCompleteOnly" && checked ? false : current.progressIncompleteOnly,
      hasScoreOnly: name === "missingScoreOnly" && checked ? false : current.hasScoreOnly,
      missingScoreOnly: name === "hasScoreOnly" && checked ? false : current.missingScoreOnly,
      [name]: checked
    }));
  }

  function toggleListValue(name, value, checked) {
    updateDraft((current) => {
      const values = new Set(current[name] || []);
      if (checked) {
        values.add(value);
      } else {
        values.delete(value);
      }
      return { ...current, [name]: [...values] };
    });
  }

  function updateNumeric(field, patch) {
    updateDraft((current) => ({
      ...current,
      numeric: {
        ...current.numeric,
        [field]: {
          ...current.numeric[field],
          ...patch
        }
      }
    }));
  }

  async function persistAdvancedFilters(nextAdvancedFilters, successMessage) {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await onSaveAdvancedFilters(nextAdvancedFilters);
      setMessage(successMessage);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  async function saveCurrentFilter() {
    const name = saveName.trim();
    if (!name) {
      setError("Enter a saved filter name.");
      return;
    }

    const existing = savedFilters.find((savedFilter) => savedFilter.name.toLowerCase() === name.toLowerCase());
    if (existing && !window.confirm(`Overwrite saved filter "${existing.name}"?`)) {
      return;
    }

    const id = existing?.id || `filter-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const savedFilter = { id, name, filter: normalizeAdvancedFilter(draft) };
    const nextFilters = existing
      ? savedFilters.map((item) => item.id === existing.id ? savedFilter : item)
      : [...savedFilters, savedFilter];
    const defaultByStatus = { ...(advancedFilters?.defaultByStatus || {}) };
    if (saveAsDefault) {
      defaultByStatus[activeStatus] = id;
    }

    setSelectedSavedId(id);
    await persistAdvancedFilters({ filters: nextFilters, defaultByStatus }, saveAsDefault ? "Saved and set as default." : "Saved filter.");
  }

  function loadSavedFilter() {
    const savedFilter = savedFilters.find((item) => item.id === selectedSavedId);
    if (!savedFilter) {
      return;
    }
    setDraft(normalizeAdvancedFilter(savedFilter.filter));
    setSaveName(savedFilter.name);
    setMessage(`Loaded "${savedFilter.name}".`);
    setError("");
  }

  async function deleteSavedFilter() {
    const savedFilter = savedFilters.find((item) => item.id === selectedSavedId);
    if (!savedFilter || !window.confirm(`Delete saved filter "${savedFilter.name}"?`)) {
      return;
    }
    const nextFilters = savedFilters.filter((item) => item.id !== savedFilter.id);
    const defaultByStatus = Object.fromEntries(Object.entries(advancedFilters?.defaultByStatus || {}).filter(([, id]) => id !== savedFilter.id));
    setSelectedSavedId("");
    await persistAdvancedFilters({ filters: nextFilters, defaultByStatus }, "Deleted saved filter.");
  }

  async function setSelectedAsDefault() {
    const savedFilter = savedFilters.find((item) => item.id === selectedSavedId);
    if (!savedFilter) {
      setError("Choose a saved filter first.");
      return;
    }
    await persistAdvancedFilters({
      filters: savedFilters,
      defaultByStatus: {
        ...(advancedFilters?.defaultByStatus || {}),
        [activeStatus]: savedFilter.id
      }
    }, `Default set to "${savedFilter.name}".`);
  }

  async function clearDefault() {
    const defaultByStatus = { ...(advancedFilters?.defaultByStatus || {}) };
    delete defaultByStatus[activeStatus];
    await persistAdvancedFilters({ filters: savedFilters, defaultByStatus }, "Default cleared.");
  }

  function applyDraft() {
    onApply(normalizeAdvancedFilter(draft));
    onClose();
  }

  function clearAndApplyFilter() {
    const clearedFilter = defaultAdvancedFilter();
    setDraft(clearedFilter);
    onApply(clearedFilter);
    onClose();
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="advanced-filter-dialog" role="dialog" aria-modal="true" aria-labelledby="advanced-filter-title">
        <div className="dialog-header">
          <div className="dialog-title-row">
            <h2 id="advanced-filter-title">Advanced Filters</h2>
            <span className="app-version">{statusLabel(activeStatus)}</span>
          </div>
          <button type="button" className="icon-close" title="Close without applying draft changes." onClick={onClose} aria-label="Close advanced filters">
            x
          </button>
        </div>

        <div className="advanced-filter-body">
          {message ? <div className="success-banner compact">{message}</div> : null}
          {error ? <div className="error-banner compact">{error}</div> : null}

          <section className="advanced-filter-section">
            <h3>Saved Filters</h3>
            <div className="advanced-filter-row-grid saved-filter-grid">
              <label className="field-stack">
                <span>Saved filter</span>
                <select value={selectedSavedId} title="Choose a saved advanced filter to load, set as default, or delete." onChange={(event) => setSelectedSavedId(event.target.value)}>
                  <option value="">Choose saved filter</option>
                  {savedFilters.map((savedFilter) => (
                    <option value={savedFilter.id} key={savedFilter.id}>
                      {savedFilter.name}{savedFilter.id === defaultSavedId ? " (default)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" title="Load the selected saved filter into the draft controls." disabled={!selectedSavedId || saving} onClick={loadSavedFilter}>Load</button>
              <button type="button" title="Use the selected saved filter automatically for this status tab." disabled={!selectedSavedId || saving} onClick={setSelectedAsDefault}>Always Load</button>
              <button type="button" className="danger-button" title="Delete the selected saved filter." disabled={!selectedSavedId || saving} onClick={deleteSavedFilter}>Delete</button>
            </div>
            <div className="advanced-filter-row-grid save-filter-grid">
              <label className="field-stack">
                <span>Name</span>
                <input value={saveName} maxLength={80} title="Name used when saving the current draft filter." onChange={(event) => setSaveName(event.target.value)} placeholder="Saved filter name" />
              </label>
              <label className="checkbox-row" title="Also make this saved filter the default for this status tab.">
                <input type="checkbox" checked={saveAsDefault} onChange={(event) => setSaveAsDefault(event.target.checked)} />
                Always load for this tab
              </label>
              <button type="button" title="Save the current draft filter under the entered name." disabled={saving} onClick={saveCurrentFilter}>{saving ? "Saving..." : "Save Current"}</button>
              <button type="button" className="ghost-button" title="Stop automatically loading a saved filter for this status tab." disabled={!defaultSavedId || saving} onClick={clearDefault}>Clear Default</button>
            </div>
          </section>

          <section className="advanced-filter-section">
            <h3>Text</h3>
            <div className="advanced-filter-row-grid three-column-grid">
              <label className="field-stack">
                <span>Search titles or notes</span>
                <input value={draft.query} title="Match text in titles or notes." onChange={(event) => updateDraft({ query: event.target.value })} />
              </label>
              <label className="field-stack">
                <span>Title contains</span>
                <input value={draft.title} title="Match text in any loaded title field." onChange={(event) => updateDraft({ title: event.target.value })} />
              </label>
              <label className="field-stack">
                <span>Notes contain</span>
                <input value={draft.notes} title="Match text in AniList notes." onChange={(event) => updateDraft({ notes: event.target.value })} />
              </label>
            </div>
          </section>

          <section className="advanced-filter-section">
            <h3>Flags</h3>
            <div className="advanced-filter-chip-grid">
              <fieldset className="advanced-filter-flag-group" title="Filter by availability completion state. Only one option in this group can be active.">
                <legend>Availability</legend>
                <label className="filter-chip">
                  <input type="checkbox" checked={draft.completeOnly} onChange={(event) => updateBoolean("completeOnly", event.target.checked)} />
                  Complete
                </label>
                <label className="filter-chip">
                  <input type="checkbox" checked={draft.incompleteOnly} onChange={(event) => updateBoolean("incompleteOnly", event.target.checked)} />
                  Incomplete
                </label>
              </fieldset>
              <fieldset className="advanced-filter-flag-group" title="Filter by watched progress compared with the known episode total. Only one option in this group can be active.">
                <legend>Progress</legend>
                <label className="filter-chip">
                  <input type="checkbox" checked={draft.progressCompleteOnly} onChange={(event) => updateBoolean("progressCompleteOnly", event.target.checked)} />
                  Complete
                </label>
                <label className="filter-chip">
                  <input type="checkbox" checked={draft.progressIncompleteOnly} onChange={(event) => updateBoolean("progressIncompleteOnly", event.target.checked)} />
                  Incomplete
                </label>
              </fieldset>
              <fieldset className="advanced-filter-flag-group" title="Filter by whether your AniList score is present. Only one option in this group can be active.">
                <legend>Score</legend>
                <label className="filter-chip">
                  <input type="checkbox" checked={draft.hasScoreOnly} onChange={(event) => updateBoolean("hasScoreOnly", event.target.checked)} />
                  Has
                </label>
                <label className="filter-chip">
                  <input type="checkbox" checked={draft.missingScoreOnly} onChange={(event) => updateBoolean("missingScoreOnly", event.target.checked)} />
                  Missing
                </label>
              </fieldset>
              <label className="filter-chip" title="Show entries with at least one dubbed episode available.">
                <input type="checkbox" checked={draft.dubOnly} onChange={(event) => updateBoolean("dubOnly", event.target.checked)} />
                Has dub
              </label>
              <label className={alertsFilterEnabled ? "filter-chip" : "filter-chip disabled"} title={alertsFilterEnabled ? "Show entries with a configured unwatched availability alert." : "Enable an unwatched sub or dub alert in Watch Now settings to use this filter."}>
                <input type="checkbox" checked={draft.unwatchedAlertOnly && alertsFilterEnabled} disabled={!alertsFilterEnabled} onChange={(event) => updateBoolean("unwatchedAlertOnly", event.target.checked)} />
                Alerts
              </label>
              <label className="filter-chip" title="Show entries with a local count override or forced airing override.">
                <input type="checkbox" checked={draft.availabilityOverrideOnly} onChange={(event) => updateBoolean("availabilityOverrideOnly", event.target.checked)} />
                Has count/airing override
              </label>
              <label className="filter-chip" title="Show entries that have AniList notes.">
                <input type="checkbox" checked={draft.hasNotesOnly} onChange={(event) => updateBoolean("hasNotesOnly", event.target.checked)} />
                Has notes
              </label>
            </div>
          </section>

          <section className="advanced-filter-section">
            <h3>Formats, Genres, And Ratings</h3>
            <div className="advanced-filter-option-block">
              <strong>Series format</strong>
              <div className="advanced-filter-chip-grid">
                {Object.entries(FORMAT_LABELS).map(([value, label]) => (
                  <label className="filter-chip" title={`Show ${label} entries.`} key={value}>
                    <input type="checkbox" checked={draft.formats.includes(value)} onChange={(event) => toggleListValue("formats", value, event.target.checked)} />
                    {label}
                  </label>
                ))}
              </div>
            </div>
            <div className="advanced-filter-option-block">
              <strong>Genres</strong>
              {genreOptions.length === 0 ? <p>No genres are loaded for this list yet.</p> : (
                <div className="advanced-filter-chip-grid genre-chip-grid">
                  {genreOptions.map((genre) => (
                    <label className="filter-chip" title={`Show entries tagged with ${genre}.`} key={genre}>
                      <input type="checkbox" checked={draft.genres.includes(genre)} onChange={(event) => toggleListValue("genres", genre, event.target.checked)} />
                      {genre}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="advanced-filter-option-block">
              <strong>Ratings</strong>
              {ratingOptions.length === 0 ? <p>No cached ratings are loaded for this list yet.</p> : (
                <div className="advanced-filter-chip-grid">
                  {ratingOptions.map((rating) => (
                    <label className="filter-chip" title={`Show entries with cached rating ${rating}.`} key={rating}>
                      <input type="checkbox" checked={draft.ratings.includes(rating)} onChange={(event) => toggleListValue("ratings", rating, event.target.checked)} />
                      {rating}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="advanced-filter-section">
            <h3>Numeric Filters</h3>
            <div className="numeric-filter-grid">
              {NUMERIC_FILTER_FIELDS.map((field) => (
                <div className="numeric-filter-row" key={field.value}>
                  <span>{field.label}</span>
                  <select value={draft.numeric[field.value].operator} title={`Comparison operator for ${field.label}.`} onChange={(event) => updateNumeric(field.value, { operator: event.target.value })} aria-label={`${field.label} operator`}>
                    <option value="">Any</option>
                    {NUMERIC_FILTER_OPERATORS.map((operator) => (
                      <option value={operator.value} key={operator.value}>{operator.label}</option>
                    ))}
                  </select>
                  <input
                    value={draft.numeric[field.value].value}
                    inputMode="decimal"
                    title={`Comparison value for ${field.label}. Leave blank to ignore this filter.`}
                    onChange={(event) => updateNumeric(field.value, { value: event.target.value.replace(/[^0-9.-]/g, "") })}
                    aria-label={`${field.label} value`}
                  />
                </div>
              ))}
            </div>
          </section>

          <section className="advanced-filter-section">
            <h3>Sorting</h3>
            <div className="advanced-filter-row-grid sort-filter-grid">
              <label className="field-stack">
                <span>Primary</span>
                <select
                  value={draft.sort.primary}
                  title="Primary sort field for filtered results."
                  onChange={(event) => updateDraft((current) => ({
                    ...current,
                    sort: {
                      ...current.sort,
                      primary: event.target.value,
                      primaryDirection: defaultSortDirection(event.target.value),
                      secondary: current.sort.secondary === event.target.value ? "" : current.sort.secondary
                    }
                  }))}
                >
                  {SORT_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label className="field-stack">
                <span>Direction</span>
                <select value={draft.sort.primaryDirection} title="Direction for the primary sort field." onChange={(event) => updateDraft((current) => ({ ...current, sort: { ...current.sort, primaryDirection: event.target.value } }))}>
                  {SORT_DIRECTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label className="field-stack">
                <span>Secondary</span>
                <select value={draft.sort.secondary} title="Optional secondary sort field used when primary values match." onChange={(event) => updateDraft((current) => ({ ...current, sort: { ...current.sort, secondary: event.target.value, secondaryDirection: defaultSortDirection(event.target.value || "year") } }))}>
                  <option value="">None</option>
                  {SORT_OPTIONS.filter((option) => option.value !== draft.sort.primary).map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label className="field-stack">
                <span>Direction</span>
                <select value={draft.sort.secondaryDirection} title="Direction for the secondary sort field." disabled={!draft.sort.secondary} onChange={(event) => updateDraft((current) => ({ ...current, sort: { ...current.sort, secondaryDirection: event.target.value } }))}>
                  {SORT_DIRECTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                </select>
              </label>
            </div>
          </section>
        </div>

        <div className="advanced-filter-actions">
          <button type="button" className="ghost-button" title="Reset the draft controls without applying yet." onClick={() => setDraft(defaultAdvancedFilter())}>Reset</button>
          <button type="button" className="ghost-button" title="Clear all filters, apply immediately, and close this dialog." onClick={clearAndApplyFilter}>Clear Filter</button>
          <button type="button" title="Apply the current draft filter and close this dialog." onClick={applyDraft}>Apply</button>
        </div>
      </section>
    </div>
  );
}

function AuthSettingsDialog({ open, onClose, onAuthChanged, settings, onSettingsChanged, offlineMode, updateInfo, onCheckUpdate }) {
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

  function switchSettingsTab(tab) {
    setActiveTab(tab);
    setMessage("");
    setError("");
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

  async function checkForUpdatesFromSettings() {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const payload = await onCheckUpdate();
      if (payload?.updateAvailable) {
        setMessage(`Update available: v${payload.latestVersion}.`);
      } else if (payload?.error) {
        setMessage("Update check completed. No available update is currently cached.");
      } else {
        setMessage("You are on the latest available version.");
      }
    } catch (updateError) {
      setError(updateError.message || "Could not check for updates.");
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
          <button type="button" className={activeTab === "auth" ? "active" : ""} onClick={() => switchSettingsTab("auth")}>
            Authentication
          </button>
          <button type="button" className={activeTab === "watch" ? "active" : ""} onClick={() => switchSettingsTab("watch")}>
            Watch Now
          </button>
          <button type="button" className={activeTab === "appearance" ? "active" : ""} onClick={() => switchSettingsTab("appearance")}>
            Appearance
          </button>
          <button type="button" className={activeTab === "updates" ? "active" : ""} onClick={() => switchSettingsTab("updates")}>
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
                  checked={settings.appearance.showSynonymSubtitle}
                  disabled={saving}
                  onChange={(event) => saveAppearance({ showSynonymSubtitle: event.target.checked })}
                />
                Show synonym subtitle
              </label>
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
              <dl className="auth-summary">
                <div>
                  <dt>Current</dt>
                  <dd>v{updateInfo?.currentVersion || APP_VERSION.replace(/^v/i, "")}</dd>
                </div>
                <div>
                  <dt>Latest</dt>
                  <dd>{updateInfo?.latestVersion ? `v${updateInfo.latestVersion}` : "Not checked"}</dd>
                </div>
              </dl>
              {updateInfo?.error ? <div className="inline-warning">{updateInfo.error}</div> : null}
              <div className="settings-actions">
                <button type="button" disabled={saving} onClick={checkForUpdatesFromSettings}>
                  {saving ? "Checking..." : "Check for Updates"}
                </button>
              </div>
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
  const [releaseNotesView, setReleaseNotesView] = useState("update");
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateMessage, setUpdateMessage] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }
    setActiveView("about");
    setReleaseNotesView("update");
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
  const currentReleaseNotes = updateInfo?.currentReleaseNotes ? parseMarkdown(updateInfo.currentReleaseNotes) : "";
  const updateReleaseNotes = updateInfo?.releaseNotes ? parseMarkdown(updateInfo.releaseNotes) : "";
  const activeReleaseNotesView = updateAvailable ? releaseNotesView : "current";
  const displayedReleaseNotes = activeReleaseNotesView === "current" ? currentReleaseNotes : updateReleaseNotes;
  const releaseDate = formatUpdateDate(updateInfo?.publishedAt);
  const currentVersion = updateInfo?.currentVersion || APP_VERSION.replace(/^v/i, "");
  const latestVersion = updateInfo?.latestVersion || currentVersion;
  const latestVersionLabel = `v${latestVersion}`;
  const fallbackAboutNotes = currentReleaseNotes || updateReleaseNotes;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="about-dialog" role="dialog" aria-modal="true" aria-label="About">
        <div className="dialog-header">
          <div className="about-dialog-tabs" role="tablist" aria-label="About tabs">
            <button type="button" className={activeView === "about" ? "active" : ""} onClick={() => setActiveView("about")}>
              About v{currentVersion}
            </button>
            <button
              type="button"
              className={[
                activeView === "update" ? "active" : "",
                updateAvailable && updateInfo?.ignored !== true ? "update-tab-alert" : ""
              ].filter(Boolean).join(" ")}
              onClick={() => setActiveView("update")}
            >
              Updates {latestVersionLabel}
              {updateAvailable && updateInfo?.ignored !== true ? <span className="update-marker" aria-hidden="true" /> : null}
            </button>
          </div>
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
              {!loading && error && fallbackAboutNotes ? (
                <div className="readme-content">
                  <h1>AniList Manager Portable</h1>
                  <p>README.md could not be loaded. Showing GitHub release notes instead.</p>
                  <div dangerouslySetInnerHTML={{ __html: fallbackAboutNotes }} />
                </div>
              ) : null}
            </>
          ) : (
            <section className="update-info-view">
              {updateAvailable || updateInfo?.error ? (
                <div className={updateAvailable ? "success-banner compact" : "inline-warning"}>
                  {updateAvailable ? "A newer version is available." : "Could not check updates."}
                </div>
              ) : null}
              {updateMessage ? <div className="success-banner compact">{updateMessage}</div> : null}
              {updateInfo?.error ? <div className="error-banner compact">{updateInfo.error}</div> : null}

              <dl className="update-summary">
                <div>
                  <dt>Installed version</dt>
                  <dd>v{currentVersion}</dd>
                </div>
                <div>
                  <dt>{updateAvailable ? "Latest version" : "GitHub release"}</dt>
                  <dd>{latestVersionLabel}</dd>
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
                    Open Release Page
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
                {updateAvailable ? (
                  <div className="release-notes-tabs" role="tablist" aria-label="Release notes">
                    <button type="button" className={activeReleaseNotesView === "current" ? "active" : ""} onClick={() => setReleaseNotesView("current")}>
                      Current v{currentVersion}
                    </button>
                    <button type="button" className={activeReleaseNotesView === "update" ? "active" : ""} onClick={() => setReleaseNotesView("update")}>
                      Update {latestVersionLabel}
                    </button>
                  </div>
                ) : null}
                {displayedReleaseNotes ? (
                  <div dangerouslySetInnerHTML={{ __html: displayedReleaseNotes }} />
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
  const [advancedFilterOpen, setAdvancedFilterOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState("");
  const [exportNotice, setExportNotice] = useState(null);
  const [refreshChoiceOpen, setRefreshChoiceOpen] = useState(false);
  const [overrideTarget, setOverrideTarget] = useState(null);
  const [watchServerMenu, setWatchServerMenu] = useState(null);
  const [advancedFilterMenu, setAdvancedFilterMenu] = useState(null);
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
  const [loadDiagnostics, setLoadDiagnostics] = useState("");
  const [loadProgress, setLoadProgress] = useState("");
  const [showNotes, setShowNotes] = useState(() => defaultSettings().showNotes);
  const [advancedFilter, setAdvancedFilter] = useState(() => defaultAdvancedFilter());
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [updatingCompletedProgress, setUpdatingCompletedProgress] = useState(false);
  const [completedProgressUpdate, setCompletedProgressUpdate] = useState({ checked: 0, total: 0 });
  const [focusedPreviewId, setFocusedPreviewId] = useState(null);
  const [focusedPreviewOrigin, setFocusedPreviewOrigin] = useState(null);
  const [error, setError] = useState("");
  const [settingsLoaded, setSettingsLoaded] = useState(false);
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
  const defaultFilterApplyRef = useRef("");
  const previousSimplifiedViewRef = useRef(settings.simplifiedView === true);
  const alertsFilterEnabled = settings.watchNow.showUnwatchedDubAlert === true || settings.watchNow.showUnwatchedSubAlert === true;
  const activeUnwatchedAlertOnly = advancedFilter.unwatchedAlertOnly && alertsFilterEnabled;
  const isAddTab = activeStatus === ADD_STATUS;
  const offlineEnabled = offline?.enabled === true;
  const showUpdateMarker = updateInfo?.updateAvailable === true && updateInfo?.ignored !== true;
  const simplifiedView = settings.simplifiedView === true;
  const dubOnly = advancedFilter.dubOnly;
  const missingScoreOnly = advancedFilter.missingScoreOnly;
  const sortOrder = advancedFilter.sort.primary;
  const genreOptions = useMemo(() => availableGenreOptions(entries), [entries]);
  const ratingOptions = useMemo(() => availableRatingOptions(entries, ratings), [entries, ratings]);
  const advancedFilterActive = advancedFilterHasActiveCriteria(advancedFilter);

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
    setLoadProgress("Checking local app status...");
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
        setLoadDiagnostics("");
        setLoadProgress("");
        setSelectedIds(new Set());
        setError(healthPayload.cliImportAvailable
          ? "AniList token is missing. Open Settings to import your anilist-cli token or save a new token."
          : "AniList token is missing. Open Settings to save a token.");
        return;
      }

      let listPayload;
      if (healthPayload.offline?.enabled === true) {
        setLoadProgress("Loading local list...");
        listPayload = await api(`/api/lists?status=${encodeURIComponent(status)}&type=ANIME`, { signal: abortController.signal });
      } else {
        setLoadProgress("Loading AniList items... 0 found.");
        let chunk = 1;
        let mergedEntries = [];
        const chunkPayloads = [];
        let hasNextChunk = true;
        while (hasNextChunk) {
          const chunkPayload = await api(`/api/lists?status=${encodeURIComponent(status)}&type=ANIME&chunk=${chunk}&perChunk=${LIST_CHUNK_SIZE}`, { signal: abortController.signal });
          if (listRunId.current !== runId) {
            return;
          }
          chunkPayloads.push(chunkPayload);
          mergedEntries = mergeUniqueEntries(mergedEntries, chunkPayload.entries || []);
          setLoadProgress(`Loading AniList items... ${mergedEntries.length} found.`);
          hasNextChunk = chunkPayload.diagnostics?.hasNextChunk === true;
          listPayload = {
            ...chunkPayload,
            entries: mergedEntries,
            diagnostics: combineChunkDiagnostics(chunkPayloads, mergedEntries.length)
          };
          chunk += 1;
        }
      }
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
      setLoadDiagnostics(formatLoadDiagnostics(listPayload.diagnostics));
      setLoadProgress("");
      setSelectedIds(new Set());
      if (!listPayload.offline && !simplifiedView) {
        const cacheOnly = hasRecentAutoAvailability(status);
        if (!cacheOnly) {
          markAutoAvailability(status);
        }
        loadAvailability(listPayload.entries, false, { cacheOnly, preloadReusableCache: true, background: cacheOnly });
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
      setLoadDiagnostics(loadError.details?.source ? `${loadError.details.source}: ${loadError.message}` : "");
      setLoadProgress("");
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
    setLoadDiagnostics("");
    setLoadProgress("");
    setSelectedIds(new Set());
    setRefreshChoiceOpen(false);
    setOverrideTarget(null);
    setWatchServerMenu(null);
    setAdvancedFilterMenu(null);
    setAdvancedFilterOpen(false);
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
    } finally {
      setSettingsLoaded(true);
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

  function updateAdvancedFilter(updater) {
    setAdvancedFilter((current) => normalizeAdvancedFilter(typeof updater === "function" ? updater(current) : { ...current, ...updater }));
  }

  function clearAdvancedFilter() {
    setAdvancedFilter(defaultAdvancedFilter());
  }

  function openAdvancedFilterMenu(event) {
    event.preventDefault();
    event.stopPropagation();
    setAdvancedFilterMenu(linkMenuPosition(event, 170, 48));
  }

  function setAdvancedFilterBoolean(name, checked) {
    updateAdvancedFilter((current) => ({
      ...current,
      completeOnly: name === "incompleteOnly" && checked ? false : current.completeOnly,
      incompleteOnly: name === "completeOnly" && checked ? false : current.incompleteOnly,
      progressCompleteOnly: name === "progressIncompleteOnly" && checked ? false : current.progressCompleteOnly,
      progressIncompleteOnly: name === "progressCompleteOnly" && checked ? false : current.progressIncompleteOnly,
      hasScoreOnly: name === "missingScoreOnly" && checked ? false : current.hasScoreOnly,
      missingScoreOnly: name === "hasScoreOnly" && checked ? false : current.missingScoreOnly,
      [name]: checked
    }));
  }

  function setPrimarySortOrder(value) {
    updateAdvancedFilter((current) => ({
      ...current,
      sort: {
        ...current.sort,
        primary: value,
        primaryDirection: defaultSortDirection(value),
        secondary: current.sort.secondary === value ? "" : current.sort.secondary
      }
    }));
  }

  async function saveAdvancedFilters(nextAdvancedFilters) {
    const normalizedAdvancedFilters = normalizeAdvancedFilters(nextAdvancedFilters);
    const previousSettings = settings;
    setSettings(normalizeSettings({ ...settings, advancedFilters: normalizedAdvancedFilters }));
    try {
      const payload = normalizeSettings(await api("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ advancedFilters: normalizedAdvancedFilters })
      }));
      setSettings(payload);
      return payload.advancedFilters;
    } catch (settingsError) {
      setSettings(previousSettings);
      throw settingsError;
    }
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

  async function toggleSimplifiedView(checked) {
    const previousSettings = settings;
    setSettings(normalizeSettings({ ...settings, simplifiedView: checked }));
    if (checked) {
      cancelAvailabilityRefresh();
      setRefreshChoiceOpen(false);
    }
    try {
      const nextSettings = normalizeSettings(await api("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ simplifiedView: checked })
      }));
      setSettings(nextSettings);
    } catch (settingsError) {
      setSettings(previousSettings);
      setError(settingsError.message);
    }
  }

  async function loadAvailability(entriesToCheck = entries, refresh = false, options = {}) {
    if (offlineEnabled || simplifiedView) {
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
    const preloadReusableCache = options.preloadReusableCache === true && !cacheOnly;
    setAvailabilityLoading(showProgress);
    setAvailabilityProgress({ checked: 0, total: showProgress && !preloadReusableCache ? entriesToCheck.length : 0 });
    setAvailabilityWarning("");
    try {
      let entriesForRefresh = entriesToCheck;
      if (preloadReusableCache && entriesToCheck.length > 0) {
        const reusableMediaIds = new Set();
        for (let index = 0; index < entriesToCheck.length; index += AVAILABILITY_CHUNK_SIZE) {
          const chunk = entriesToCheck.slice(index, index + AVAILABILITY_CHUNK_SIZE);
          const payload = await api("/api/availability/batch", {
            method: "POST",
            signal: abortController.signal,
            body: JSON.stringify({
              usableCacheOnly: true,
              entries: availabilityRequestEntries(chunk)
            })
          });
          if (availabilityRunId.current !== runId) {
            return false;
          }
          const cachedEntries = payload.entries || [];
          for (const entry of cachedEntries) {
            reusableMediaIds.add(entry.mediaId);
          }
          if (cachedEntries.length > 0) {
            setAvailability((currentAvailability) => ({
              ...currentAvailability,
              ...Object.fromEntries(cachedEntries.map((entry) => [entry.mediaId, entry]))
            }));
          }
        }
        entriesForRefresh = entriesToCheck.filter((entry) => !reusableMediaIds.has(entry.mediaId));
        if (showProgress) {
          setAvailabilityProgress({ checked: 0, total: entriesForRefresh.length });
          if (entriesForRefresh.length === 0) {
            setAvailabilityLoading(false);
            return true;
          }
        }
      }

      let index = 0;
      while (index < entriesForRefresh.length) {
        const chunk = entriesForRefresh.slice(index, index + AVAILABILITY_CHUNK_SIZE);
        const payload = await api("/api/availability/batch", {
          method: "POST",
          signal: abortController.signal,
          body: JSON.stringify({
            refresh,
            force: forceRefresh,
            cacheOnly,
            entries: availabilityRequestEntries(chunk)
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
            checked: Math.min(index + Math.max(completedEntries, payload.entries?.length || chunk.length), entriesForRefresh.length),
            total: entriesForRefresh.length
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
    if (simplifiedView) {
      setRefreshChoiceOpen(false);
      setAvailabilityWarning("Recheck Episodes is disabled while Simplified view is active.");
      return;
    }
    const targets = actionTargetEntries();
    const forceSelectedAll = mode === "all" && selectedIds.size > 0;
    const eligibleEntries = mode === "missing"
      ? targets.filter((entry) => isAvailabilityMissing(availability[entry.mediaId]))
      : mode === "airing"
        ? targets.filter((entry) => shouldRefreshAiringAvailability(entry, availability[entry.mediaId]))
        : targets;
    setRefreshChoiceOpen(false);
    if (eligibleEntries.length === 0) {
      setAvailabilityWarning(mode === "airing"
        ? "No airing or dub-behind-sub availability entries in the current target set."
        : "No missing availability entries in the current target set.");
      return;
    }
    const entriesToRefresh = forceSelectedAll
      ? eligibleEntries.filter((entry) => !isLocalAvailabilityOverride(availability[entry.mediaId]))
      : eligibleEntries.filter((entry) => !isPermanentAvailability(availability[entry.mediaId]));
    if (entriesToRefresh.length === 0) {
      setAvailabilityWarning(forceSelectedAll
        ? "Selected entries are local availability overrides. Clear overrides before rechecking provider availability."
        : "No non-permanent availability entries in the current target set.");
      return;
    }
    loadAvailability(entriesToRefresh, true, { force: true, preloadReusableCache: !forceSelectedAll });
  }

  async function recheckEpisodes() {
    if (simplifiedView) {
      setAvailabilityWarning("Recheck Episodes is disabled while Simplified view is active.");
      return;
    }
    if (offlineEnabled) {
      setAvailabilityWarning("Recheck Episodes is disabled while Offline Mode is active.");
      return;
    }
    if (isAddTab) {
      setAddAvailabilityReady(false);
      const entriesToRefresh = sortedAddSearchResults.filter((entry) => !isPermanentAvailability(availability[entry.mediaId]));
      if (entriesToRefresh.length === 0) {
        setAddAvailabilityReady(sortedAddSearchResults.length > 0);
        setAvailabilityWarning("No non-permanent availability entries in the current target set.");
        return;
      }
      const completed = await loadAvailability(entriesToRefresh, true, { force: true, preloadReusableCache: true });
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
    if (settingsLoaded && activeStatus !== ADD_STATUS) {
      load(activeStatus);
    }
  }, [activeStatus, settingsLoaded]);

  useEffect(() => {
    const wasSimplifiedView = previousSimplifiedViewRef.current;
    previousSimplifiedViewRef.current = simplifiedView;
    if (
      !wasSimplifiedView ||
      simplifiedView ||
      !settingsLoaded ||
      isAddTab ||
      offlineEnabled ||
      entries.length === 0
    ) {
      return;
    }

    const cacheOnly = hasRecentAutoAvailability(activeStatus);
    if (!cacheOnly) {
      markAutoAvailability(activeStatus);
    }
    loadAvailability(entries, false, { cacheOnly, preloadReusableCache: true, background: cacheOnly });
    loadRatings(entries);
  }, [activeStatus, entries, isAddTab, offlineEnabled, settingsLoaded, simplifiedView]);

  useEffect(() => {
    if (!alertsFilterEnabled && advancedFilter.unwatchedAlertOnly) {
      updateAdvancedFilter({ unwatchedAlertOnly: false });
    }
  }, [alertsFilterEnabled, advancedFilter.unwatchedAlertOnly]);

  useEffect(() => {
    if (isAddTab) {
      return;
    }
    const defaultSavedId = settings.advancedFilters?.defaultByStatus?.[activeStatus] || "";
    const applyKey = `${activeStatus}:${defaultSavedId}`;
    if (defaultFilterApplyRef.current === applyKey) {
      return;
    }
    defaultFilterApplyRef.current = applyKey;
    const savedFilter = settings.advancedFilters?.filters?.find((item) => item.id === defaultSavedId);
    setAdvancedFilter(savedFilter ? normalizeAdvancedFilter(savedFilter.filter) : defaultAdvancedFilter());
  }, [activeStatus, isAddTab, settings.advancedFilters]);

  const filteredEntries = useMemo(() => {
    const effectiveFilter = normalizeAdvancedFilter({
      ...advancedFilter,
      unwatchedAlertOnly: activeUnwatchedAlertOnly
    });
    const context = { filter: effectiveFilter, availability, ratings, activeStatus, watchNow: settings.watchNow };
    return entries
      .filter((entry) => entryMatchesAdvancedFilter(entry, context))
      .sort((a, b) => compareEntriesByAdvancedSort(a, b, context));
  }, [activeStatus, activeUnwatchedAlertOnly, advancedFilter, availability, entries, ratings, settings.watchNow]);
  const sortedAddSearchResults = useMemo(() => {
    return addSearchResults.filter((entry) => (
      !addDubOnly || Number(availability[entry.mediaId]?.dubEpisodes || 0) > 0
    )).sort((a, b) => compareAddSearchEntries(a, b, sortOrder));
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
            entries: availabilityRequestEntries(chunk)
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

  function completedProgressUpdateItems(targetEntries) {
    return targetEntries
      .filter((entry) => entry.status === "COMPLETED")
      .map((entry) => ({
        entry,
        currentProgress: Number(entry.progress),
        targetProgress: Number(entry.totalEpisodes)
      }))
      .filter((item) => (
        Number.isFinite(item.currentProgress)
        && Number.isFinite(item.targetProgress)
        && item.targetProgress > 0
        && item.currentProgress !== item.targetProgress
      ));
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
          entries: availabilityRequestEntries(chunk)
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
    const updates = completedProgressUpdateItems(actionTargetEntries());

    if (updates.length === 0) {
      setAvailabilityWarning(
        selectedIds.size > 0
          ? "Selected completed entries already match known totals."
          : "Completed entries already match known totals."
      );
      return;
    }
    const selectedText = selectedIds.size > 0 ? " selected" : "";
    const listedUpdates = updates.slice(0, 15).map((item) => `- ${item.entry.title}: ${item.currentProgress} -> ${item.targetProgress}`);
    const truncatedText = updates.length > listedUpdates.length
      ? `\n...and ${updates.length - listedUpdates.length} more.`
      : "";
    const confirmMessage = [
      `Update watched progress for ${updates.length}${selectedText} completed entries to their known totals?`,
      "",
      "Entries to update:",
      ...listedUpdates,
      truncatedText
    ].filter(Boolean).join("\n");
    if (!window.confirm(confirmMessage)) {
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

  const recheckEpisodesTitle = simplifiedView
    ? "Disabled while Simplified view is active."
    : offlineEnabled
      ? "Disabled while Offline Mode is active."
      : "Check current episode availability for the visible list.";
  const notesModeTitle = showNotes
    ? "Return to the standard list view."
    : "Show list entry notes.";
  const exportTitle = exporting
    ? "Export in progress."
    : "Export list data.";
  const offlineModeTitle = offlineEnabled
    ? "Turn off Offline Mode and choose how to handle queued changes."
    : "Use the app without syncing changes until Offline Mode is turned off.";
  const hasIncompleteCompletedProgress = completedProgressUpdateItems(actionTargetEntries()).length > 0;

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
          <div className="header-control-stack">
            <label className="simplified-view-toggle">
              <input
                type="checkbox"
                checked={simplifiedView}
                disabled={isAddTab}
                onChange={(event) => toggleSimplifiedView(event.target.checked)}
              />
              Simplified view
            </label>
            <div className="header-actions command-group">
              <button
                type="button"
                className={showUpdateMarker ? "about-button update-available" : "about-button"}
                title="View app version, release notes, and update details."
                onClick={() => setAboutOpen(true)}
              >
                About
                {showUpdateMarker ? <span className="update-marker" aria-hidden="true" /> : null}
              </button>
              <button type="button" title="Configure auth, watch providers, appearance, and updates." onClick={() => setSettingsOpen(true)}>
                Settings
              </button>
              <button
                type="button"
                className="refresh-availability"
                disabled={simplifiedView || offlineEnabled || availabilityLoading || (isAddTab ? addSearchLoading || sortedAddSearchResults.length === 0 : loading)}
                onClick={recheckEpisodes}
                title={recheckEpisodesTitle}
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
                title="Support development."
                onClick={() => window.open("https://www.paypal.com/donate/?hosted_button_id=JK8ZEGCDMWP94", "_blank", "noreferrer")}
              >
                Donate <span className="heart" aria-hidden="true">❤</span>
              </button>
            </div>
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
            {activeStatus === "COMPLETED" && !isAddTab && (hasIncompleteCompletedProgress || updatingCompletedProgress) ? (
              <button
                type="button"
                className="ghost-button"
                disabled={loading || updatingCompletedProgress}
                title="Set completed entries to their total episode counts."
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
            {!simplifiedView ? (
              <button type="button" className="ghost-button" disabled={isAddTab || loading} title={notesModeTitle} onClick={toggleNotesMode}>
                {showNotes ? "View Lists" : "View Notes"}
              </button>
            ) : null}
            <button type="button" className="ghost-button" disabled={isAddTab || loading || exporting} title={exportTitle} onClick={() => setExportOpen(true)}>
              {exporting ? "Exporting..." : "Export"}
            </button>
            <button
              type="button"
              className={offlineEnabled ? "ghost-button offline-toggle active" : "ghost-button offline-toggle"}
              disabled={offlineBusy}
              title={offlineModeTitle}
              onClick={toggleOfflineMode}
            >
              {offlineBusy ? "Offline..." : offlineEnabled ? "Turn Off Offline" : "Offline Mode"}
            </button>
          </div>
        </div>

        <section className={isAddTab ? "toolbar add-toolbar" : "toolbar"}>
          <div className="toolbar-primary">
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
                  <input value={advancedFilter.query} onChange={(event) => updateAdvancedFilter({ query: event.target.value })} placeholder="Filter titles or notes" />
                </label>
              )}
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
              <button
                type="button"
                className={advancedFilterActive ? "advanced-filter-trigger active" : "advanced-filter-trigger"}
                onClick={() => setAdvancedFilterOpen(true)}
                onContextMenu={openAdvancedFilterMenu}
                aria-label="Advanced sort and filters"
                title="Advanced sort and filters"
              >
                <svg className="sliders-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <line x1="5" y1="3" x2="5" y2="21" />
                  <line x1="12" y1="3" x2="12" y2="21" />
                  <line x1="19" y1="3" x2="19" y2="21" />
                  <circle cx="5" cy="15" r="3.5" />
                  <circle cx="12" cy="8" r="3.5" />
                  <circle cx="19" cy="15" r="3.5" />
                </svg>
              </button>
              <label className="filter-chip">
                <input
                  type="checkbox"
                  checked={dubOnly}
                  onChange={(event) => setAdvancedFilterBoolean("dubOnly", event.target.checked)}
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
                  onChange={(event) => setAdvancedFilterBoolean("unwatchedAlertOnly", event.target.checked)}
                />
                Alerts
              </label>
              {activeStatus === "COMPLETED" ? (
                <label className="filter-chip">
                  <input
                    type="checkbox"
                    checked={missingScoreOnly}
                    onChange={(event) => setAdvancedFilterBoolean("missingScoreOnly", event.target.checked)}
                  />
                  Missing Score
                </label>
              ) : null}
            </div>
            )}
            <div className="list-state">
              <label className="sort-box">
                <span>Order</span>
                <select value={sortOrder} onChange={(event) => setPrimarySortOrder(event.target.value)}>
                  {SORT_OPTIONS.map((option) => (
                    <option value={option.value} key={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <div className="toolbar-secondary">
            {!isAddTab ? (
              <div className="secondary-filter-actions">
                <label className="filter-chip select-visible-chip">
                  <input
                    type="checkbox"
                    checked={filteredEntries.length > 0 && filteredEntries.every((entry) => selectedIds.has(entry.mediaId))}
                    onChange={(event) => selectVisible(event.target.checked)}
                  />
                  Select visible
                </label>
              </div>
            ) : null}
            <span className="count">
              {isAddTab ? `${sortedAddSearchResults.length} results` : `${filteredEntries.length} entries`}
            </span>
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
        updateInfo={updateInfo}
        onCheckUpdate={checkUpdateInfo}
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

      <AdvancedFilterDialog
        open={advancedFilterOpen && !isAddTab}
        activeStatus={activeStatus}
        filter={advancedFilter}
        advancedFilters={settings.advancedFilters}
        genreOptions={genreOptions}
        ratingOptions={ratingOptions}
        alertsFilterEnabled={alertsFilterEnabled}
        onClose={() => setAdvancedFilterOpen(false)}
        onApply={setAdvancedFilter}
        onSaveAdvancedFilters={saveAdvancedFilters}
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
      <AdvancedFilterMenu menu={advancedFilterMenu} onClose={() => setAdvancedFilterMenu(null)} onClear={clearAdvancedFilter} />
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
                    showSynonymSubtitle={settings.appearance.showSynonymSubtitle}
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
            {loading && entries.length === 0 ? <div className="empty-state">{loadProgress || "Loading..."}</div> : null}
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
                showSynonymSubtitle={settings.appearance.showSynonymSubtitle}
                showSynonymInfoIcon={settings.appearance.showSynonymInfoIcon}
                showNotes={showNotes}
                simplifiedView={simplifiedView}
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
      {!isAddTab && loadDiagnostics ? <div className="load-diagnostics">{loadDiagnostics}</div> : null}
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
