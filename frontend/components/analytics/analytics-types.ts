export type AnalyticsScope = "all" | "me";
export type AnalyticsDays = "7" | "30" | "all";

export interface QueriedArticleMetric {
  article_id: string;
  article_number: number;
  label: string;
  full_label: string;
  statute: string;
  book_name: string;
  short_book: string;
  title_name: string;
  count: number;
  share_percent: number;
}

export interface AnsweredArticleMetric extends QueriedArticleMetric {
  global_count: number;
  my_count: number;
}

export interface TopicMetric {
  topic: string;
  count: number;
  share_percent: number;
  top_article_id: string | null;
  top_article_label: string | null;
}

export interface TimelinePoint {
  date: string;
  label: string;
  consultations: number;
  document_analyses: number;
  queries: number;
}

export interface NliBandMetric {
  key:
    | "strict_entailment"
    | "substantially_consistent"
    | "generalized"
    | "contradicted"
    | "out_of_domain";
  label: string;
  range: string;
  count: number;
  share_percent: number;
}

export interface MixSegmentMetric {
  key: string;
  label: string;
  count: number;
  share_percent: number;
}

export interface DocumentStageMetric {
  key: "accepted_civil" | "rejected_out_of_domain" | "builder_drafts";
  label: string;
  count: number;
  share_percent: number;
}

export interface AnalyticsOverviewResponse {
  scope: AnalyticsScope;
  days: AnalyticsDays;
  generated_at: string;
  summary: {
    total_queries: number;
    total_answers: number;
    total_sessions: number;
    active_users: number;
    unique_articles_cited: number;
    total_article_queries: number;
    total_article_citations: number;
    avg_nli_score: number | null;
    high_grounding_rate: number | null;
    total_documents: number;
  };
  most_queried_articles: QueriedArticleMetric[];
  most_answered_articles: AnsweredArticleMetric[];
  top_topics: {
    total_hits: number;
    items: TopicMetric[];
  };
  activity_timeline: {
    granularity: "day" | "week";
    points: TimelinePoint[];
  };
  nli_distribution: {
    bands: NliBandMetric[];
    total_classified: number;
    total_scored_in_domain: number;
    unscored_count: number;
    avg_score: number | null;
    median_score: number | null;
    high_grounding_rate: number | null;
  };
  language_mix: {
    total: number;
    segments: MixSegmentMetric[];
  };
  domain_intent_mix: {
    total: number;
    clarification_count: number;
    segments: MixSegmentMetric[];
    redirect_breakdown: Array<{ domain: string; count: number }>;
  };
  document_funnel: {
    total_documents: number;
    total_uploaded: number;
    in_progress: number;
    acceptance_rate: number | null;
    stages: DocumentStageMetric[];
  };
}
