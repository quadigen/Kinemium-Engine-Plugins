const state = {
  registry: null,
  plugins: [],
  filtered: [],
  activeSlug: null,
  detailCache: new Map(),
  theme: "dark",
  currentPage: 1,
  itemsPerPage: 20,
};

const THEME_STORAGE_KEY = "kinemium-theme";

const elements = {
  pluginCount: document.querySelector("#plugin-count"),
  visibleCount: document.querySelector("#visible-count"),
  generatedAt: document.querySelector("#generated-at"),
  searchInput: document.querySelector("#search-input"),
  searchSubmit: document.querySelector("#search-submit"),
  categoryFilter: document.querySelector("#category-filter"),
  supportTesting: document.querySelector("#support-testing"),
  supportCommunity: document.querySelector("#support-community"),
  supportFeatured: document.querySelector("#support-featured"),
  engineFilter: document.querySelector("#engine-filter"),
  licenseFilter: document.querySelector("#license-filter"),
  sortFilter: document.querySelector("#sort-filter"),
  reverseSort: document.querySelector("#reverse-sort"),
  limitFilter: document.querySelector("#limit-filter"),
  resultsStatus: document.querySelector("#results-status"),
  pluginGrid: document.querySelector("#plugin-grid"),
  paginationControls: document.querySelector("#pagination-controls"),
  prevPage: document.querySelector("#prev-page"),
  nextPage: document.querySelector("#next-page"),
  pageInfo: document.querySelector("#page-info"),
  emptyState: document.querySelector("#empty-state"),
  errorState: document.querySelector("#error-state"),
  detailOverlay: document.querySelector("#detail-overlay"),
  detailPanel: document.querySelector("#detail-panel"),
  detailClose: document.querySelector("#detail-close"),
  detailLoading: document.querySelector("#detail-loading"),
  detailContent: document.querySelector("#detail-content"),
  themeToggle: document.querySelector("#theme-toggle"),
  themeToggleLabel: document.querySelector("#theme-toggle-label"),
};

document.addEventListener("DOMContentLoaded", () => {
  initializeTheme();
  wireEvents();
  loadRegistry();
});

function wireEvents() {
  elements.searchInput.addEventListener("input", applySearch);
  elements.searchSubmit.addEventListener("click", applySearch);
  elements.categoryFilter.addEventListener("change", applySearch);
  elements.supportTesting.addEventListener("change", applySearch);
  elements.supportCommunity.addEventListener("change", applySearch);
  elements.supportFeatured.addEventListener("change", applySearch);
  elements.engineFilter.addEventListener("change", applySearch);
  elements.licenseFilter.addEventListener("change", applySearch);
  elements.sortFilter.addEventListener("change", applySearch);
  elements.reverseSort.addEventListener("change", applySearch);
  elements.limitFilter.addEventListener("change", handleLimitChange);
  elements.prevPage.addEventListener("click", goToPreviousPage);
  elements.nextPage.addEventListener("click", goToNextPage);
  elements.detailClose.addEventListener("click", closeDetails);
  elements.detailOverlay.addEventListener("click", closeDetails);
  elements.themeToggle.addEventListener("click", toggleTheme);

  elements.searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      applySearch();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.activeSlug) {
      closeDetails();
    }
  });

  window.addEventListener("hashchange", handleHashChange);
}

function initializeTheme() {
  let savedTheme = "dark";

  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (value === "light" || value === "dark") {
      savedTheme = value;
    }
  } catch (error) {
    savedTheme = "dark";
  }

  applyTheme(savedTheme);
}

function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  elements.themeToggleLabel.textContent = theme === "dark" ? "Dark" : "Light";
  elements.themeToggle.setAttribute(
    "aria-label",
    `Switch to ${theme === "dark" ? "light" : "dark"} theme`
  );
}

function toggleTheme() {
  const nextTheme = state.theme === "dark" ? "light" : "dark";
  applyTheme(nextTheme);

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  } catch (error) {
    return;
  }
}

async function loadRegistry() {
  try {
    const response = await fetch("plugins.json", { cache: "no-store" });
    if (!response.ok) {
      if (response.status === 404) {
        elements.resultsStatus.textContent = "No plugins available yet. Run the artifact generation workflow to create plugins.";
        elements.pluginCount.textContent = "0";
        elements.generatedAt.textContent = "Unavailable";
        elements.pluginGrid.replaceChildren();
        elements.emptyState.hidden = false;
        elements.emptyState.querySelector("h2").textContent = "No plugins available";
        elements.emptyState.querySelector("p").textContent = "The plugin registry has not been generated yet. Run the artifact generation workflow to create plugins.";
        return;
      }
      throw new Error(`Failed to load plugins.json: ${response.status}`);
    }

    const registry = await response.json();
    const plugins = Array.isArray(registry.plugins) ? registry.plugins : [];

    state.registry = registry;
    state.plugins = plugins.map(normalizePlugin);

    populateFilters();

    elements.pluginCount.textContent = String(state.plugins.length);
    elements.generatedAt.textContent = formatTimestamp(registry.generatedAt, "dateTime");

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
  const category = inferCategory(manifest, keywords);
  const supportLevel = inferSupportLevel(manifest);
  const isFeatured = Boolean(manifest.featured || manifest.support?.featured);
  const engineVersion = manifest.engine?.minVersion || "Unspecified";
  const license = manifest.license || "Unspecified";
  const updatedTimestamp = Date.parse(plugin.updatedAt || "") || 0;

  const searchText = [
    manifest.name,
    manifest.id,
    manifest.description,
    manifest.author,
    manifest.version,
    category,
    supportLevel,
    license,
    engineVersion,
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
    iconUrl: plugin.assets?.iconUrl || null,
    thumbnailUrl: plugin.assets?.thumbnailUrl || null,
    artworkUrl: plugin.assets?.thumbnailUrl || plugin.assets?.iconUrl || null,
    category,
    supportLevel,
    isTesting: supportLevel === "Testing",
    isCommunity: supportLevel === "Community",
    isFeatured,
    engineVersion,
    license,
    updatedTimestamp,
  };
}

function inferCategory(manifest, keywords) {
  if (typeof manifest.category === "string" && manifest.category.trim()) {
    return normalizeLabel(manifest.category);
  }

  const normalizedKeywords = keywords.map((keyword) => String(keyword).toLowerCase());

  if (normalizedKeywords.some((keyword) => keyword.includes("shader"))) {
    return "Shaders";
  }
  if (normalizedKeywords.some((keyword) => keyword.includes("theme"))) {
    return "Themes";
  }
  if (normalizedKeywords.some((keyword) => keyword.includes("icon"))) {
    return "Icons";
  }
  if (normalizedKeywords.some((keyword) => keyword.includes("debug"))) {
    return "Debug";
  }
  if (manifest.main && String(manifest.main).toLowerCase().endsWith(".luau")) {
    return "Scripts";
  }

  return "Tools";
}

function inferSupportLevel(manifest) {
  const value = String(
    manifest.supportLevel || manifest.support?.level || manifest.status || ""
  ).trim().toLowerCase();

  if (value === "testing") {
    return "Testing";
  }

  return "Community";
}

function normalizeLabel(value) {
  return String(value)
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function populateFilters() {
  populateSelect(
    elements.categoryFilter,
    getUniqueValues(state.plugins.map((plugin) => plugin.category))
  );
  populateSelect(
    elements.engineFilter,
    getUniqueValues(state.plugins.map((plugin) => plugin.engineVersion))
  );
  populateSelect(
    elements.licenseFilter,
    getUniqueValues(state.plugins.map((plugin) => plugin.license))
  );
}

function populateSelect(select, values) {
  select.innerHTML = "";

  const anyOption = document.createElement("option");
  anyOption.value = "any";
  anyOption.textContent = "Any";
  select.appendChild(anyOption);

  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
}

function getUniqueValues(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) =>
    left.localeCompare(right, undefined, { sensitivity: "base", numeric: true })
  );
}

function applySearch() {
  const rawQuery = elements.searchInput.value.trim();
  const query = rawQuery.toLowerCase();
  const category = elements.categoryFilter.value;
  const engineVersion = elements.engineFilter.value;
  const license = elements.licenseFilter.value;
  const hasSupportFilter =
    elements.supportTesting.checked ||
    elements.supportCommunity.checked ||
    elements.supportFeatured.checked;

  state.filtered = state.plugins.filter((plugin) => {
    if (query && !plugin.searchText.includes(query)) {
      return false;
    }
    if (category !== "any" && plugin.category !== category) {
      return false;
    }
    if (engineVersion !== "any" && plugin.engineVersion !== engineVersion) {
      return false;
    }
    if (license !== "any" && plugin.license !== license) {
      return false;
    }
    if (hasSupportFilter && !matchesSupportFilter(plugin)) {
      return false;
    }
    return true;
  });

  state.currentPage = 1;
  sortPlugins(state.filtered);
  renderGrid();
  updateStatus(rawQuery);
}

function matchesSupportFilter(plugin) {
  return (
    (elements.supportTesting.checked && plugin.isTesting) ||
    (elements.supportCommunity.checked && plugin.isCommunity) ||
    (elements.supportFeatured.checked && plugin.isFeatured)
  );
}

function sortPlugins(plugins) {
  const sortBy = elements.sortFilter.value;

  plugins.sort((left, right) => {
    switch (sortBy) {
      case "name":
        return compareText(left.displayName, right.displayName);
      case "author":
        return compareText(left.manifest.author || "", right.manifest.author || "");
      case "version":
        return compareVersions(left.manifest.version || "", right.manifest.version || "");
      case "size":
        return (right.download?.size || 0) - (left.download?.size || 0);
      case "updated":
      default:
        return right.updatedTimestamp - left.updatedTimestamp;
    }
  });

  if (elements.reverseSort.checked) {
    plugins.reverse();
  }
}

function compareText(left, right) {
  return String(left).localeCompare(String(right), undefined, {
    sensitivity: "base",
    numeric: true,
  });
}

function compareVersions(left, right) {
  const leftParts = String(left).split(/[^0-9]+/).filter(Boolean).map(Number);
  const rightParts = String(right).split(/[^0-9]+/).filter(Boolean).map(Number);
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = leftParts[index] || 0;
    const rightValue = rightParts[index] || 0;

    if (leftValue !== rightValue) {
      return rightValue - leftValue;
    }
  }

  return 0;
}

function updateStatus(rawQuery) {
  const totalCount = state.plugins.length;
  const filteredCount = state.filtered.length;
  const totalPages = Math.ceil(filteredCount / state.itemsPerPage);
  const startIndex = (state.currentPage - 1) * state.itemsPerPage;
  const endIndex = Math.min(startIndex + state.itemsPerPage, filteredCount);
  const visibleCount = endIndex - startIndex;

  elements.pluginCount.textContent = String(totalCount);
  elements.visibleCount.textContent = String(visibleCount);
  elements.emptyState.hidden = filteredCount !== 0;

  if (!state.registry) {
    elements.resultsStatus.textContent = "Loading plugin registry...";
    return;
  }

  if (!rawQuery) {
    elements.resultsStatus.textContent =
      filteredCount === totalCount
        ? `Showing all ${totalCount} published assets.`
        : `Showing ${visibleCount} of ${filteredCount} assets (page ${state.currentPage} of ${totalPages}).`;
    return;
  }

  elements.resultsStatus.textContent =
    filteredCount === 0
      ? `No assets matched "${rawQuery}".`
      : `Found ${filteredCount} assets for "${rawQuery}" (showing ${visibleCount} on page ${state.currentPage} of ${totalPages}).`;
}

function renderGrid() {
  const startIndex = (state.currentPage - 1) * state.itemsPerPage;
  const endIndex = startIndex + state.itemsPerPage;
  const pagePlugins = state.filtered.slice(startIndex, endIndex);

  elements.pluginGrid.replaceChildren(...pagePlugins.map(createCard));
  updatePaginationControls();
}

function handleLimitChange() {
  state.itemsPerPage = parseInt(elements.limitFilter.value, 10);
  state.currentPage = 1;
  renderGrid();
  updateStatus(elements.searchInput.value.trim());
}

function goToPreviousPage() {
  if (state.currentPage > 1) {
    state.currentPage -= 1;
    renderGrid();
    updateStatus(elements.searchInput.value.trim());
  }
}

function goToNextPage() {
  const totalPages = Math.ceil(state.filtered.length / state.itemsPerPage);
  if (state.currentPage < totalPages) {
    state.currentPage += 1;
    renderGrid();
    updateStatus(elements.searchInput.value.trim());
  }
}

function updatePaginationControls() {
  const totalPages = Math.ceil(state.filtered.length / state.itemsPerPage);
  const hasPlugins = state.filtered.length > 0;

  elements.paginationControls.hidden = !hasPlugins || totalPages <= 1;
  elements.prevPage.disabled = state.currentPage <= 1;
  elements.nextPage.disabled = state.currentPage >= totalPages;
  elements.pageInfo.textContent = `Page ${state.currentPage} of ${totalPages}`;
}

function createCard(plugin) {
  const card = document.createElement("article");
  card.className = "plugin-card";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `Open details for ${plugin.displayName}`);
  card.addEventListener("click", () => openDetails(plugin.slug));
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDetails(plugin.slug);
    }
  });

  const thumb = document.createElement("div");
  thumb.className = "plugin-card__thumb";

  if (plugin.thumbnailUrl) {
    const img = document.createElement("img");
    img.src = plugin.thumbnailUrl;
    img.alt = `${plugin.displayName} thumbnail`;
    img.loading = "lazy";
    thumb.appendChild(img);
  }

  const content = document.createElement("div");
  content.className = "plugin-card__content";

  const header = document.createElement("div");
  header.className = "plugin-card__header";

  const icon = document.createElement("div");
  icon.className = "plugin-card__icon";
  if (plugin.iconUrl) {
    const iconImg = document.createElement("img");
    iconImg.src = plugin.iconUrl;
    iconImg.alt = `${plugin.displayName} icon`;
    icon.appendChild(iconImg);
  } else {
    const fallback = document.createElement("div");
    fallback.className = "icon-fallback";
    fallback.textContent = initialsFor(plugin.displayName);
    icon.appendChild(fallback);
  }

  const title = document.createElement("h2");
  title.className = "plugin-card__title";
  title.textContent = plugin.displayName;

  const badges = document.createElement("div");
  badges.className = "plugin-card__badges";
  badges.append(
    createCardBadge(plugin.category),
    createCardBadge(plugin.license),
    createCardBadge(plugin.supportLevel)
  );

  header.append(icon, title, badges);

  const description = document.createElement("p");
  description.className = "plugin-card__description";
  description.textContent =
    plugin.manifest.description || "No description was provided in the manifest.";

  const footer = document.createElement("div");
  footer.className = "plugin-card__footer";

  const author = document.createElement("p");
  author.className = "plugin-card__author";
  author.textContent = `by ${plugin.manifest.author || "Unknown author"}`;

  const stats = document.createElement("div");
  stats.className = "plugin-card__stats";

  const downloads = document.createElement("div");
  downloads.className = "plugin-card__stat";
  downloads.innerHTML = `<span>↓</span> ${formatNumber(plugin.download?.count || 0)}`;

  const likes = document.createElement("div");
  likes.className = "plugin-card__stat";
  likes.innerHTML = `<span>♥</span> ${formatNumber(plugin.download?.count || 0)}`;

  const updated = document.createElement("div");
  updated.className = "plugin-card__stat";
  updated.textContent = formatTimestamp(plugin.updatedAt, "date");

  stats.append(downloads, likes, updated);
  footer.append(author, stats);

  content.append(header, description, footer);
  card.append(thumb, content);
  return card;
}

function createCardBadge(label) {
  const badge = document.createElement("span");
  badge.className = "plugin-card__badge";
  badge.textContent = label;
  return badge;
}

function setCardBackground(target, imageUrl) {
  if (!imageUrl) {
    target.style.background = "linear-gradient(135deg, #f97316 0%, #fb923c 100%)";
    return;
  }

  const safeUrl = toSiteUrl(imageUrl).replace(/"/g, "%22");
  target.style.backgroundImage = `url("${safeUrl}")`;
}

function setArtworkBackground(target, imageUrl) {
  if (!imageUrl) {
    return;
  }

  const safeUrl = toSiteUrl(imageUrl).replace(/"/g, "%22");
  target.style.backgroundImage =
    `linear-gradient(180deg, rgba(10, 12, 14, 0.08) 0%, rgba(10, 12, 14, 0.72) 100%), url("${safeUrl}")`;
}

function formatNumber(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0";
  }

  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}K`;
  }
  return String(value);
}

function createBadge(label, variant) {
  const badge = document.createElement("span");
  badge.className = `badge badge--${variant}`;
  badge.textContent = label;
  return badge;
}

function createIconBadge(plugin, className) {
  const badge = document.createElement("div");
  badge.className = className;

  if (plugin.iconUrl) {
    const image = document.createElement("img");
    image.alt = `${plugin.displayName} icon`;
    image.loading = "lazy";
    image.src = toSiteUrl(plugin.iconUrl);
    badge.appendChild(image);
    return badge;
  }

  const fallback = document.createElement("div");
  fallback.className = "icon-fallback";
  fallback.textContent = initialsFor(plugin.displayName);
  badge.appendChild(fallback);
  return badge;
}

function setArtworkBackground(target, imageUrl) {
  if (!imageUrl) {
    return;
  }

  const safeUrl = toSiteUrl(imageUrl).replace(/"/g, "%22");
  target.style.backgroundImage =
    `linear-gradient(180deg, rgba(10, 12, 14, 0.08) 0%, rgba(10, 12, 14, 0.72) 100%), url("${safeUrl}")`;
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

function formatTimestamp(value, style = "dateTime") {
  if (!value) {
    return "Unknown";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  if (style === "date") {
    return `${year}-${month}-${day}`;
  }

  return `${year}-${month}-${day} ${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes()
  ).padStart(2, "0")}`;
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

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

  const preview = createDetailPreview(summary, detail);

  const copy = document.createElement("div");
  copy.className = "detail-copy";

  const title = document.createElement("h2");
  title.id = "detail-title";
  title.textContent = manifest.name || detail.slug;

  const badges = document.createElement("div");
  badges.className = "detail-badges";
  badges.append(
    createBadge(summary.category, "primary"),
    createBadge(summary.engineVersion, "info"),
    createBadge(summary.supportLevel, "success")
  );

  if (summary.isFeatured) {
    badges.append(createBadge("Featured", "neutral"));
  }

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

  copy.append(title, badges, subtitle, actions);
  hero.append(preview, copy);

  const meta = document.createElement("section");
  meta.className = "meta-grid";
  meta.append(
    createMetaItem("Plugin id", manifest.id || detail.slug),
    createMetaItem("Version", manifest.version || "Unknown"),
    createMetaItem("License", manifest.license || "Unspecified"),
    createMetaItem("Engine", manifest.engine?.minVersion || "Not set"),
    createMetaItem("Updated", formatTimestamp(detail.updatedAt, "date")),
    createMetaItem("Archive", formatBytes(detail.download?.size || 0))
  );

  const linksSection = document.createElement("section");
  linksSection.className = "detail-section";
  const linksHeading = document.createElement("h3");
  linksHeading.textContent = "Links";
  const linksList = document.createElement("div");
  linksList.className = "detail-list";
  linksList.append(
    createLinkRow("Source folder", detail.sourceDir || "Unavailable"),
    createLinkRow("Download URL", detail.download?.url || "Unavailable"),
    createLinkRow("Archive SHA-256", detail.download?.sha256 || "Unavailable")
  );
  linksSection.append(linksHeading, linksList);

  const tagsSection = document.createElement("section");
  tagsSection.className = "detail-section";
  const tagsHeading = document.createElement("h3");
  tagsHeading.textContent = "Tags";
  const tags = document.createElement("div");
  tags.className = "tag-row";
  tags.append(
    ...[
      manifest.author ? manifest.author : null,
      ...keywordTags,
    ]
      .filter(Boolean)
      .map((entry) => createTag(entry))
  );
  tagsSection.append(
    tagsHeading,
    tags.childElementCount ? tags : createMessageBlock("", "This plugin has no tags yet.")
  );

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
    tagsSection,
    dependencySection,
    permissionSection,
    fileSection,
    readmeSection
  );

  elements.detailContent.replaceChildren(content);
}

function createDetailPreview(summary, detail) {
  const preview = document.createElement("div");
  preview.className = "detail-preview";

  const thumb = document.createElement("div");
  thumb.className = "detail-preview__thumb";
  setArtworkBackground(thumb, detail.assets?.thumbnailUrl || detail.assets?.iconUrl || summary.artworkUrl);

  const icon = createIconBadge(
    {
      displayName: summary.displayName,
      iconUrl: detail.assets?.iconUrl || summary.iconUrl,
    },
    "detail-preview__icon"
  );

  preview.append(thumb, icon);
  return preview;
}

function createTag(label) {
  const tag = document.createElement("span");
  tag.className = "tag";
  tag.textContent = label;
  return tag;
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
  row.className = "detail-list__row";

  const title = document.createElement("span");
  title.textContent = label;

  const body = document.createElement("strong");
  body.textContent = value;

  row.append(title, body);
  return row;
}

function createTokenList(className, entries) {
  const list = document.createElement("div");
  list.className = className;
  list.append(...entries.map((entry) => createTag(entry)));
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
  block.className = "message-block";
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
