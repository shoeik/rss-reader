const express = require("express");
const OpenAI = require("openai");
const path = require("path");
const { Pool } = require("pg");
const Parser = require("rss-parser");

const app = express();
const parser = new Parser();
const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const pool = new Pool({
  connectionString: DATABASE_URL
});
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";
const PUBLIC_DIR = path.join(__dirname, "public");
const FORBES_JAPAN_FEED_PATH = "/feeds/forbes-japan.xml";
const FORBES_JAPAN_SITEMAP_URL =
  "https://static.forbesjapan.com/sitemap/sitemap1.xml";
const TOPIC_KEYWORDS = {
  AI: ["AI", "生成AI", "ChatGPT", "OpenAI", "LLM", "Claude", "Gemini"],
  Web制作: ["Web制作", "CSS", "UI", "UX", "デザイン", "フロントエンド"],
  JavaScript: ["JavaScript", "TypeScript", "React", "Vue", "Node.js", "npm"]
};
const SUMMARY_PROMPT = [
  "あなたはRSS記事を日本語で短く要約するアシスタントです。",
  "出力は必ず次の形式にしてください。",
  "【要点】",
  "何が起きたかを1文以内",
  "",
  "【重要性】",
  "なぜ重要かを1文以内",
  "",
  "【対象】",
  "誰に関係あるかを1文以内",
  "",
  "合計100文字程度に収めてください。"
].join("\n");

async function initializeDatabase() {
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL が設定されていません");
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS feeds (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      title TEXT,
      link TEXT UNIQUE,
      pub_date TEXT,
      content_snippet TEXT,
      source TEXT,
      summary TEXT,
      read_later BOOLEAN NOT NULL DEFAULT FALSE,
      dismissed BOOLEAN NOT NULL DEFAULT FALSE,
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE articles
    ADD COLUMN IF NOT EXISTS read_later BOOLEAN NOT NULL DEFAULT FALSE
  `);

  await pool.query(`
    ALTER TABLE articles
    ADD COLUMN IF NOT EXISTS dismissed BOOLEAN NOT NULL DEFAULT FALSE
  `);

  await pool.query(`
    ALTER TABLE articles
    ADD COLUMN IF NOT EXISTS is_read BOOLEAN NOT NULL DEFAULT FALSE
  `);
}

function normalizeFeedInput(body) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const url = typeof body.url === "string" ? body.url.trim() : "";

  if (!name) {
    throw new Error("フィード名を入力してください");
  }

  if (!url) {
    throw new Error("フィードURLを入力してください");
  }

  try {
    const parsedUrl = new URL(url);

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      throw new Error();
    }
  } catch {
    throw new Error("フィードURLが不正です");
  }

  return { name, url };
}

async function dbAll(sql, params = []) {
  const result = await pool.query(sql, params);

  return result.rows;
}

async function dbGet(sql, params = []) {
  const result = await pool.query(sql, params);

  return result.rows[0];
}

async function dbRun(sql, params = []) {
  return pool.query(sql, params);
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function extractMetaContent(html, property) {
  const propertyPattern = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const propertyFirst = new RegExp(
    `<meta[^>]+property=["']${propertyPattern}["'][^>]+content=["']([^"']*)["'][^>]*>`,
    "i"
  );
  const contentFirst = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${propertyPattern}["'][^>]*>`,
    "i"
  );
  const match = html.match(propertyFirst) || html.match(contentFirst);

  return match ? decodeHtmlEntities(match[1].trim()) : "";
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 RSS Reader"
    }
  });

  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }

  return response.text();
}

function parseForbesSitemapItems(xml, limit) {
  const items = [];
  const itemPattern =
    /<url>\s*<loc>(https:\/\/forbesjapan\.com\/articles\/detail\/\d+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g;
  let match;

  while ((match = itemPattern.exec(xml)) && items.length < limit) {
    items.push({
      link: match[1],
      pubDate: match[2]
    });
  }

  return items;
}

function includesTopicKeyword(text, keyword) {
  if (!text) {
    return false;
  }

  if (/^[a-z0-9.+#-]+$/i.test(keyword)) {
    const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const keywordPattern = new RegExp(
      `(^|[^a-z0-9])${escapedKeyword}([^a-z0-9]|$)`,
      "i"
    );

    return keywordPattern.test(text);
  }

  return text.includes(keyword);
}

function matchesTopic(article, keywords) {
  const text = [article.title, article.contentSnippet].filter(Boolean).join(" ");

  return keywords.some((keyword) => includesTopicKeyword(text, keyword));
}

async function fetchForbesJapanArticle(item) {
  const html = await fetchText(item.link);
  const articleIdMatch = item.link.match(/\/articles\/detail\/(\d+)/);
  const fallbackTitle = articleIdMatch
    ? `Forbes JAPAN article ${articleIdMatch[1]}`
    : item.link;
  const title =
    extractMetaContent(html, "og:title") ||
    extractMetaContent(html, "twitter:title") ||
    fallbackTitle;
  const description =
    extractMetaContent(html, "og:description") ||
    extractMetaContent(html, "description");

  return {
    title,
    link: item.link,
    pubDate: item.pubDate,
    contentSnippet: description
  };
}

async function buildForbesJapanFeed() {
  const sitemapXml = await fetchText(FORBES_JAPAN_SITEMAP_URL);
  const sitemapItems = parseForbesSitemapItems(sitemapXml, 20);
  const articles = [];

  for (const item of sitemapItems) {
    try {
      articles.push(await fetchForbesJapanArticle(item));
    } catch (error) {
      console.warn("Forbes JAPAN article skipped:", {
        link: item.link,
        message: error.message
      });
    }
  }

  const rssItems = articles
    .map(
      (article) => `
    <item>
      <title>${escapeXml(article.title)}</title>
      <link>${escapeXml(article.link)}</link>
      <guid>${escapeXml(article.link)}</guid>
      <pubDate>${escapeXml(article.pubDate)}</pubDate>
      <description>${escapeXml(article.contentSnippet)}</description>
    </item>`
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Forbes JAPAN</title>
    <link>https://forbesjapan.com/</link>
    <description>Forbes JAPAN official articles generated from the official sitemap.</description>${rssItems}
  </channel>
</rss>`;
}

async function fetchFeedArticles(feedDefinition) {
  const feed = await parser.parseURL(feedDefinition.url);

  return feed.items.map((item) => ({
    title: item.title,
    link: item.link,
    pubDate: item.pubDate,
    contentSnippet: item.contentSnippet,
    source: feedDefinition.name
  }));
}

async function fetchArticles(options = {}) {
  const feeds = await dbAll(`
    SELECT id, name, url
    FROM feeds
    ORDER BY id ASC
  `);
  const articles = [];
  const failedFeeds = Array.isArray(options.failedFeeds) ? options.failedFeeds : null;

  for (const feedDefinition of feeds) {
    try {
      const feedArticles = await fetchFeedArticles(feedDefinition);
      articles.push(...feedArticles);
    } catch (error) {
      const failedFeed = {
        id: feedDefinition.id,
        name: feedDefinition.name,
        url: feedDefinition.url,
        message: error.message
      };

      if (failedFeeds) {
        failedFeeds.push(failedFeed);
      }

      console.warn("RSS feed skipped:", failedFeed);
    }
  }

  return articles;
}

async function summarizeArticle(article) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY が設定されていません");
  }

  console.log("OpenAI summarize input:", {
    title: article.title,
    contentSnippet: article.contentSnippet || "",
    prompt: SUMMARY_PROMPT
  });

  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  const response = await client.responses.create({
    model: OPENAI_MODEL,
    input: [
      {
        role: "system",
        content: SUMMARY_PROMPT
      },
      {
        role: "user",
        content: [
          `タイトル: ${article.title}`,
          `本文抜粋: ${article.contentSnippet || ""}`,
          "上記の記事を指定形式で日本語要約してください。"
        ].join("\n")
      }
    ]
  });

  return response.output_text;
}

app.use(express.json());
app.use(express.static(PUBLIC_DIR));

app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.get(FORBES_JAPAN_FEED_PATH, async (req, res) => {
  try {
    const feedXml = await buildForbesJapanFeed();

    res.type("application/rss+xml").send(feedXml);
  } catch (error) {
    res.status(500).type("text/plain").send(error.message);
  }
});

app.get("/feeds", async (req, res) => {
  try {
    const feeds = await dbAll(`
      SELECT id, name, url
      FROM feeds
      ORDER BY id ASC
    `);

    res.json(feeds);
  } catch (error) {
    res.status(500).json({
      error: "フィード取得失敗",
      message: error.message
    });
  }
});

app.post("/feeds", async (req, res) => {
  try {
    const feed = normalizeFeedInput(req.body || {});
    const createdFeed = await dbGet(
      `
        INSERT INTO feeds (name, url)
        VALUES ($1, $2)
        ON CONFLICT (url) DO NOTHING
        RETURNING id, name, url
      `,
      [feed.name, feed.url]
    );

    if (!createdFeed) {
      res.status(409).json({
        error: "フィード追加失敗",
        message: "同じURLのフィードは登録済みです"
      });
      return;
    }

    res.status(201).json(createdFeed);
  } catch (error) {
    res.status(400).json({
      error: "フィード追加失敗",
      message: error.message
    });
  }
});

app.get("/articles", async (req, res) => {
  try {
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isNaN(requestedLimit)
      ? 20
      : Math.min(Math.max(requestedLimit, 1), 100);
    const selectedSource =
      typeof req.query.source === "string" ? req.query.source.trim() : "";
    const selectedTopic =
      typeof req.query.topic === "string" ? req.query.topic.trim() : "";
    const selectedView =
      typeof req.query.view === "string" ? req.query.view.trim() : "all";
    const topicKeywords = TOPIC_KEYWORDS[selectedTopic] || null;
    const queryParams = [];
    const conditions = [];

    if (selectedView === "readlater") {
      conditions.push("read_later = TRUE");
      conditions.push("dismissed = FALSE");
    } else if (selectedView === "not-readlater") {
      conditions.push("read_later = FALSE");
      conditions.push("dismissed = FALSE");
    } else if (selectedView === "dismissed") {
      conditions.push("dismissed = TRUE");
    } else if (selectedView === "unread") {
      conditions.push("dismissed = FALSE");
      conditions.push("is_read = FALSE");
    } else if (selectedView === "read") {
      conditions.push("dismissed = FALSE");
      conditions.push("is_read = TRUE");
    } else {
      conditions.push("dismissed = FALSE");
    }

    if (!topicKeywords && selectedSource) {
      queryParams.push(selectedSource);
      conditions.push(`source = $${queryParams.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const articles = await dbAll(
      `
        SELECT
          id,
          title,
          link,
          pub_date AS "pubDate",
          content_snippet AS "contentSnippet",
          source,
          summary,
          read_later AS "readLater",
          dismissed,
          is_read AS "isRead",
          created_at AS "createdAt"
        FROM articles
        ${whereClause}
      `,
      queryParams
    );

    const filteredArticles = topicKeywords
      ? articles.filter((article) => matchesTopic(article, topicKeywords))
      : articles;

    const sortedArticles = filteredArticles
      .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate))
      .slice(0, limit)
      .map((article) => {
        const summary =
          typeof article.summary === "string" ? article.summary.trim() : "";

        return {
          id: article.id,
          title: article.title,
          link: article.link,
          pubDate: article.pubDate,
          contentSnippet: article.contentSnippet,
          source: article.source,
          readLater: article.readLater,
          dismissed: article.dismissed,
          isRead: article.isRead,
          summary: summary || null,
          summaryStatus: summary ? "done" : "pending"
        };
      });

    res.json(sortedArticles);
  } catch (error) {
    res.status(500).json({
      error: "記事取得失敗",
      message: error.message
    });
  }
});

app.get("/articles/:id", async (req, res) => {
  try {
    const articleId = Number.parseInt(req.params.id, 10);

    if (Number.isNaN(articleId)) {
      res.status(400).json({
        error: "記事取得失敗",
        message: "記事IDが不正です"
      });
      return;
    }

    const article = await dbGet(
      `
        SELECT
          id,
          title,
          link,
          pub_date AS "pubDate",
          content_snippet AS "contentSnippet",
          source,
          summary,
          read_later AS "readLater",
          dismissed,
          is_read AS "isRead"
        FROM articles
        WHERE id = $1
      `,
      [articleId]
    );

    if (!article) {
      res.status(404).json({
        error: "記事取得失敗",
        message: "記事が見つかりません"
      });
      return;
    }

    res.json({
      id: article.id,
      title: article.title,
      source: article.source,
      pubDate: article.pubDate,
      contentSnippet: article.contentSnippet,
      summary: article.summary || null,
      readLater: article.readLater,
      dismissed: article.dismissed,
      isRead: article.isRead,
      link: article.link
    });
  } catch (error) {
    res.status(500).json({
      error: "記事取得失敗",
      message: error.message
    });
  }
});

async function updateArticleState(req, res, changes) {
  try {
    const articleId = Number.parseInt(req.params.id, 10);

    if (Number.isNaN(articleId)) {
      res.status(400).json({
        error: "記事更新失敗",
        message: "記事IDが不正です"
      });
      return;
    }

    const assignments = [];
    const params = [];

    for (const [column, value] of Object.entries(changes)) {
      params.push(value);
      assignments.push(`${column} = $${params.length}`);
    }

    params.push(articleId);

    const article = await dbGet(
      `
        UPDATE articles
        SET ${assignments.join(", ")}
        WHERE id = $${params.length}
        RETURNING
          id,
          read_later AS "readLater",
          dismissed,
          is_read AS "isRead"
      `,
      params
    );

    if (!article) {
      res.status(404).json({
        error: "記事更新失敗",
        message: "記事が見つかりません"
      });
      return;
    }

    res.json(article);
  } catch (error) {
    res.status(500).json({
      error: "記事更新失敗",
      message: error.message
    });
  }
}

app.post("/articles/:id/readlater", (req, res) => {
  updateArticleState(req, res, { read_later: true });
});

app.post("/articles/:id/unreadlater", (req, res) => {
  updateArticleState(req, res, { read_later: false });
});

app.post("/articles/:id/dismiss", (req, res) => {
  updateArticleState(req, res, { dismissed: true });
});

app.post("/articles/:id/undismiss", (req, res) => {
  updateArticleState(req, res, { dismissed: false });
});

app.post("/articles/:id/read", (req, res) => {
  updateArticleState(req, res, { is_read: true });
});

app.post("/articles/:id/unread", (req, res) => {
  updateArticleState(req, res, { is_read: false });
});

app.post("/fetch-rss", async (req, res) => {
  try {
    const failedFeeds = [];
    const articles = await fetchArticles({ failedFeeds });
    let insertedCount = 0;

    for (const article of articles) {
      const result = await dbRun(
        `
          INSERT INTO articles (
            title,
            link,
            pub_date,
            content_snippet,
            source
          ) VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (link) DO NOTHING
        `,
        [
          article.title,
          article.link,
          article.pubDate,
          article.contentSnippet,
          article.source
        ]
      );

      insertedCount += result.rowCount;
    }

    res.json({
      fetchedCount: articles.length,
      insertedCount,
      failedFeeds
    });
  } catch (error) {
    res.status(500).json({
      error: "RSS取得失敗",
      message: error.message
    });
  }
});

app.post("/summarize-test", async (req, res) => {
  try {
    const articles = await fetchArticles();
    const latestArticle = articles[0];

    if (!latestArticle) {
      throw new Error("RSS記事が見つかりません");
    }

    const summary = await summarizeArticle(latestArticle);

    res.json({
      title: latestArticle.title,
      link: latestArticle.link,
      summary
    });
  } catch (error) {
    res.status(500).json({
      error: "要約失敗",
      message: error.message
    });
  }
});

app.post("/summarize-pending", async (req, res) => {
  try {
    const article = await dbGet(`
      SELECT
        id,
        title,
        link,
        pub_date AS "pubDate",
        content_snippet AS "contentSnippet",
        source,
        summary,
        created_at AS "createdAt"
      FROM articles
      WHERE summary IS NULL
      ORDER BY id ASC
      LIMIT 1
    `);

    if (!article) {
      res.json({ message: "未要約記事はありません" });
      return;
    }

    const summary = await summarizeArticle(article);

    await dbRun(
      `
        UPDATE articles
        SET summary = $1
        WHERE id = $2
      `,
      [summary, article.id]
    );

    res.json({
      id: article.id,
      title: article.title,
      summary
    });
  } catch (error) {
    res.status(500).json({
      error: "要約失敗",
      message: error.message
    });
  }
});

app.post("/articles/:id/resummarize", async (req, res) => {
  try {
    const articleId = Number.parseInt(req.params.id, 10);

    if (Number.isNaN(articleId)) {
      throw new Error("記事IDが不正です");
    }

    const article = await dbGet(
      `
        SELECT
          id,
          title,
          link,
          pub_date AS "pubDate",
          content_snippet AS "contentSnippet",
          source,
          summary,
          created_at AS "createdAt"
        FROM articles
        WHERE id = $1
      `,
      [articleId]
    );

    if (!article) {
      res.status(404).json({
        error: "要約失敗",
        message: "記事が見つかりません"
      });
      return;
    }

    const summary = await summarizeArticle(article);

    await dbRun(
      `
        UPDATE articles
        SET summary = $1
        WHERE id = $2
      `,
      [summary, article.id]
    );

    res.json({
      id: article.id,
      title: article.title,
      summary
    });
  } catch (error) {
    res.status(500).json({
      error: "要約失敗",
      message: error.message
    });
  }
});

async function startServer() {
  try {
    await initializeDatabase();

    app.listen(PORT, () => {
      console.log(`RSS server is running at http://localhost:${PORT}`);
      console.log("PostgreSQL database is connected");
    });
  } catch (error) {
    console.error("Server startup failed:", error.message);
    process.exit(1);
  }
}

startServer();
