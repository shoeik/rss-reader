const articleDetail = document.querySelector("#article-detail");
const statusElement = document.querySelector("#status");

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

function renderArticleDetail(article) {
  articleDetail.textContent = "";

  const title = createTextElement(
    "h2",
    "article-detail-title",
    article.title || "無題"
  );
  articleDetail.appendChild(title);

  const meta = document.createElement("div");
  meta.className = "meta";

  if (article.source) {
    meta.appendChild(createTextElement("span", "source", article.source));
  }

  const formattedDate = formatDate(article.pubDate);
  if (formattedDate) {
    meta.appendChild(createTextElement("time", "date", formattedDate));
  }

  articleDetail.appendChild(meta);

  if (article.summary) {
    const summarySection = document.createElement("section");
    summarySection.className = "article-detail-section";
    summarySection.appendChild(createTextElement("h3", "detail-section-title", "要約"));
    summarySection.appendChild(createTextElement("p", "article-summary", article.summary));
    articleDetail.appendChild(summarySection);
  }

  const snippetSection = document.createElement("section");
  snippetSection.className = "article-detail-section";
  snippetSection.appendChild(createTextElement("h3", "detail-section-title", "本文抜粋"));
  snippetSection.appendChild(
    createTextElement(
      "p",
      "content-snippet article-detail-snippet",
      article.contentSnippet || "本文抜粋はありません"
    )
  );
  articleDetail.appendChild(snippetSection);

  if (article.link) {
    const readLink = document.createElement("a");
    readLink.className = "read-link article-detail-read-link";
    readLink.href = article.link;
    readLink.target = "_blank";
    readLink.rel = "noopener noreferrer";
    readLink.textContent = "元記事を読む";
    articleDetail.appendChild(readLink);
  }

  document.title = `${article.title || "記事詳細"} - RSS Reader`;
}

async function loadArticleDetail() {
  const id = new URLSearchParams(window.location.search).get("id");

  if (!id) {
    setStatus("記事IDが指定されていません。", "error");
    return;
  }

  try {
    const response = await fetch(`/articles/${encodeURIComponent(id)}`);
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || "記事取得に失敗しました");
    }

    setStatus("");
    renderArticleDetail(result);
  } catch (error) {
    setStatus(error.message, "error");
  }
}

loadArticleDetail();
