"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  AlertCircle,
  BarChart3,
  BookOpen,
  FileCheck2,
  Globe,
  Languages,
  PieChart as PieChartIcon,
  RefreshCw,
  Scale,
  ShieldCheck,
  User,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { apiUrl } from "@/lib/config";
import type {
  AnalyticsDays,
  AnalyticsOverviewResponse,
  AnalyticsScope,
  AnsweredArticleMetric,
  DocumentStageMetric,
  NliBandMetric,
  QueriedArticleMetric,
  TimelinePoint,
  TopicMetric,
} from "./analytics-types";
import {
  AnalyticsSkeleton,
  AnalyticsTooltipBox,
  ChartCard,
  ChartEmptyState,
  SegmentedSwitch,
} from "./chart-primitives";

const TOPIC_COLORS = [
  "var(--chart-1)",
  "var(--chart-6)",
  "var(--chart-2)",
  "var(--chart-4)",
  "var(--chart-3)",
  "var(--chart-5)",
  "var(--chart-7)",
];

const NLI_BAND_COLORS: Record<NliBandMetric["key"], string> = {
  strict_entailment: "var(--chart-2)",
  substantially_consistent: "var(--chart-4)",
  generalized: "var(--chart-3)",
  contradicted: "var(--chart-5)",
  out_of_domain: "var(--chart-6)",
};

const NLI_SHORT_LABELS: Record<NliBandMetric["key"], string> = {
  strict_entailment: ">=85%",
  substantially_consistent: "70-84%",
  generalized: "<70%",
  contradicted: "Contradicted",
  out_of_domain: "OOD",
};

const DOC_STAGE_COLORS: Record<DocumentStageMetric["key"], string> = {
  accepted_civil: "var(--chart-2)",
  rejected_out_of_domain: "var(--chart-5)",
  builder_drafts: "var(--chart-6)",
};

const SCOPE_OPTIONS: Array<{ value: AnalyticsScope; label: string }> = [
  { value: "all", label: "All Users" },
  { value: "me", label: "My Activity" },
];

const DAYS_OPTIONS: Array<{ value: AnalyticsDays; label: string }> = [
  { value: "7", label: "7D" },
  { value: "30", label: "30D" },
  { value: "all", label: "All" },
];

const emptySubscribe = () => () => {};
function useIsClient(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
}

interface DashboardAnalyticsSectionProps {
  // undefined = auth still loading; null = unauthenticated; string = ready JWT
  accessToken?: string | null;
}

export function DashboardAnalyticsSection({ accessToken }: DashboardAnalyticsSectionProps) {
  const router = useRouter();
  const isClient = useIsClient();

  const [scope, setScope] = useState<AnalyticsScope>("all");
  const [days, setDays] = useState<AnalyticsDays>("all");
  const [data, setData] = useState<AnalyticsOverviewResponse | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeKey = `${scope}:${days}`;
  const isLoading =
    accessToken === undefined ||
    (Boolean(accessToken) && loadedKey !== activeKey && !error);

  const requestOverview = useCallback(
    async (
      targetScope: AnalyticsScope,
      targetDays: AnalyticsDays,
      token: string,
      options?: { fresh?: boolean; signal?: AbortSignal }
    ) => {
      const qs = new URLSearchParams({
        scope: targetScope,
        days: targetDays,
        ...(options?.fresh ? { fresh: "1" } : {}),
      });

      const res = await fetch(apiUrl(`/api/analytics/overview?${qs.toString()}`), {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: options?.signal,
      });

      if (!res.ok) {
        throw new Error(`Analytics request failed (${res.status})`);
      }

      return (await res.json()) as AnalyticsOverviewResponse;
    },
    []
  );

  useEffect(() => {
    if (accessToken === undefined || accessToken === null) {
      return;
    }

    const controller = new AbortController();
    const key = `${scope}:${days}`;

    requestOverview(scope, days, accessToken, { signal: controller.signal })
      .then((payload) => {
        setData(payload);
        setError(null);
        setLoadedKey(key);
      })
      .catch((err: unknown) => {
        if ((err as Error)?.name === "AbortError") return;
        setError("Unable to load legal analytics right now. Please try again.");
      });

    return () => controller.abort();
  }, [accessToken, scope, days, requestOverview]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    setError(null);
    try {
      let token = accessToken ?? null;
      if (!token) {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        token = session?.access_token ?? null;
      }
      if (!token) return;
      const payload = await requestOverview(scope, days, token, { fresh: true });
      setData(payload);
      setLoadedKey(`${scope}:${days}`);
    } catch {
      setError("Unable to load legal analytics right now. Please try again.");
    } finally {
      setIsRefreshing(false);
    }
  }, [accessToken, scope, days, requestOverview]);

  const navigateToArticle = useCallback(
    (articleId?: string | null) => {
      if (!articleId) return;
      router.push(`/civil-code?article=${encodeURIComponent(articleId)}`);
    },
    [router]
  );

  const nliChartData = useMemo(() => {
    if (!data) return [];
    return data.nli_distribution.bands.map((band) => ({
      ...band,
      shortLabel: NLI_SHORT_LABELS[band.key],
      fill: NLI_BAND_COLORS[band.key],
    }));
  }, [data]);

  const topicChartData = useMemo(() => {
    if (!data) return [];
    return data.top_topics.items.map((item, idx) => ({
      ...item,
      fill: TOPIC_COLORS[idx % TOPIC_COLORS.length],
    }));
  }, [data]);

  const docFunnelChartData = useMemo(() => {
    if (!data) return [];
    return data.document_funnel.stages.map((stage) => ({
      ...stage,
      fill: DOC_STAGE_COLORS[stage.key],
    }));
  }, [data]);

  const languageStackedData = useMemo(() => {
    if (!data || data.language_mix.total === 0) return [];
    const english = data.language_mix.segments.find((s) => s.key === "english")?.count ?? 0;
    const tagalog = data.language_mix.segments.find((s) => s.key === "tagalog")?.count ?? 0;
    return [{ name: "Language", english, tagalog }];
  }, [data]);

  const domainStackedData = useMemo(() => {
    if (!data || data.domain_intent_mix.total === 0) return [];
    const civil = data.domain_intent_mix.segments.find((s) => s.key === "in_domain_civil")?.count ?? 0;
    const nonCivil = data.domain_intent_mix.segments.find((s) => s.key === "non_civil_legal")?.count ?? 0;
    const nonLegal = data.domain_intent_mix.segments.find((s) => s.key === "non_legal_refusal")?.count ?? 0;
    return [{ name: "Intent", civil, nonCivil, nonLegal }];
  }, [data]);

  const hasTimelineActivity = useMemo(() => {
    if (!data) return false;
    return data.activity_timeline.points.some(
      (p) => p.consultations > 0 || p.document_analyses > 0 || p.queries > 0
    );
  }, [data]);

  const answeredArticlesHasPersonal = useMemo(() => {
    if (!data) return false;
    return data.most_answered_articles.some((item) => item.my_count > 0);
  }, [data]);

  const handleExpandWindow = useCallback(() => {
    if (days !== "all") {
      setDays("all");
    } else if (scope === "me") {
      setScope("all");
    }
  }, [days, scope]);

  const timeframeLabel = days === "7" ? "Last 7 Days" : days === "30" ? "Last 30 Days" : "All Time";

  return (
    <section aria-labelledby="legal-analytics-heading" className="space-y-3.5 sm:space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 pt-1">
        <div className="space-y-0.5 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2
              id="legal-analytics-heading"
              className="text-sm sm:text-base 2xl:text-lg font-bold tracking-tight text-foreground flex items-center gap-2"
            >
              <BarChart3 strokeWidth={1.75} className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
              <span>Legal Intelligence &amp; Usage Analytics</span>
            </h2>
            <Badge
              variant="outline"
              className="text-[10px] font-medium px-2 py-0 h-5 gap-1 text-muted-foreground border-border/80"
            >
              {scope === "all" ? (
                <>
                  <Globe className="w-3 h-3" aria-hidden="true" />
                  <span>Anonymized Global Totals</span>
                </>
              ) : (
                <>
                  <User className="w-3 h-3" aria-hidden="true" />
                  <span>Personal Activity Only</span>
                </>
              )}
            </Badge>
          </div>
          <p className="text-[11px] sm:text-xs text-muted-foreground leading-relaxed">
            Statutory query demand, citation grounding, NLI entailment reliability, and document validation metrics ({timeframeLabel}).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <SegmentedSwitch
            value={scope}
            options={SCOPE_OPTIONS}
            onChange={setScope}
            ariaLabel="Analytics scope"
            disabled={isLoading && !data}
          />
          <SegmentedSwitch
            value={days}
            options={DAYS_OPTIONS}
            onChange={setDays}
            ariaLabel="Analytics timeframe"
            disabled={isLoading && !data}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isLoading || isRefreshing}
            aria-label="Refresh legal analytics"
            className="h-8 px-2.5 rounded-xl text-xs cursor-pointer border-border/80"
          >
            <RefreshCw
              strokeWidth={1.75}
              className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
          </Button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-2xl border border-destructive/40 bg-destructive-soft/50 px-4 py-3 flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2 text-xs text-foreground">
            <AlertCircle className="w-4 h-4 text-destructive shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            className="h-7 text-xs cursor-pointer"
          >
            Retry
          </Button>
        </div>
      )}

      {isLoading && !data ? (
        <AnalyticsSkeleton />
      ) : data ? (
        <div className={`space-y-4 transition-opacity duration-200 ${isLoading ? "opacity-65" : "opacity-100"}`}>
          {/* Quiet Telemetry Summary Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
            <div className="rounded-xl border border-border/80 bg-card px-3.5 py-2.5 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[10px] sm:text-[11px] text-muted-foreground font-medium truncate">
                  Queries Analyzed
                </p>
                <p className="text-base sm:text-lg font-bold text-foreground tabular-nums">
                  {data.summary.total_queries.toLocaleString()}
                </p>
              </div>
              <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                {data.summary.total_sessions} sessions
              </span>
            </div>

            <div className="rounded-xl border border-border/80 bg-card px-3.5 py-2.5 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[10px] sm:text-[11px] text-muted-foreground font-medium truncate">
                  Unique Articles Cited
                </p>
                <p className="text-base sm:text-lg font-bold text-foreground tabular-nums">
                  {data.summary.unique_articles_cited.toLocaleString()}
                </p>
              </div>
              <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                {data.summary.total_article_citations.toLocaleString()} hits
              </span>
            </div>

            <div className="rounded-xl border border-border/80 bg-card px-3.5 py-2.5 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[10px] sm:text-[11px] text-muted-foreground font-medium truncate">
                  Mean NLI Grounding
                </p>
                <p className="text-base sm:text-lg font-bold text-foreground tabular-nums">
                  {data.summary.avg_nli_score !== null ? `${data.summary.avg_nli_score}%` : "N/A"}
                </p>
              </div>
              <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                {data.nli_distribution.median_score !== null
                  ? `med ${data.nli_distribution.median_score}%`
                  : "no scores"}
              </span>
            </div>

            <div className="rounded-xl border border-border/80 bg-card px-3.5 py-2.5 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[10px] sm:text-[11px] text-muted-foreground font-medium truncate">
                  Entailment (&gt;=70%)
                </p>
                <p className="text-base sm:text-lg font-bold text-foreground tabular-nums">
                  {data.summary.high_grounding_rate !== null
                    ? `${data.summary.high_grounding_rate}%`
                    : "N/A"}
                </p>
              </div>
              <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                {data.nli_distribution.total_scored_in_domain} scored
              </span>
            </div>
          </div>

          {/* BAND 1: Activity Timeline (span 7) + NLI Grounding Distribution (span 5) */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-stretch">
            <ChartCard
              className="xl:col-span-7"
              title="Query & Document Activity Timeline"
              description={`${
                data.activity_timeline.granularity === "week" ? "Weekly" : "Daily"
              } trend of Legal Consultations vs. Document Analyses`}
              icon={<Activity strokeWidth={1.75} className="w-4 h-4 text-[var(--chart-4)]" />}
              ariaLabel={`Activity timeline showing ${data.summary.total_sessions} sessions over ${timeframeLabel}`}
              headerRight={
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[var(--chart-4)]" aria-hidden="true" />
                    <span className="hidden sm:inline">Consultations</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[var(--chart-2)]" aria-hidden="true" />
                    <span className="hidden sm:inline">Doc Audits</span>
                  </span>
                </div>
              }
            >
              {hasTimelineActivity && isClient ? (
                <div className="w-full h-[240px] min-w-0">
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <AreaChart
                      data={data.activity_timeline.points}
                      margin={{ top: 8, right: 12, left: -16, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="civilexConsultFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--chart-4)" stopOpacity={0.32} />
                          <stop offset="95%" stopColor="var(--chart-4)" stopOpacity={0.02} />
                        </linearGradient>
                        <linearGradient id="civilexDocFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--chart-2)" stopOpacity={0.32} />
                          <stop offset="95%" stopColor="var(--chart-2)" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                        axisLine={false}
                        tickLine={false}
                        minTickGap={22}
                      />
                      <YAxis
                        allowDecimals={false}
                        tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload || payload.length === 0) return null;
                          const pt = payload[0]?.payload as TimelinePoint | undefined;
                          if (!pt) return null;
                          return (
                            <AnalyticsTooltipBox
                              title={pt.label}
                              subtitle={pt.date}
                              rows={[
                                {
                                  label: "Legal Consultations",
                                  value: pt.consultations,
                                  color: "var(--chart-4)",
                                },
                                {
                                  label: "Document Analyses",
                                  value: pt.document_analyses,
                                  color: "var(--chart-2)",
                                },
                                {
                                  label: "Total User Queries",
                                  value: pt.queries,
                                },
                              ]}
                            />
                          );
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="consultations"
                        name="Legal Consultations"
                        stroke="var(--chart-4)"
                        strokeWidth={2}
                        fill="url(#civilexConsultFill)"
                        activeDot={{ r: 4 }}
                      />
                      <Area
                        type="monotone"
                        dataKey="document_analyses"
                        name="Document Analyses"
                        stroke="var(--chart-2)"
                        strokeWidth={2}
                        fill="url(#civilexDocFill)"
                        activeDot={{ r: 4 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <ChartEmptyState
                  icon={<Activity className="w-6 h-6" />}
                  title="No consultation or document activity in this window"
                  description="Expand the timeframe or start a new legal consultation to populate activity trends."
                  actionLabel={days !== "all" ? "View All Time" : scope === "me" ? "View All Users" : undefined}
                  onAction={days !== "all" || scope === "me" ? handleExpandWindow : undefined}
                />
              )}
            </ChartCard>

            <ChartCard
              className="xl:col-span-5"
              title="NLI Statutory Grounding Distribution"
              description="Neuro-Symbolic Hybrid NLI (Symbolic Rules + Gemma) & out-of-domain guardrails"
              icon={<ShieldCheck strokeWidth={1.75} className="w-4 h-4 text-[var(--chart-2)]" />}
              ariaLabel={`NLI statutory grounding distribution across ${data.nli_distribution.total_classified} evaluated responses`}
              headerRight={
                <Badge variant="outline" className="text-[10px] font-mono px-2 py-0 h-5">
                  n = {data.nli_distribution.total_classified}
                </Badge>
              }
            >
              {data.nli_distribution.total_classified > 0 && isClient ? (
                <div className="flex flex-col flex-1 justify-between gap-3">
                  <div className="w-full h-[185px] min-w-0">
                    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                      <BarChart
                        data={nliChartData}
                        margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                        <XAxis
                          dataKey="shortLabel"
                          interval={0}
                          tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          allowDecimals={false}
                          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <Tooltip
                          cursor={{ fill: "var(--accent)", opacity: 0.4 }}
                          content={({ active, payload }) => {
                            if (!active || !payload || payload.length === 0) return null;
                            const band = payload[0]?.payload as (NliBandMetric & { fill: string }) | undefined;
                            if (!band) return null;
                            return (
                              <AnalyticsTooltipBox
                                title={band.label}
                                subtitle={`Band: ${band.range}`}
                                rows={[
                                  { label: "Responses", value: band.count, color: band.fill },
                                  { label: "Share", value: `${band.share_percent}%` },
                                ]}
                              />
                            );
                          }}
                        />
                        <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={38} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 pt-2 border-t border-border/60">
                    {nliChartData.map((band, idx) => (
                      <div
                        key={band.key}
                        className={`flex items-center justify-between gap-1.5 text-[11px] px-1.5 py-0.5 rounded-md bg-muted/35 ${
                          idx === nliChartData.length - 1 && nliChartData.length % 2 === 1
                            ? "col-span-2"
                            : ""
                        }`}
                      >
                        <span className="flex items-center gap-1.5 min-w-0 text-muted-foreground">
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: band.fill }}
                            aria-hidden="true"
                          />
                          <span className="truncate">{band.label}</span>
                        </span>
                        <span className="font-semibold text-foreground tabular-nums shrink-0">
                          {band.share_percent}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <ChartEmptyState
                  icon={<ShieldCheck className="w-6 h-6" />}
                  title="No NLI grounding scores in this window"
                  description="Verified NLI scores appear once assistant responses are evaluated against statutory provisions."
                  actionLabel={days !== "all" ? "View All Time" : scope === "me" ? "View All Users" : undefined}
                  onAction={days !== "all" || scope === "me" ? handleExpandWindow : undefined}
                />
              )}
            </ChartCard>
          </div>

          {/* BAND 2: Most Queried Articles (span 6) + Most Answered Articles (span 6) */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-stretch">
            <ChartCard
              className="xl:col-span-6"
              title="Most Queried Civil Code Articles"
              description="Explicit article references parsed from user queries. Click a bar to open the article."
              icon={<BookOpen strokeWidth={1.75} className="w-4 h-4 text-[var(--chart-1)]" />}
              ariaLabel={`Top ${data.most_queried_articles.length} explicitly queried Civil Code articles`}
              headerRight={
                <Badge variant="outline" className="text-[10px] font-mono px-2 py-0 h-5">
                  {data.summary.total_article_queries} mentions
                </Badge>
              }
            >
              {data.most_queried_articles.length > 0 && isClient ? (
                <div className="flex flex-col flex-1 justify-between gap-2.5">
                  <div className="w-full h-[255px] min-w-0">
                    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                      <BarChart
                        data={data.most_queried_articles}
                        layout="vertical"
                        margin={{ top: 4, right: 16, left: 6, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                        <XAxis
                          type="number"
                          allowDecimals={false}
                          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          type="category"
                          dataKey="label"
                          width={74}
                          tick={{ fontSize: 11, fill: "var(--foreground)" }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <Tooltip
                          cursor={{ fill: "var(--accent)", opacity: 0.45 }}
                          content={({ active, payload }) => {
                            if (!active || !payload || payload.length === 0) return null;
                            const art = payload[0]?.payload as QueriedArticleMetric | undefined;
                            if (!art) return null;
                            return (
                              <AnalyticsTooltipBox
                                title={art.full_label}
                                subtitle={art.short_book}
                                rows={[
                                  { label: "User Queries", value: art.count, color: "var(--chart-1)" },
                                  { label: "Share of Article Queries", value: `${art.share_percent}%` },
                                ]}
                                hint="Click bar to read statutory text"
                              />
                            );
                          }}
                        />
                        <Bar
                          dataKey="count"
                          fill="var(--chart-1)"
                          radius={[0, 6, 6, 0]}
                          maxBarSize={20}
                          className="cursor-pointer"
                          onClick={(_entry, index) => {
                            const art = data.most_queried_articles[index];
                            if (art) navigateToArticle(art.article_id);
                          }}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-border/60">
                    <span className="text-[10px] text-muted-foreground mr-0.5">Quick jump:</span>
                    {data.most_queried_articles.slice(0, 5).map((art) => (
                      <Link
                        key={art.article_id}
                        href={`/civil-code?article=${encodeURIComponent(art.article_id)}`}
                        className="text-[10px] font-medium px-2 py-0.5 rounded-md border border-border/70 bg-muted/40 text-foreground hover:border-primary/50 hover:text-primary transition-colors"
                      >
                        {art.label}
                      </Link>
                    ))}
                  </div>
                </div>
              ) : (
                <ChartEmptyState
                  icon={<BookOpen className="w-6 h-6" />}
                  title="No explicit article numbers queried in this window"
                  description="Try asking about a specific provision (e.g., Article 1156 or Article 36) or expand the timeframe."
                  actionLabel={days !== "all" ? "View All Time" : scope === "me" ? "View All Users" : undefined}
                  onAction={days !== "all" || scope === "me" ? handleExpandWindow : undefined}
                />
              )}
            </ChartCard>

            <ChartCard
              className="xl:col-span-6"
              title="Most Answered / Cited Articles"
              description={
                scope === "all"
                  ? "Top Civil Code articles grounded in AI responses (All Users vs. My Answers)."
                  : "Civil Code articles most frequently cited in your AI consultations."
              }
              icon={<Scale strokeWidth={1.75} className="w-4 h-4 text-[var(--chart-6)]" />}
              ariaLabel={`Top ${data.most_answered_articles.length} most cited articles in AI responses`}
              headerRight={
                scope === "all" && answeredArticlesHasPersonal ? (
                  <div className="flex items-center gap-2.5 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-[var(--chart-6)]" aria-hidden="true" />
                      <span>All</span>
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-[var(--chart-4)]" aria-hidden="true" />
                      <span>Mine</span>
                    </span>
                  </div>
                ) : (
                  <Badge variant="outline" className="text-[10px] font-mono px-2 py-0 h-5">
                    {data.summary.total_article_citations.toLocaleString()} citations
                  </Badge>
                )
              }
            >
              {data.most_answered_articles.length > 0 && isClient ? (
                <div className="flex flex-col flex-1 justify-between gap-2.5">
                  <div className="w-full h-[255px] min-w-0">
                    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                      <BarChart
                        data={data.most_answered_articles}
                        layout="vertical"
                        margin={{ top: 4, right: 16, left: 6, bottom: 0 }}
                        barGap={2}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                        <XAxis
                          type="number"
                          allowDecimals={false}
                          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          type="category"
                          dataKey="label"
                          width={74}
                          tick={{ fontSize: 11, fill: "var(--foreground)" }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <Tooltip
                          cursor={{ fill: "var(--accent)", opacity: 0.45 }}
                          content={({ active, payload }) => {
                            if (!active || !payload || payload.length === 0) return null;
                            const art = payload[0]?.payload as AnsweredArticleMetric | undefined;
                            if (!art) return null;
                            return (
                              <AnalyticsTooltipBox
                                title={art.full_label}
                                subtitle={art.short_book}
                                rows={[
                                  {
                                    label: "All Users Citations",
                                    value: art.global_count,
                                    color: "var(--chart-6)",
                                  },
                                  {
                                    label: "My Answers Citations",
                                    value: art.my_count,
                                    color: "var(--chart-4)",
                                  },
                                  {
                                    label: "Scope Share",
                                    value: `${art.share_percent}%`,
                                  },
                                ]}
                                hint="Click bar to read statutory text"
                              />
                            );
                          }}
                        />
                        <Bar
                          dataKey={scope === "all" ? "global_count" : "my_count"}
                          name={scope === "all" ? "All Users" : "My Answers"}
                          fill="var(--chart-6)"
                          radius={[0, 6, 6, 0]}
                          maxBarSize={scope === "all" && answeredArticlesHasPersonal ? 12 : 20}
                          className="cursor-pointer"
                          onClick={(_entry, index) => {
                            const art = data.most_answered_articles[index];
                            if (art) navigateToArticle(art.article_id);
                          }}
                        />
                        {scope === "all" && answeredArticlesHasPersonal && (
                          <Bar
                            dataKey="my_count"
                            name="My Answers"
                            fill="var(--chart-4)"
                            radius={[0, 6, 6, 0]}
                            maxBarSize={12}
                            className="cursor-pointer"
                            onClick={(_entry, index) => {
                              const art = data.most_answered_articles[index];
                              if (art) navigateToArticle(art.article_id);
                            }}
                          />
                        )}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-border/60">
                    <span className="text-[10px] text-muted-foreground mr-0.5">Quick jump:</span>
                    {data.most_answered_articles.slice(0, 5).map((art) => (
                      <Link
                        key={art.article_id}
                        href={`/civil-code?article=${encodeURIComponent(art.article_id)}`}
                        className="text-[10px] font-medium px-2 py-0.5 rounded-md border border-border/70 bg-muted/40 text-foreground hover:border-primary/50 hover:text-primary transition-colors"
                      >
                        {art.label}
                      </Link>
                    ))}
                  </div>
                </div>
              ) : (
                <ChartEmptyState
                  icon={<Scale className="w-6 h-6" />}
                  title="No cited statutory answers in this window"
                  description="Grounded Civil Code citations will populate once consultations are completed."
                  actionLabel={days !== "all" ? "View All Time" : scope === "me" ? "View All Users" : undefined}
                  onAction={days !== "all" || scope === "me" ? handleExpandWindow : undefined}
                />
              )}
            </ChartCard>
          </div>

          {/* BAND 3: Top Legal Topics Donut + Breakdown (span 6) | Language/Domain + Document Funnel (span 6) */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-stretch">
            <ChartCard
              className="xl:col-span-6"
              title="Top Legal Topics & Civil Code Books"
              description="Distribution of grounded inquiries across Philippine Civil Law & Family Code domains"
              icon={<PieChartIcon strokeWidth={1.75} className="w-4 h-4 text-[var(--chart-1)]" />}
              ariaLabel={`Legal topic breakdown totaling ${data.top_topics.total_hits} statutory hits`}
              headerRight={
                <Badge variant="outline" className="text-[10px] font-mono px-2 py-0 h-5">
                  {data.top_topics.total_hits.toLocaleString()} hits
                </Badge>
              }
            >
              {topicChartData.length > 0 && isClient ? (
                <div className="flex flex-col flex-1 justify-between gap-4">
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center flex-1 my-auto">
                    <div className="md:col-span-5 relative h-[245px] min-w-0">
                      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                        <PieChart>
                          <Pie
                            data={topicChartData}
                            dataKey="count"
                            nameKey="topic"
                            cx="50%"
                            cy="50%"
                            innerRadius={62}
                            outerRadius={94}
                            paddingAngle={2}
                            stroke="var(--card)"
                            strokeWidth={2}
                          />
                          <Tooltip
                            content={({ active, payload }) => {
                              if (!active || !payload || payload.length === 0) return null;
                              const item = payload[0]?.payload as (TopicMetric & { fill: string }) | undefined;
                              if (!item) return null;
                              return (
                                <AnalyticsTooltipBox
                                  title={item.topic}
                                  rows={[
                                    { label: "Grounded Citations", value: item.count, color: item.fill },
                                    { label: "Share", value: `${item.share_percent}%` },
                                    ...(item.top_article_label
                                      ? [{ label: "Leading Provision", value: item.top_article_label }]
                                      : []),
                                  ]}
                                />
                              );
                            }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                        <span className="text-xl font-bold text-foreground tabular-nums leading-none">
                          {data.top_topics.total_hits.toLocaleString()}
                        </span>
                        <span className="text-[10px] text-muted-foreground mt-1">
                          Total Hits
                        </span>
                      </div>
                    </div>

                    <div className="md:col-span-7 space-y-3 min-w-0">
                      {topicChartData.map((item) => (
                        <div key={item.topic} className="space-y-1">
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="flex items-center gap-2 min-w-0">
                              <span
                                className="w-2.5 h-2.5 rounded-xs shrink-0"
                                style={{ backgroundColor: item.fill }}
                                aria-hidden="true"
                              />
                              <span className="font-medium text-foreground truncate">
                                {item.topic}
                              </span>
                            </span>
                            <div className="flex items-center gap-2 shrink-0">
                              {item.top_article_id && item.top_article_label && (
                                <Link
                                  href={`/civil-code?article=${encodeURIComponent(item.top_article_id)}`}
                                  className="text-[10px] font-mono text-muted-foreground hover:text-primary transition-colors hidden sm:inline"
                                >
                                  {item.top_article_label}
                                </Link>
                              )}
                              <span className="text-[11px] font-semibold text-foreground tabular-nums">
                                {item.share_percent}%
                              </span>
                              <span className="text-[10px] text-muted-foreground tabular-nums w-9 text-right">
                                ({item.count})
                              </span>
                            </div>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-300"
                              style={{
                                width: `${Math.max(item.share_percent, 2)}%`,
                                backgroundColor: item.fill,
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground pt-2 border-t border-border/60">
                    <span>
                      Leading domain:{" "}
                      <strong className="text-foreground">
                        {topicChartData[0].topic} ({topicChartData[0].share_percent}%)
                      </strong>
                    </span>
                    <Link href="/civil-code" className="text-primary hover:underline font-medium">
                      Browse Civil Code
                    </Link>
                  </div>
                </div>
              ) : (
                <ChartEmptyState
                  icon={<PieChartIcon className="w-6 h-6" />}
                  title="No legal topic distribution yet"
                  description="Topic shares emerge automatically as Civil Code and Family Code provisions are grounded in responses."
                  actionLabel={days !== "all" ? "View All Time" : scope === "me" ? "View All Users" : undefined}
                  onAction={days !== "all" || scope === "me" ? handleExpandWindow : undefined}
                />
              )}
            </ChartCard>

            <div className="xl:col-span-6 flex flex-col gap-4 min-w-0">
              {/* Chart 6: Language & Domain Intent Mix */}
              <ChartCard
                className="flex-1"
                title="Language & Domain Intent Mix"
                description="Bilingual English/Tagalog usage & domain boundary routing breakdown"
                icon={<Languages strokeWidth={1.75} className="w-4 h-4 text-[var(--chart-4)]" />}
                ariaLabel={`Language mix and domain intent routing across ${data.language_mix.total} queries`}
              >
                {data.language_mix.total > 0 || data.domain_intent_mix.total > 0 ? (
                  <div className="space-y-4">
                    {/* Stacked Bar 1: Query Language */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-semibold text-foreground">Query Language</span>
                        <span className="text-muted-foreground tabular-nums">
                          {data.language_mix.total} queries
                        </span>
                      </div>
                      {languageStackedData.length > 0 && isClient ? (
                        <div className="w-full h-[26px] min-w-0">
                          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                            <BarChart
                              data={languageStackedData}
                              layout="vertical"
                              margin={{ top: 0, right: 0, left: 0, bottom: 0 }}
                            >
                              <XAxis type="number" hide domain={[0, data.language_mix.total]} />
                              <YAxis type="category" dataKey="name" hide />
                              <Tooltip
                                cursor={false}
                                content={({ active }) => {
                                  if (!active) return null;
                                  return (
                                    <AnalyticsTooltipBox
                                      title="Query Language Split"
                                      rows={data.language_mix.segments.map((seg, i) => ({
                                        label: seg.label,
                                        value: `${seg.count} (${seg.share_percent}%)`,
                                        color: i === 0 ? "var(--chart-1)" : "var(--chart-3)",
                                      }))}
                                    />
                                  );
                                }}
                              />
                              <Bar
                                dataKey="english"
                                stackId="lang"
                                fill="var(--chart-1)"
                                radius={[6, 0, 0, 6]}
                                barSize={18}
                              />
                              <Bar
                                dataKey="tagalog"
                                stackId="lang"
                                fill="var(--chart-3)"
                                radius={[0, 6, 6, 0]}
                                barSize={18}
                              />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      ) : (
                        <p className="text-[11px] text-muted-foreground">No language records in range.</p>
                      )}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
                        {data.language_mix.segments.map((seg, idx) => (
                          <span key={seg.key} className="inline-flex items-center gap-1.5 text-muted-foreground">
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: idx === 0 ? "var(--chart-1)" : "var(--chart-3)" }}
                              aria-hidden="true"
                            />
                            <span>{seg.label}:</span>
                            <span className="font-semibold text-foreground tabular-nums">
                              {seg.share_percent}% ({seg.count})
                            </span>
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Stacked Bar 2: Domain Routing Intent */}
                    <div className="space-y-1.5 pt-2 border-t border-border/60">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-semibold text-foreground">Domain Routing Intent</span>
                        <span className="text-muted-foreground tabular-nums">
                          {data.domain_intent_mix.total} routed
                        </span>
                      </div>
                      {domainStackedData.length > 0 && isClient ? (
                        <div className="w-full h-[26px] min-w-0">
                          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                            <BarChart
                              data={domainStackedData}
                              layout="vertical"
                              margin={{ top: 0, right: 0, left: 0, bottom: 0 }}
                            >
                              <XAxis type="number" hide domain={[0, data.domain_intent_mix.total]} />
                              <YAxis type="category" dataKey="name" hide />
                              <Tooltip
                                cursor={false}
                                content={({ active }) => {
                                  if (!active) return null;
                                  const colors = ["var(--chart-2)", "var(--chart-3)", "var(--chart-5)"];
                                  return (
                                    <AnalyticsTooltipBox
                                      title="Domain Routing Classification"
                                      rows={data.domain_intent_mix.segments.map((seg, i) => ({
                                        label: seg.label,
                                        value: `${seg.count} (${seg.share_percent}%)`,
                                        color: colors[i],
                                      }))}
                                    />
                                  );
                                }}
                              />
                              <Bar
                                dataKey="civil"
                                stackId="intent"
                                fill="var(--chart-2)"
                                radius={[6, 0, 0, 6]}
                                barSize={18}
                              />
                              <Bar dataKey="nonCivil" stackId="intent" fill="var(--chart-3)" barSize={18} />
                              <Bar
                                dataKey="nonLegal"
                                stackId="intent"
                                fill="var(--chart-5)"
                                radius={[0, 6, 6, 0]}
                                barSize={18}
                              />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      ) : (
                        <p className="text-[11px] text-muted-foreground">No domain routing records in range.</p>
                      )}
                      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11px]">
                        {data.domain_intent_mix.segments.map((seg, idx) => {
                          const colors = ["var(--chart-2)", "var(--chart-3)", "var(--chart-5)"];
                          return (
                            <span key={seg.key} className="inline-flex items-center gap-1.5 text-muted-foreground">
                              <span
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ backgroundColor: colors[idx] }}
                                aria-hidden="true"
                              />
                              <span>{seg.label}:</span>
                              <span className="font-semibold text-foreground tabular-nums">
                                {seg.share_percent}% ({seg.count})
                              </span>
                            </span>
                          );
                        })}
                      </div>
                      {data.domain_intent_mix.redirect_breakdown.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          <span className="text-[10px] text-muted-foreground">Non-Civil Redirects:</span>
                          {data.domain_intent_mix.redirect_breakdown.map((item) => (
                            <Badge
                              key={item.domain}
                              variant="secondary"
                              className="text-[10px] font-normal px-1.5 py-0 h-4.5"
                            >
                              {item.domain} ({item.count})
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <ChartEmptyState
                    compact
                    icon={<Languages className="w-5 h-5" />}
                    title="No language or routing telemetry yet"
                    description="Submit queries in English or Tagalog to view language and domain intent splits."
                    actionLabel={days !== "all" ? "View All Time" : undefined}
                    onAction={days !== "all" ? handleExpandWindow : undefined}
                  />
                )}
              </ChartCard>

              {/* Chart 7: Document Analysis Validation Funnel */}
              <ChartCard
                className="flex-1"
                title="Document Analysis Validation Funnel"
                description="Civil Law uploads accepted vs. rejected out-of-domain vs. Document Builder drafts"
                icon={<FileCheck2 strokeWidth={1.75} className="w-4 h-4 text-[var(--chart-2)]" />}
                ariaLabel={`Document validation funnel across ${data.document_funnel.total_documents} documents`}
                headerRight={
                  data.document_funnel.acceptance_rate !== null ? (
                    <Badge variant="outline" className="text-[10px] font-mono px-2 py-0 h-5">
                      {data.document_funnel.acceptance_rate}% upload pass
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] font-mono px-2 py-0 h-5">
                      {data.document_funnel.total_documents} docs
                    </Badge>
                  )
                }
              >
                {data.document_funnel.total_documents > 0 && isClient ? (
                  <div className="space-y-2">
                    <div className="w-full h-[132px] min-w-0">
                      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                        <BarChart
                          data={docFunnelChartData}
                          layout="vertical"
                          margin={{ top: 2, right: 16, left: 4, bottom: 2 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                          <XAxis
                            type="number"
                            allowDecimals={false}
                            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <YAxis
                            type="category"
                            dataKey="label"
                            width={150}
                            tick={{ fontSize: 11, fill: "var(--foreground)" }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <Tooltip
                            cursor={{ fill: "var(--accent)", opacity: 0.4 }}
                            content={({ active, payload }) => {
                              if (!active || !payload || payload.length === 0) return null;
                              const stage = payload[0]?.payload as (DocumentStageMetric & { fill: string }) | undefined;
                              if (!stage) return null;
                              return (
                                <AnalyticsTooltipBox
                                  title={stage.label}
                                  rows={[
                                    { label: "Documents", value: stage.count, color: stage.fill },
                                    { label: "Share of Total", value: `${stage.share_percent}%` },
                                  ]}
                                />
                              );
                            }}
                          />
                          <Bar dataKey="count" radius={[0, 6, 6, 0]} maxBarSize={22} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground pt-1 border-t border-border/60">
                      <span>
                        Total documents tracked:{" "}
                        <strong className="text-foreground tabular-nums">
                          {data.document_funnel.total_documents}
                        </strong>
                      </span>
                      <div className="flex items-center gap-3">
                        <Link href="/chat?upload=1" className="text-primary hover:underline font-medium">
                          Upload Document
                        </Link>
                        <Link href="/document-builder" className="text-primary hover:underline font-medium">
                          Open Builder
                        </Link>
                      </div>
                    </div>
                  </div>
                ) : (
                  <ChartEmptyState
                    compact
                    icon={<FileCheck2 className="w-5 h-5" />}
                    title="No documents recorded in this window"
                    description="Upload a contract in Legal Chat or draft one in Document Builder to track validation metrics."
                    actionLabel={days !== "all" ? "View All Time" : undefined}
                    onAction={days !== "all" ? handleExpandWindow : undefined}
                  />
                )}
              </ChartCard>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
