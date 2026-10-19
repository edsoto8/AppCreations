import { useId, useMemo, useState } from 'react';
import { BadgeCheck, Clock, ExternalLink, ShieldAlert } from 'lucide-react';
import { RULES, type RuleSource, type RulesSet } from '@rn/engine';
import { PageHeader } from '@/components/PageHeader';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import {
  STATUS_LABELS,
  collectRuleSections,
  countStatuses,
  formatIsoDate,
  formatRuleValue,
  indexationLabel,
  mostCommonReason,
  type RuleEntry,
  type RuleStatus,
} from './rulesCatalog';

type StatusFilter = 'all' | RuleStatus;

const STATUS_FILTERS: readonly { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'verified', label: STATUS_LABELS.verified },
  { value: 'unverified', label: STATUS_LABELS.unverified },
  { value: 'notPublished', label: STATUS_LABELS.notPublished },
];

function isStatusFilter(value: string): value is StatusFilter {
  return STATUS_FILTERS.some((f) => f.value === value);
}

const BUNDLED_SECTIONS = collectRuleSections(RULES);

/** `rules` defaults to the bundled rules set; tests may pass another. */
export function RulesPage({ rules }: { rules?: RulesSet } = {}) {
  const sections = useMemo(() => (rules ? collectRuleSections(rules) : BUNDLED_SECTIONS), [rules]);
  const allEntries = useMemo(() => sections.flatMap((s) => s.entries), [sections]);
  const [status, setStatus] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');
  const statusId = useId();
  const searchId = useId();

  const visibleSections = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return sections
      .map((section) => ({
        ...section,
        entries: section.entries.filter(
          (e) =>
            (status === 'all' || e.rule.status === status) &&
            (needle === '' || e.label.toLowerCase().includes(needle) || e.path.toLowerCase().includes(needle)),
        ),
      }))
      .filter((section) => section.entries.length > 0);
  }, [sections, status, query]);
  const shown = visibleSections.reduce((n, s) => n + s.entries.length, 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Rules & Sources"
        description="Every regulatory value bundled with this version of the app: its status, value, official source, retrieval date and whether it is indexed for inflation."
      />

      <Summary entries={allEntries} />

      <Card aria-labelledby="rules-filter-title">
        <CardHeader>
          <CardTitle id="rules-filter-title">Filter rules</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
            <div className="flex flex-col gap-2">
              <Label htmlFor={statusId}>Status</Label>
              <NativeSelect
                id={statusId}
                value={status}
                onChange={(e) => {
                  if (isStatusFilter(e.target.value)) setStatus(e.target.value);
                }}
              >
                {STATUS_FILTERS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={searchId}>Search by name</Label>
              <Input
                id={searchId}
                type="search"
                value={query}
                placeholder="e.g. deferral, HSA, bend points"
                autoComplete="off"
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            Showing {shown} of {allEntries.length} rules
          </p>
        </CardContent>
      </Card>

      {visibleSections.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
          No rules match these filters.
        </p>
      ) : (
        visibleSections.map((section) => (
          <RuleSectionCard key={section.key} sectionKey={section.key} title={section.title} entries={section.entries} />
        ))
      )}
    </div>
  );
}

function Summary({ entries }: { entries: readonly RuleEntry[] }) {
  const counts = countStatuses(entries);
  const unverifiedReason = mostCommonReason(entries, 'unverified');
  const pendingReason = mostCommonReason(entries, 'notPublished');
  const stats: { label: string; value: number; className?: string }[] = [
    { label: 'Total', value: counts.total },
    {
      label: STATUS_LABELS.verified,
      value: counts.verified,
      className: counts.verified > 0 ? 'text-positive' : undefined,
    },
    {
      label: STATUS_LABELS.unverified,
      value: counts.unverified,
      className: counts.unverified > 0 ? 'text-attention' : undefined,
    },
    { label: STATUS_LABELS.notPublished, value: counts.notPublished },
  ];

  return (
    <Card aria-labelledby="rules-summary-title">
      <CardHeader>
        <CardTitle id="rules-summary-title">Summary</CardTitle>
        <CardDescription>
          A value is used in calculations only once it has been verified in the official document.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="flex flex-col-reverse gap-1 rounded-md border p-3">
              <dt className="text-sm text-muted-foreground">{s.label}</dt>
              <dd className={`text-2xl font-semibold tabular-nums ${s.className ?? ''}`}>{s.value}</dd>
            </div>
          ))}
        </dl>
        <Alert variant="attention">
          <ShieldAlert aria-hidden="true" />
          <div className="flex min-w-0 flex-col gap-2">
            <p className="font-medium">The app never fills in an unverified value</p>
            <p className="text-muted-foreground">
              There are no defaults and no values from memory. Any feature that needs an unverified or unpublished value
              is disabled and labeled “Unverified rule” instead of showing a number. Candidate values below were seen
              only in a web-search excerpt of an official page; they are shown for transparency and are never used in
              calculations.
            </p>
            {unverifiedReason ? (
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">
                  Why values are unverified ({unverifiedReason.count} of {unverifiedReason.of} unverified rules):
                </span>{' '}
                {unverifiedReason.reason}
              </p>
            ) : null}
            {pendingReason ? (
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">
                  Not yet published ({pendingReason.count} of {pendingReason.of} rules):
                </span>{' '}
                {pendingReason.reason}
              </p>
            ) : null}
          </div>
        </Alert>
      </CardContent>
    </Card>
  );
}

function RuleSectionCard({ sectionKey, title, entries }: { sectionKey: string; title: string; entries: RuleEntry[] }) {
  const titleId = `rules-section-${sectionKey}`;
  const counts = countStatuses(entries);
  const categories: { name: string; entries: RuleEntry[] }[] = [];
  for (const entry of entries) {
    const existing = categories.find((c) => c.name === entry.category);
    if (existing) existing.entries.push(entry);
    else categories.push({ name: entry.category, entries: [entry] });
  }

  return (
    <Card aria-labelledby={titleId}>
      <CardHeader>
        <CardTitle id={titleId}>{title}</CardTitle>
        <CardDescription>
          {counts.total} {counts.total === 1 ? 'rule' : 'rules'}: {counts.verified} verified, {counts.unverified}{' '}
          unverified, {counts.notPublished} not yet published
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {categories.map((category) => (
          <div key={category.name} className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-muted-foreground">{category.name}</h3>
            <ul className="flex flex-col gap-3">
              {category.entries.map((entry) => (
                <li key={entry.key}>
                  <RuleItem entry={entry} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: RuleStatus }) {
  if (status === 'verified')
    return (
      <Badge variant="outline" className="border-positive/40 text-positive">
        <BadgeCheck aria-hidden="true" className="size-3" />
        {STATUS_LABELS.verified}
      </Badge>
    );
  if (status === 'unverified')
    return (
      <Badge variant="attention">
        <ShieldAlert aria-hidden="true" className="size-3" />
        {STATUS_LABELS.unverified}
      </Badge>
    );
  return (
    <Badge variant="secondary">
      <Clock aria-hidden="true" className="size-3" />
      {STATUS_LABELS.notPublished}
    </Badge>
  );
}

function SourceLink({ source }: { source: RuleSource }) {
  return (
    <span className="break-words">
      <a
        href={source.url}
        target="_blank"
        rel="noreferrer"
        className="font-medium text-foreground underline underline-offset-4"
      >
        {source.publication}
        <ExternalLink aria-hidden="true" className="ml-1 inline size-3 align-baseline" />
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
      {source.locator ? <span className="text-muted-foreground">, {source.locator}</span> : null}
    </span>
  );
}

function Field({ term, children, className }: { term: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex min-w-0 flex-col gap-0.5 ${className ?? ''}`}>
      <dt className="text-xs font-medium text-muted-foreground">{term}</dt>
      <dd className="min-w-0 break-words text-sm">{children}</dd>
    </div>
  );
}

function RuleItem({ entry }: { entry: RuleEntry }) {
  const { rule } = entry;
  const titleId = `rule-${entry.key.replace(/[^A-Za-z0-9_-]/g, '-')}`;

  return (
    <article aria-labelledby={titleId} className="flex flex-col gap-3 rounded-md border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h4 id={titleId} className="font-medium leading-snug">
            {entry.label}
          </h4>
          <p className="break-all font-mono text-xs text-muted-foreground">{entry.key}</p>
        </div>
        <StatusBadge status={rule.status} />
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <Field term="Value" className="col-span-2 sm:col-span-1">
          <span className="tabular-nums">
            {rule.status === 'verified' ? formatRuleValue(rule.value, entry.path) : '—'}
          </span>
        </Field>
        <Field term="Source" className="col-span-2 sm:col-span-1">
          {rule.status === 'verified' ? <SourceLink source={rule.source} /> : '—'}
        </Field>
        <Field term="Retrieved">
          {rule.status === 'verified' ? (
            <time dateTime={rule.source.retrievedOn}>{formatIsoDate(rule.source.retrievedOn)}</time>
          ) : (
            '—'
          )}
        </Field>
        <Field term="Indexation">{indexationLabel(rule.indexation)}</Field>
      </dl>

      {rule.status === 'verified' ? (
        <VerifiedDetails rule={rule} />
      ) : (
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">
            {rule.status === 'unverified' ? 'Why unverified:' : 'Why not available:'}
          </span>{' '}
          {rule.unverifiedReason}
        </p>
      )}

      {rule.status === 'unverified' && rule.candidate ? (
        <div className="flex flex-col gap-1 rounded-md border border-dashed bg-muted/40 p-3 text-sm text-muted-foreground">
          <p className="text-xs font-medium uppercase tracking-wide">
            Candidate (not verified, not used in calculations)
          </p>
          <p className="break-words tabular-nums">{formatRuleValue(rule.candidate.value, entry.path)}</p>
          <p className="break-words text-xs">
            Seen in a {rule.candidate.source.method === 'search-excerpt' ? 'web-search excerpt' : 'reading'} of{' '}
            <SourceLink source={rule.candidate.source} />, retrieved{' '}
            <time dateTime={rule.candidate.source.retrievedOn}>{formatIsoDate(rule.candidate.source.retrievedOn)}</time>
          </p>
        </div>
      ) : null}
    </article>
  );
}

function VerifiedDetails({ rule }: { rule: Extract<RuleEntry['rule'], { status: 'verified' }> }) {
  const details: { term: string; content: React.ReactNode }[] = [];
  if (rule.secondSource) details.push({ term: 'Second source', content: <SourceLink source={rule.secondSource} /> });
  if (rule.rounding)
    details.push({
      term: 'Rounding',
      content: `Rounded ${rule.rounding.mode === 'nearest' ? 'to the nearest' : `${rule.rounding.mode} to a`} multiple of $${rule.rounding.incrementDollars.toLocaleString('en-US')}`,
    });
  if (rule.sunsetYear !== null)
    details.push({ term: 'Sunset', content: `Applies through tax year ${rule.sunsetYear} under current law` });
  if (rule.notes) details.push({ term: 'Notes', content: rule.notes });
  if (details.length === 0) return null;
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {details.map((d) => (
        <Field key={d.term} term={d.term}>
          {d.content}
        </Field>
      ))}
    </dl>
  );
}
