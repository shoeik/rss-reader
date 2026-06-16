const articlesContainer = document.querySelector("#articles");
const statusElement = document.querySelector("#status");
const fetchRssButton = document.querySelector("#fetch-rss-button");
const sourceFilter = document.querySelector(".source-filter");
const topicFilter = document.querySelector(".topic-filter");
const viewFilter = document.querySelector(".view-filter");
const feedForm = document.querySelector("#feed-form");
const feedNameInput = document.querySelector("#feed-name");
const feedUrlInput = document.querySelector("#feed-url");
const addFeedButton = document.querySelector("#add-feed-button");
const feedsList = document.querySelector("#feeds-list");
const fetchRssButtonDefaultText = fetchRssButton.textContent;
const addFeedButtonDefaultText = addFeedButton.textContent;
let selectedSource = "";
let selectedTopic = "";
let selectedView = "all";
let feeds = [];

function setStatus(message, type = "") {
  statusElement.className = type ? `status ${type}` : "status";
  statusElement.textContent = message;
}

function formatDate(pubDate) {
  if (!pubDate) {
    return "";
  }

  const date = new Date(pubDate);

  if (Number.isNaN(date.getTime())) {
    return pubDate;
  }

  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(date);
}

function createTextElement(tagName, className, text) {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

function renderSourceFilters() {
  sourceFilter.textContent = "";

  const allButton = document.createElement("button");
  allButton.className = "source-filter-button";
  allButton.type = "button";
  allButton.dataset.source = "";
  allButton.textContent = "すべて";
  allButton.addEventListener("click", () => {
    setSelectedSource("");
  });
  sourceFilter.appendChild(allButton);

  for (const feed of feeds) {
    const button = document.createElement("button");
    button.className = "source-filter-button";
    button.type = "button";
    button.dataset.source = feed.name;
    button.textContent = feed.name;
    button.addEventListener("click", () => {
      setSelectedSource(feed.name);
    });
    sourceFilter.appendChild(button);
  }

  updateSourceFilterState();
}

function updateSourceFilterState() {
  const sourceFilterButtons = sourceFilter.querySelectorAll(".source-filter-button");

  for (const button of sourceFilterButtons) {
    const isActive = button.dataset.source === selectedSource;
    button.classList.toggle("active", isActive);
  }
}

function updateTopicFilterState() {
  const topicFilterButtons = topicFilter.querySelectorAll(".topic-filter-button");

  for (const button of topicFilterButtons) {
    const isActive = button.dataset.topic === selectedTopic;
    button.classList.toggle("active", isActive);
  }
}

function updateViewFilterState() {
  const viewFilterButtons = viewFilter.querySelectorAll(".view-filter-button");

  for (const button of viewFilterButtons) {
    const isActive = button.dataset.view === selectedView;
    button.classList.toggle("active", isActive);
  }
}

function renderFeeds() {
  feedsList.textContent = "";

  if (feeds.length === 0) {
    const item = document.createElement("li");
    item.className = "feed-empty";
    item.textContent = "フィードはまだ登録されていません";
    feedsList.appendChild(item);
    return;
  }

  for (const feed of feeds) {
    const item = document.createElement("li");
    item.className = "feed-item";

    const feedInfo = document.createElement("div");
    feedInfo.className = "feed-info";
    feedInfo.appendChild(createTextElement("strong", "feed-name", feed.name));
    feedInfo.appendChild(createTextElement("span", "feed-url", feed.url));

    item.appendChild(feedInfo);
    feedsList.appendChild(item);
  }
}

async function updateArticleState(article, action, successMessage) {
  try {
    const response = await fetch(`/articles/${encodeURIComponent(article.id)}/${action}`, {
      method: "POST"
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || "記事更新に失敗しました");
    }

    setStatus(successMessage, "success");
    await loadArticles({ preserveStatus: true });
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function renderArticleControls(article) {
  const controls = document.createElement("div");
  controls.className = "article-controls";

  if (article.dismissed) {
    const restoreButton = document.createElement("button");
    restoreButton.className = "article-control-button";
    restoreButton.type = "button";
    restoreButton.textContent = "復元";
    restoreButton.addEventListener("click", () => {
      updateArticleState(article, "undismiss", "記事を復元しました");
    });
    controls.appendChild(restoreButton);
    return controls;
  }

  const readButton = document.createElement("button");
  readButton.className = "article-control-button";
  readButton.type = "button";
  readButton.textContent = article.isRead ? "未読に戻す" : "既読にする";
  readButton.addEventListener("click", () => {
    const action = article.isRead ? "unread" : "read";
    const message = article.isRead ? "未読に戻しました" : "既読にしました";

    updateArticleState(article, action, message);
  });
  controls.appendChild(readButton);

  const readLaterButton = document.createElement("button");
  readLaterButton.className = "article-control-button";
  readLaterButton.type = "button";
  readLaterButton.textContent = article.readLater ? "あとで読む解除" : "あとで読む";
  readLaterButton.addEventListener("click", () => {
    const action = article.readLater ? "unreadlater" : "readlater";
    const message = article.readLater
      ? "あとで読むを解除しました"
      : "あとで読むに追加しました";

    updateArticleState(article, action, message);
  });
  controls.appendChild(readLaterButton);

  const dismissButton = document.createElement("button");
  dismissButton.className = "article-control-button danger";
  dismissButton.type = "button";
  dismissButton.textContent = "捨てる";
  dismissButton.addEventListener("click", () => {
    updateArticleState(article, "dismiss", "記事を捨てました");
  });
  controls.appendChild(dismissButton);

  return controls;
}

function renderArticle(article) {
  const card = document.createElement("article");
  card.className = "article-card article-card-clickable";

  if (article.isRead && !article.dismissed) {
    card.classList.add("article-card-read");
  }

  card.tabIndex = 0;
  card.setAttribute("role", "link");
  card.setAttribute("aria-label", `${article.title || "無題"}の詳細を開く`);

  const openArticleDetail = () => {
    window.location.href = `/article.html?id=${encodeURIComponent(article.id)}`;
  };

  card.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("a, button")) {
      return;
    }

    openArticleDetail();
  });

  card.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    if (event.target instanceof Element && event.target.closest("a, button")) {
      return;
    }

    event.preventDefault();
    openArticleDetail();
  });

  card.appendChild(createTextElement("h2", "article-title", article.title || "無題"));

  const meta = document.createElement("div");
  meta.className = "meta";

  if (article.source) {
    meta.appendChild(createTextElement("span", "source", article.source));
  }

  const formattedDate = formatDate(article.pubDate);
  if (formattedDate) {
    meta.appendChild(createTextElement("time", "date", formattedDate));
  }

  card.appendChild(meta);

  card.appendChild(
    createTextElement(
      "p",
      "content-snippet",
      article.contentSnippet || "本文抜粋はありません"
    )
  );

  if (article.link) {
    const link = document.createElement("a");
    link.className = "read-link";
    link.href = article.link;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "読む";
    card.appendChild(link);
  }

  card.appendChild(renderArticleControls(article));

  return card;
}

async function loadArticles(options = {}) {
  const preserveStatus = options.preserveStatus === true;

  try {
    const params = new URLSearchParams({
      limit: "100",
      view: selectedView
    });

    if (selectedTopic) {
      params.set("topic", selectedTopic);
    } else if (selectedSource) {
      params.set("source", selectedSource);
    }

    const response = await fetch(`/articles?${params.toString()}`);

    if (!response.ok) {
      throw new Error(`記事取得に失敗しました (${response.status})`);
    }

    const articles = await response.json();
    articlesContainer.textContent = "";

    if (articles.length === 0) {
      if (!preserveStatus) {
        setStatus("記事がありません。");
      }
      return;
    }

    if (!preserveStatus) {
      setStatus("");
    }

    for (const article of articles) {
      articlesContainer.appendChild(renderArticle(article));
    }
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function loadFeeds() {
  try {
    const response = await fetch("/feeds");

    if (!response.ok) {
      throw new Error(`フィード取得に失敗しました (${response.status})`);
    }

    feeds = await response.json();

    if (selectedSource && !feeds.some((feed) => feed.name === selectedSource)) {
      selectedSource = "";
    }

    renderFeeds();
    renderSourceFilters();
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function addFeed(event) {
  event.preventDefault();

  addFeedButton.disabled = true;
  addFeedButton.textContent = "追加中...";
  setStatus("フィードを追加しています...");

  try {
    const response = await fetch("/feeds", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: feedNameInput.value,
        url: feedUrlInput.value
      })
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || "フィード追加に失敗しました");
    }

    feedForm.reset();
    setStatus(`フィードを追加しました: ${result.name}`, "success");
    await loadFeeds();
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    addFeedButton.disabled = false;
    addFeedButton.textContent = addFeedButtonDefaultText;
  }
}

async function fetchRssArticles() {
  fetchRssButton.disabled = true;
  fetchRssButton.textContent = "取得中...";
  setStatus("RSSを取得しています...");

  try {
    const response = await fetch("/fetch-rss", {
      method: "POST"
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || "RSS取得に失敗しました");
    }

    const failedFeeds = Array.isArray(result.failedFeeds) ? result.failedFeeds : [];
    const failedMessage =
      failedFeeds.length > 0
        ? ` / 失敗 ${failedFeeds.map((feed) => feed.name).join(", ")}`
        : "";

    setStatus(
      `RSS取得完了: 取得 ${result.fetchedCount} 件 / 新規 ${result.insertedCount} 件${failedMessage}`,
      failedFeeds.length > 0 ? "error" : "success"
    );
    await loadArticles({ preserveStatus: true });
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    fetchRssButton.disabled = false;
    fetchRssButton.textContent = fetchRssButtonDefaultText;
  }
}

function setSelectedSource(source) {
  selectedSource = source;
  selectedTopic = "";

  updateSourceFilterState();
  updateTopicFilterState();
  loadArticles();
}

function setSelectedTopic(topic) {
  selectedTopic = topic;
  selectedSource = "";

  updateTopicFilterState();
  updateSourceFilterState();
  loadArticles();
}

function setSelectedView(view) {
  selectedView = [
    "all",
    "readlater",
    "not-readlater",
    "dismissed",
    "unread",
    "read"
  ].includes(view)
    ? view
    : "all";

  updateViewFilterState();
  loadArticles();
}

feedForm.addEventListener("submit", addFeed);
fetchRssButton.addEventListener("click", fetchRssArticles);
topicFilter.addEventListener("click", (event) => {
  const button = event.target.closest(".topic-filter-button");

  if (!button) {
    return;
  }

  setSelectedTopic(button.dataset.topic || "");
});
viewFilter.addEventListener("click", (event) => {
  const button = event.target.closest(".view-filter-button");

  if (!button) {
    return;
  }

  setSelectedView(button.dataset.view || "all");
});

async function init() {
  await loadFeeds();
  updateViewFilterState();
  await loadArticles();
}

init();
