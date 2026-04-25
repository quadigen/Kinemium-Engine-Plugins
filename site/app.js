const state = {
  registry: null,
  plugins: [],
  filtered: [],
  activeSlug: null,
  detailCache: new Map(),
};

const elements = {
  pluginCount: document.querySelector("#plugin-count"),
  visibleCount: document.querySelector("#visible-count"),
  generatedAt: document.querySelector("#generated-at"),
  searchInput: document.querySelector("#search-input"),
  clearSearch: document.querySelector("#clear-search"),
  resultsStatus: document.querySelector("#results-status"),
  pluginGrid: document.querySelector("#plugin-grid"),
  spotlight: document.querySelector("#spotlight"),
  spotlightMedia: document.querySelector("#spotlight-media"),
  spotlightTitle: document.querySelector("#spotlight-title"),
  spotlightDescription: document.querySelector("#spotlight-description"),
  spotlightTags: document.querySelector("#spotlight-tags"),
  spotlightView: document.querySelector("#spotlight-view"),
  spotlightDownload: document.querySelector("#spotlight-download"),
  emptyState: document.querySelector("#empty-state"),
  errorState: document.querySelector("#error-state"),
  detailOverlay: document.querySelector("#detail-overlay"),
  detailPanel: document.querySelector("#detail-panel"),
  detailClose: document.querySelector("#detail-close"),
  detailLoading: document.querySelector("#detail-loading"),
  detailContent: document.querySelector("#detail-content"),
};

document.addEventListener("DOMContentLoaded", () => {
  wireEvents();
  loadRegistry();
});

function wireEvents() {
  elements.searchInput.addEventListener("input", onSearchInput);
  elements.clearSearch.addEventListener("click", clearSearch);
  elements.detailClose.addEventListener("click", closeDetails);
  elements.detailOverlay.addEventListener("click", closeDetails);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.activeSlug) {
      closeDetails();
    }
  });

  window.addEventListener("hashchange", handleHashChange);
}

async function loadRegistry() {
  try {
    const response = await fetch("plugins.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to load plugins.json: ${response.status}`);
    }

    const registry = await response.json();
    const plugins = Array.isArray(registry.plugins) ? registry.plugins : [];

    state.registry = registry;
    state.plugins = plugins.map(normalizePlugin);

    elements.pluginCount.textContent = String(state.plugins.length);
    elements.generatedAt.textContent = formatTimestamp(registry.generatedAt);

    applySearch();
    handleHashChange();
  } catch (error) {
    console.error(error);
    elements.errorState.hidden = false;
    elements.resultsStatus.textContent = "Registry load failed.";
    elements.generatedAt.textContent = "Unavailable";
  }
}

function normalizePlugin(plugin) {
  const manifest = plugin.manifest || {};
  const keywords = Array.isArray(manifest.keywords) ? manifest.keywords : [];
  const searchText = [
    manifest.name,
    manifest.id,
    manifest.description,
    manifest.author,
    manifest.version,
    keywords.join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return {
    ...plugin,
    manifest,
    keywords,
    searchText,
    displayName: manifest.name || plugin.slug,
    previewUrl: plugin.assets?.thumbnailUrl || plugin.assets?.iconUrl || null,
  };
}

function onSearchInput(event) {
  const hasQuery = event.target.value.trim().length > 0;
  elements.clearSearch.hidden = !hasQuery;
  applySearch();
}

function clearSearch() {
  elements.searchInput.value = "";
  elements.clearSearch.hidden = true;
  applySearch();
  elements.searchInput.focus();
}

function applySearch() {
  const rawQuery = elements.searchInput.value.trim();
  const query = rawQuery.toLowerCase();

  state.filtered = state.plugins.filter((plugin) => {
    if (!query) {
      return true;
    }
    return plugin.searchText.includes(query);
  });

  state.filtered.sort((left, right) => {
    const nameSort = left.displayName.localeCompare(right.displayName, undefined, {
      sensitivity: "base",
      numeric: true,
    });
    if (nameSort !== 0) {
      return nameSort;
    }
    return left.slug.localeCompare(right.slug, undefined, {
      sensitivity: "base",
      numeric: true,
    });
  });

  renderSpotlight();
  renderGrid();
  updateStatus(rawQuery);
}

function updateStatus(rawQuery) {
  const visibleCount = state.filtered.length;
  const totalCount = state.plugins.length;

  elements.visibleCount.textContent = String(visibleCount);
  elements.emptyState.hidden = visibleCount !== 0;

  if (!state.registry) {
    elements.resultsStatus.textContent = "Loading plugin registry...";
    return;
  }

  if (!rawQuery) {
    elements.resultsStatus.textContent =
      visibleCount === totalCount
        ? `Showing all ${totalCount} published plugin${totalCount === 1 ? "" : "s"}.`
        : `Showing ${visibleCount} of ${totalCount} plugins.`;
    return;
  }

  elements.resultsStatus.textContent =
    visibleCount === 0
      ? `No plugins matched "${rawQuery}".`
      : `Found ${visibleCount} plugin${visibleCount === 1 ? "" : "s"} for "${rawQuery}".`;
}

function renderSpotlight() {
  const featured = state.filtered[0];
  if (!featured) {
    elements.spotlight.hidden = true;
    return;
  }

  elements.spotlight.hidden = false;
  elements.spotlightTitle.textContent = featured.displayName;
  elements.spotlightDescription.textContent =
    featured.manifest.description || "No description was provided in the manifest.";

  elements.spotlightMedia.replaceChildren(createArtContent(featured));
  elements.spotlightTags.replaceChildren(
    ...buildTagNodes([
      featured.manifest.author ? { label: featured.manifest.author, warm: true } : null,
      ...(featured.keywords || []).slice(0, 4).map((keyword) => ({ label: keyword })),
    ])
  );

  elements.spotlightView.onclick = () => openDetails(featured.slug);
  elements.spotlightDownload.href = toSiteUrl(featured.download?.url);
  elements.spotlightDownload.download = featured.download?.name || "";
}

function renderGrid() {
  elements.pluginGrid.replaceChildren(...state.filtered.map(createCard));
}

function createCard(plugin, index) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "plugin-card";
  card.style.setProperty("--delay", `${Math.min(index, 8) * 45}ms`);
  card.addEventListener("click", () => openDetails(plugin.slug));

  const art = document.createElement("div");
  art.className = "card-art";
  art.appendChild(createArtContent(plugin));

  const header = document.createElement("div");
  header.className = "card-header";

  const title = document.createElement("h2");
  title.textContent = plugin.displayName;

  const subtitle = document.createElement("p");
  subtitle.className = "card-subtitle";
  subtitle.textContent = [plugin.manifest.version, plugin.manifest.author]
    .filter(Boolean)
    .join(" | ");

  header.append(title, subtitle);

  const description = document.createElement("p");
  description.className = "card-description";
  description.textContent =
    plugin.manifest.description || "No description was provided in the manifest.";

  const tagRow = document.createElement("div");
  tagRow.className = "tag-row";
  tagRow.append(
    ...buildTagNodes((plugin.keywords || []).slice(0, 3).map((keyword) => ({ label: keyword })))
  );

  const actions = document.createElement("div");
  actions.className = "card-actions";

  const viewLabel = document.createElement("span");
  viewLabel.textContent = `${plugin.fileCount} file${plugin.fileCount === 1 ? "" : "s"}`;

  const download = document.createElement("a");
  download.className = "card-download";
  download.href = toSiteUrl(plugin.download?.url);
  download.download = plugin.download?.name || "";
  download.textContent = "Download";
  download.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  actions.append(viewLabel, download);
  card.append(art, header, description, tagRow, actions);
  return card;
}

function createArtContent(plugin) {
  const imageUrl = plugin.previewUrl;
  if (imageUrl) {
    const img = document.createElement("img");
    img.alt = `${plugin.displayName} artwork`;
    img.loading = "lazy";
    img.src = toSiteUrl(imageUrl);
    return img;
  }

  const fallback = document.createElement("div");
  fallback.className = "fallback-art";

  const initials = document.createElement("span");
  initials.textContent = initialsFor(plugin.displayName);
  fallback.appendChild(initials);
  return fallback;
}

function buildTagNodes(entries) {
  return entries
    .filter(Boolean)
    .map((entry) => {
      const tag = document.createElement("span");
      tag.className = entry.warm ? "tag tag--warm" : "tag";
      tag.textContent = entry.label;
      return tag;
    });
}

function initialsFor(value) {
  return (
    String(value || "?")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((piece) => piece[0]?.toUpperCase() || "")
      .join("") || "?"
  );
}

function toSiteUrl(path) {
  if (!path) {
    return "#";
  }
  return new URL(path, document.baseURI).toString();
}

function formatTimestamp(value) {
  if (!value) {
    return "Unknown";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = units[0];

  for (let index = 0; index < units.length; index += 1) {
    unit = units[index];
    if (size < 1024 || index === units.length - 1) {
      break;
    }
    size /= 1024;
  }

  return `${size >= 10 || unit === "B" ? size.toFixed(0) : size.toFixed(1)} ${unit}`;
}

function getHashSlug() {
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash.startsWith("plugin=")) {
    return null;
  }

  const rawSlug = hash.slice("plugin=".length);
  return rawSlug ? decodeURIComponent(rawSlug) : null;
}

function handleHashChange() {
  const slug = getHashSlug();
  if (!slug) {
    if (state.activeSlug) {
      hideDetailPanel();
    }
    return;
  }

  const pluginExists = state.plugins.some((plugin) => plugin.slug === slug);
  if (pluginExists) {
    openDetails(slug, { updateHash: false });
  }
}

async function openDetails(slug, options = {}) {
  const { updateHash = true } = options;
  const summary = state.plugins.find((plugin) => plugin.slug === slug);
  if (!summary) {
    return;
  }

  state.activeSlug = slug;
  showDetailPanel();

  if (updateHash && getHashSlug() !== slug) {
    history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}#plugin=${encodeURIComponent(slug)}`
    );
  }

  elements.detailLoading.hidden = false;
  elements.detailContent.replaceChildren();

  try {
    const detail = await fetchDetail(summary);
    renderDetail(summary, detail);
  } catch (error) {
    console.error(error);
    elements.detailContent.replaceChildren(
      createMessageBlock(
        "Plugin details could not be loaded.",
        "The detail JSON for this plugin was not available."
      )
    );
  } finally {
    elements.detailLoading.hidden = true;
  }
}

async function fetchDetail(summary) {
  const cached = state.detailCache.get(summary.slug);
  if (cached) {
    return cached;
  }

  const response = await fetch(summary.detailsUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load ${summary.detailsUrl}: ${response.status}`);
  }

  const detail = await response.json();
  state.detailCache.set(summary.slug, detail);
  return detail;
}

function renderDetail(summary, detail) {
  const manifest = detail.manifest || summary.manifest || {};
  const dependencies =
    manifest.dependencies && typeof manifest.dependencies === "object"
      ? Object.entries(manifest.dependencies)
      : [];
  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
  const keywordTags = Array.isArray(manifest.keywords) ? manifest.keywords : [];
  const content = document.createElement("div");
  content.className = "detail-content";

  const hero = document.createElement("section");
  hero.className = "detail-hero";

  const art = document.createElement("div");
  art.className = "detail-art";
  art.appendChild(
    createArtContent({
      ...summary,
      previewUrl: detail.assets?.thumbnailUrl || detail.assets?.iconUrl || summary.previewUrl,
    })
  );

  const body = document.createElement("div");
  body.className = "detail-hero__body";

  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = manifest.id || detail.slug;

  const title = document.createElement("h2");
  title.id = "detail-title";
  title.textContent = manifest.name || detail.slug;

  const subtitle = document.createElement("p");
  subtitle.className = "detail-subtitle";
  subtitle.textContent =
    manifest.description || "No description was provided in the manifest.";

  const actions = document.createElement("div");
  actions.className = "detail-actions";
  actions.append(
    createLinkButton("Download zip", detail.download?.url, "primary-button", detail.download?.name),
    createExternalLink("Homepage", manifest.homepage),
    createExternalLink("Repository", manifest.repository)
  );

  const tags = document.createElement("div");
  tags.className = "tag-row";
  tags.append(
    ...buildTagNodes([
      manifest.author ? { label: manifest.author, warm: true } : null,
      ...keywordTags.map((keyword) => ({ label: keyword })),
    ])
  );

  body.append(eyebrow, title, subtitle, actions, tags);
  hero.append(art, body);

  const meta = document.createElement("section");
  meta.className = "meta-grid";
  meta.append(
    createMetaItem("Version", manifest.version || "Unknown"),
    createMetaItem("License", manifest.license || "Unspecified"),
    createMetaItem("Engine", manifest.engine?.minVersion || "Not set"),
    createMetaItem("Main File", manifest.main || "Not set"),
    createMetaItem("Updated", formatTimestamp(detail.updatedAt)),
    createMetaItem("Archive", formatBytes(detail.download?.size || 0))
  );

  const linksSection = document.createElement("section");
  linksSection.className = "detail-section";
  const linksHeading = document.createElement("h3");
  linksHeading.textContent = "Manifest links";
  const linksList = document.createElement("div");
  linksList.className = "detail-list";
  linksList.append(
    createLinkRow("Plugin id", manifest.id || detail.slug),
    createLinkRow("Source folder", detail.sourceDir || "Unavailable"),
    createLinkRow("Download URL", detail.download?.url || "Unavailable"),
    createLinkRow("Archive SHA-256", detail.download?.sha256 || "Unavailable")
  );
  linksSection.append(linksHeading, linksList);

  const dependencySection = document.createElement("section");
  dependencySection.className = "detail-section";
  const dependencyHeading = document.createElement("h3");
  dependencyHeading.textContent = "Dependencies";
  dependencySection.append(
    dependencyHeading,
    dependencies.length
      ? createTokenList(
          "dependency-list",
          dependencies.map(([name, version]) => `${name}: ${version}`)
        )
      : createMessageBlock("", "This plugin does not declare any dependencies.")
  );

  const permissionSection = document.createElement("section");
  permissionSection.className = "detail-section";
  const permissionHeading = document.createElement("h3");
  permissionHeading.textContent = "Permissions";
  permissionSection.append(
    permissionHeading,
    permissions.length
      ? createTokenList(
          "permission-list",
          permissions.map((permission) =>
            typeof permission === "string" ? permission : JSON.stringify(permission)
          )
        )
      : createMessageBlock("", "This plugin does not request any special permissions.")
  );

  const fileSection = document.createElement("section");
  fileSection.className = "detail-section";
  const fileHeading = document.createElement("h3");
  fileHeading.textContent = `Files (${detail.files?.length || 0})`;
  const fileList = document.createElement("div");
  fileList.className = "file-list";
  (detail.files || []).forEach((file) => {
    fileList.appendChild(createFileRow(file));
  });
  fileSection.append(fileHeading, fileList);

  const readmeSection = document.createElement("section");
  readmeSection.className = "detail-section";
  const readmeHeading = document.createElement("h3");
  readmeHeading.textContent = "README";
  const readmeBlock = document.createElement("pre");
  readmeBlock.className = "readme-block";
  readmeBlock.textContent = detail.readme || "No README.md was found for this plugin.";
  readmeSection.append(readmeHeading, readmeBlock);

  content.append(
    hero,
    meta,
    linksSection,
    dependencySection,
    permissionSection,
    fileSection,
    readmeSection
  );

  elements.detailContent.replaceChildren(content);
}

function createLinkButton(label, url, className, downloadName = "") {
  const link = document.createElement("a");
  link.className = className;
  link.href = toSiteUrl(url);
  link.textContent = label;
  if (downloadName) {
    link.download = downloadName;
  }
  return link;
}

function createExternalLink(label, value) {
  const link = document.createElement("a");
  const safeUrl = toExternalUrl(value);
  if (!safeUrl) {
    link.className = "ghost-button";
    link.href = "#";
    link.textContent = `${label} unavailable`;
    link.setAttribute("aria-disabled", "true");
    return link;
  }

  link.className = "ghost-button";
  link.href = safeUrl;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = label;
  return link;
}

function toExternalUrl(value) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.toString();
    }
  } catch (error) {
    return null;
  }

  return null;
}

function createMetaItem(label, value) {
  const item = document.createElement("article");
  item.className = "meta-item";

  const title = document.createElement("span");
  title.textContent = label;

  const body = document.createElement("strong");
  body.textContent = value;

  item.append(title, body);
  return item;
}

function createLinkRow(label, value) {
  const row = document.createElement("div");
  row.textContent = `${label}: ${value}`;
  return row;
}

function createTokenList(className, entries) {
  const list = document.createElement("div");
  list.className = className;
  list.append(...entries.map((entry) => buildTagNodes([{ label: entry }])[0]));
  return list;
}

function createFileRow(file) {
  const row = document.createElement("article");
  row.className = "file-row";

  const name = document.createElement("strong");
  name.textContent = file.path;

  const meta = document.createElement("div");
  meta.className = "file-meta";
  meta.textContent = `${file.contentType || "Unknown type"} | ${formatBytes(file.size || 0)}`;

  row.append(name, meta);
  return row;
}

function createMessageBlock(title, description) {
  const block = document.createElement("div");
  if (title) {
    const strong = document.createElement("strong");
    strong.textContent = title;
    block.appendChild(strong);
  }
  const text = document.createElement("p");
  text.textContent = description;
  block.appendChild(text);
  return block;
}

function showDetailPanel() {
  elements.detailOverlay.hidden = false;
  elements.detailPanel.classList.add("is-open");
  elements.detailPanel.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function hideDetailPanel() {
  state.activeSlug = null;
  elements.detailPanel.classList.remove("is-open");
  elements.detailPanel.setAttribute("aria-hidden", "true");
  elements.detailOverlay.hidden = true;
  document.body.style.overflow = "";
}

function closeDetails() {
  hideDetailPanel();
  if (window.location.hash) {
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }
}
