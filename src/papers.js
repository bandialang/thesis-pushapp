import crypto from "node:crypto";
import { config } from "./config.js";

const TOPIC_QUERIES = [
  {
    key: "comics",
    label: "만화",
    keywords: ["comic", "comics", "manga", "webtoon", "graphic narrative", "만화", "웹툰", "그래픽노블"],
    koreanQueries: ["만화", "웹툰", "그래픽노블"],
    query:
      'all:"comic" OR all:"comics" OR all:"manga" OR all:"webtoon" OR all:"graphic narrative"'
  },
  {
    key: "animation",
    label: "애니메이션",
    keywords: ["animation", "animated", "anime", "cartoon", "애니메이션", "애니", "만화영화"],
    koreanQueries: ["애니메이션", "애니", "만화영화"],
    query:
      'all:"animation" OR all:"animated" OR all:"anime" OR all:"character motion" OR all:"toon"'
  },
  {
    key: "text-mining",
    label: "텍스트마이닝",
    keywords: [
      "text mining",
      "opinion mining",
      "topic modeling",
      "information extraction",
      "nlp",
      "text analysis",
      "document mining",
      "텍스트마이닝",
      "텍스트 마이닝",
      "토픽 모델링",
      "정보 추출",
      "감성 분석",
      "자연어 처리"
    ],
    koreanQueries: ["텍스트마이닝", "자연어 처리", "감성 분석"],
    query:
      'all:"text mining" OR all:"opinion mining" OR all:"topic modeling" OR all:"information extraction" OR all:"nlp"'
  }
];

function formatDateOffset(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

function formatYearMonthOffset(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 7).replaceAll("-", "");
}

function stripXml(value) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getTagValue(xmlChunk, tagName) {
  const match = xmlChunk.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, "i"));
  return match ? stripXml(match[1]) : "";
}

function getTagValues(xmlChunk, tagName) {
  return [...xmlChunk.matchAll(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, "gi"))].map(
    (match) => stripXml(match[1])
  );
}

function hashToNumber(seed) {
  const hash = crypto.createHash("sha256").update(seed).digest("hex");
  return Number.parseInt(hash.slice(0, 12), 16);
}

function deterministicShuffle(items, seed) {
  const clone = [...items];

  clone.sort((left, right) => {
    const leftScore = hashToNumber(`${seed}:${left.id}`);
    const rightScore = hashToNumber(`${seed}:${right.id}`);
    return leftScore - rightScore;
  });

  return clone;
}

function differenceInDays(laterDateKey, earlierDateKey) {
  const later = new Date(`${laterDateKey}T00:00:00Z`);
  const earlier = new Date(`${earlierDateKey}T00:00:00Z`);
  return Math.floor((later.getTime() - earlier.getTime()) / 86400000);
}

function normalizePaper(rawPaper, topicLabel) {
  return {
    id: rawPaper.id,
    title: rawPaper.title,
    summary: rawPaper.summary,
    authors: rawPaper.authors,
    published: rawPaper.published,
    link: rawPaper.link,
    topicLabel,
    source: rawPaper.source || "unknown",
    relevanceScore: rawPaper.relevanceScore || 0
  };
}

function scorePaperForTopic(paper, topic) {
  const haystack = `${paper.title} ${paper.summary}`.toLowerCase();
  let score = 0;

  for (const keyword of topic.keywords) {
    const normalized = keyword.toLowerCase();
    const matched = /^[a-z0-9 -]+$/i.test(normalized)
      ? new RegExp(`(^|[^a-z])${normalized.replaceAll(" ", "\\s+")}([^a-z]|$)`, "i").test(haystack)
      : haystack.includes(normalized);

    if (matched) {
      score += normalized.includes(" ") ? 3 : 1;
    }
  }

  if (paper.title.toLowerCase().includes(topic.key)) {
    score += 2;
  }

  return score;
}

function toTopicPaper(rawPaper, topic, minimumScore = 1) {
  const score = scorePaperForTopic(rawPaper, topic);
  if (score < minimumScore) {
    return null;
  }

  return normalizePaper(
    {
      ...rawPaper,
      relevanceScore: score
    },
    topic.label
  );
}

async function fetchArxivTopic(topic, lookbackDays) {
  const startDate = formatDateOffset(lookbackDays);
  const searchQuery = encodeURIComponent(`(${topic.query}) AND submittedDate:[${startDate}0000 TO 300012312359]`);
  const url = `https://export.arxiv.org/api/query?search_query=${searchQuery}&start=0&max_results=25&sortBy=submittedDate&sortOrder=descending`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "thesis-pushapp/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`arXiv fetch failed for ${topic.key}: ${response.status}`);
  }

  const xml = await response.text();
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((match) => match[1]);

  return entries
    .map((entry) => ({
      id: getTagValue(entry, "id"),
      title: getTagValue(entry, "title"),
      summary: getTagValue(entry, "summary"),
      authors: getTagValues(entry, "name"),
      published: getTagValue(entry, "published"),
      link: getTagValue(entry, "id"),
      source: "arXiv"
    }))
    .map((paper) => toTopicPaper(paper, topic, 1))
    .filter(Boolean);
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripHtml(text) {
  return decodeHtmlEntities(text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

async function fetchKciTopic(topic, lookbackDays) {
  if (!config.kciApiKey) {
    return [];
  }

  const dateFrom = formatYearMonthOffset(lookbackDays);
  const dateTo = new Date().toISOString().slice(0, 7).replaceAll("-", "");
  const results = [];

  for (const queryText of topic.koreanQueries) {
    const url = new URL("https://open.kci.go.kr/po/openapi/openApiSearch.kci");
    url.searchParams.set("key", config.kciApiKey);
    url.searchParams.set("apiCode", "articleSearch");
    url.searchParams.set("title", queryText);
    url.searchParams.set("keyword", queryText);
    url.searchParams.set("dateFrom", dateFrom);
    url.searchParams.set("dateTo", dateTo);
    url.searchParams.set("displayCount", "10");
    url.searchParams.set("page", "1");
    url.searchParams.set("sortNm", "pubiYr");

    const response = await fetch(url, {
      headers: {
        "User-Agent": "thesis-pushapp/1.0"
      }
    });

    if (!response.ok) {
      throw new Error(`KCI fetch failed for ${topic.key}: ${response.status}`);
    }

    const xml = await response.text();
    const records = [...xml.matchAll(/<record>([\s\S]*?)<\/record>/g)].map((match) => match[1]);

    for (const record of records) {
      const pubYear = getTagValue(record, "pub-year");
      const pubMonth = getTagValue(record, "pub-mon") || "01";
      const title =
        getTagValue(record, "article-title") ||
        getTagValue(record, "title-group");
      const summary = getTagValue(record, "abstract");
      const authors = getTagValues(record, "author").map((author) => author.split("(")[0].trim());
      const link = getTagValue(record, "url");
      const articleId = getTagValue(record, "article-id") || link || `${topic.key}:${title}`;

      results.push({
        id: `kci:${articleId}`,
        title,
        summary,
        authors,
        published: pubYear ? `${pubYear}-${pubMonth.padStart(2, "0")}-01` : "",
        link: link || "https://www.kci.go.kr/",
        source: "KCI"
      });
    }
  }

  return results
    .map((paper) => toTopicPaper(paper, topic, 1))
    .filter(Boolean);
}

async function fetchRissTopic(topic) {
  const results = [];

  for (const queryText of topic.koreanQueries) {
    const url = `https://www.riss.kr/search/Search.do?query=${encodeURIComponent(queryText)}&colName=re_a_kor`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": "thesis-pushapp/1.0"
      }
    });

    if (!response.ok) {
      throw new Error(`RISS fetch failed for ${topic.key}: ${response.status}`);
    }

    const html = await response.text();
    const matches = [
      ...html.matchAll(
        /<p class="title"><a href="(\/search\/detail\/DetailView\.do\?[^"]*p_mat_type=1a0202e37d52c72d[^"]*control_no=[^"]+)"[^>]*>([\s\S]*?)<\/a><\/p>/gi
      )
    ];

    for (const match of matches.slice(0, 12)) {
      const fullLink = match[1].replace(/&amp;/g, "&");
      const normalizedLinkMatch = fullLink.match(/p_mat_type=([^&]+).*?control_no=([^&]+)/);
      const link = normalizedLinkMatch
        ? `https://www.riss.kr/search/detail/DetailView.do?p_mat_type=${normalizedLinkMatch[1]}&control_no=${normalizedLinkMatch[2]}`
        : `https://www.riss.kr${fullLink}`;
      const title = stripHtml(match[2]);
      const surrounding = html.slice(Math.max(0, match.index - 400), Math.min(html.length, match.index + 1000));
      const writerMatch = surrounding.match(/<span class="writer">([\s\S]*?)<\/span>/i);
      const abstractMatch = surrounding.match(/<p class="preAbstract">([\s\S]*?)<\/p>/i);
      const yearMatch = surrounding.match(/<span class="year">([\s\S]*?)<\/span>/i);
      const authors = writerMatch
        ? [...writerMatch[1].matchAll(/>([^<()]+)(?:\(|<\/a>)/g)].map((authorMatch) => stripHtml(authorMatch[1])).filter(Boolean)
        : [];

      if (!title || title.length < 2) {
        continue;
      }

      results.push({
        id: `riss:${match[1]}`,
        title,
        summary: abstractMatch ? stripHtml(abstractMatch[1]) : "",
        authors,
        published: yearMatch ? `${stripHtml(yearMatch[1]).slice(0, 4)}-01-01` : "",
        link,
        source: "RISS"
      });
    }
  }

  const filtered = results
    .map((paper) => toTopicPaper(paper, topic, 1))
    .filter(Boolean);

  return filtered;
}

function dedupePapers(papers) {
  const seen = new Set();
  const output = [];

  for (const paper of papers) {
    if (!paper.id || seen.has(paper.id)) {
      continue;
    }

    seen.add(paper.id);
    output.push(paper);
  }

  return output;
}

function buildRecentPaperIdSet(sentHistory, dateKey, noRepeatDays) {
  const recentIds = new Set();

  for (const entry of sentHistory) {
    const age = differenceInDays(dateKey, entry.dateKey);
    if (age >= 0 && age < noRepeatDays) {
      for (const paperId of entry.paperIds) {
        recentIds.add(paperId);
      }
    }
  }

  return recentIds;
}

function splitByTopic(papers) {
  return TOPIC_QUERIES.map((topic) => ({
    topicLabel: topic.label,
    papers: papers.filter((paper) => paper.topicLabel === topic.label)
  }));
}

function parsePublishedTimestamp(published) {
  if (!published) {
    return 0;
  }

  const time = new Date(published).getTime();
  return Number.isFinite(time) ? time : 0;
}

function selectBalancedPapers(papers, count, dateKey) {
  const topicBuckets = splitByTopic(papers).map((bucket) => ({
    topicLabel: bucket.topicLabel,
    papers: deterministicShuffle(bucket.papers, `${dateKey}:${bucket.topicLabel}`).sort((left, right) => {
      const rank = { KCI: 0, RISS: 1, arXiv: 2, unknown: 3 };
      const sourceGap = (rank[left.source] ?? 9) - (rank[right.source] ?? 9);
      if (sourceGap !== 0) {
        return sourceGap;
      }

      const scoreGap = (right.relevanceScore ?? 0) - (left.relevanceScore ?? 0);
      if (scoreGap !== 0) {
        return scoreGap;
      }

      return parsePublishedTimestamp(right.published) - parsePublishedTimestamp(left.published);
    }),
    index: 0
  }));
  const picked = [];

  while (picked.length < count) {
    let addedAny = false;

    for (const bucket of topicBuckets) {
      if (picked.length >= count) {
        break;
      }

      const candidate = bucket.papers[bucket.index];
      if (!candidate) {
        continue;
      }

      bucket.index += 1;
      picked.push(candidate);
      addedAny = true;
    }

    if (!addedAny) {
      break;
    }
  }

  return picked;
}

export async function getDailyPaperSelection({ count, lookbackDays, dateKey, noRepeatDays, sentHistory = [] }) {
  const topicResults = await Promise.allSettled(
    TOPIC_QUERIES.flatMap((topic) => [
      ...(topic.key === "text-mining" ? [fetchArxivTopic(topic, lookbackDays)] : []),
      fetchKciTopic(topic, lookbackDays),
      fetchRissTopic(topic)
    ])
  );
  const successfulResults = topicResults
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);
  const merged = dedupePapers(successfulResults.flat());

  if (merged.length === 0) {
    const failures = topicResults
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));
    throw new Error(`No papers available. ${failures.join(" | ")}`);
  }
  const recentPaperIds = buildRecentPaperIdSet(sentHistory, dateKey, noRepeatDays);
  const unseenFirst = merged.filter((paper) => !recentPaperIds.has(paper.id));
  const fallbackPool = merged.filter((paper) => recentPaperIds.has(paper.id));
  const selected = selectBalancedPapers(unseenFirst, count, dateKey);

  if (selected.length < count) {
    const needed = count - selected.length;
    const fallbackSelected = selectBalancedPapers(fallbackPool, needed, `${dateKey}:fallback`);
    selected.push(...fallbackSelected);
  }

  return {
    dateKey,
    topics: TOPIC_QUERIES.map((topic) => topic.label),
    totalCandidates: merged.length,
    freshCandidates: unseenFirst.length,
    papers: selected
  };
}

export function buildRecommendationMessage(selection) {
  const header = `[오늘의 논문 추천]\n주제: ${selection.topics.join(", ")}\n선정일: ${selection.dateKey}`;

  const lines = selection.papers.map((paper, index) => {
    const authorText = paper.authors.slice(0, 3).join(", ");

    return [
      `${index + 1}. ${paper.title}`,
      `분야: ${paper.topicLabel}`,
      `출처: ${paper.source}`,
      `저자: ${authorText}${paper.authors.length > 3 ? " 외" : ""}`,
      `링크: ${paper.link}`
    ].join("\n");
  });

  return `${header}\n\n${lines.join("\n\n")}`;
}
