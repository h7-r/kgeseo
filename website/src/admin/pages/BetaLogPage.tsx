import { useMemo, useState, type ReactNode } from "react";

import { fetchAllBetaEvents } from "../api/betaEvents";
import { useAdminResource } from "../api/useAdminResource";
import { fetchUsersUpTo, type AdminUserSummary } from "../api/users";
import ResourceView from "../auth/ResourceView";
import {
  buildBetaReport,
  eventsCsv,
  frac,
  mmss,
  objectivesCsv,
  peopleCsv,
  pct,
  quantile,
  sec,
  summaryMarkdown,
  type BetaEventRow,
  type BetaReport,
  type ObjectiveRow,
} from "../lib/betaReport";
import { formatDateTime, formatNumber } from "../lib/format";
import BarChart from "../ui/BarChart";
import DataTable, { type Column } from "../ui/DataTable";
import Panel from "../ui/Panel";
import StatCard from "../ui/StatCard";

/**
 * 베타 기록(11/12 미르) — 서버에 쌓인 베타 분석 기록(beta_events)을 받아 이 브라우저에서 집계한다.
 * 계산은 tools/beta/beta-report.mjs 와 같은 lib/betaReport.ts. 내려받기는 그 도구가 만드는 파일과 같다.
 * 서버 · 게임은 바꾸지 않는다. 받을 때마다 서버 관리자 기록(admin_audit_logs)에 남는다.
 */

interface Loaded {
  rows: BetaEventRow[];
  users: AdminUserSummary[];
  loadedAt: number;
}

const SHORT_STEPS = ["첫 실행", "캐릭터 시작", "캐릭터 완료", "본부실", "나주", "P01 해결", "엔딩"];
const SURVEY_NAMES: Record<string, string> = { pre: "시작 전", post: "끝난 뒤", exit: "중단" };

// 거름 기억 — 「관리자 빼기」는 이 브라우저(localStorage)에, 이메일이 들어가는 「뺄 계정」은 이 탭(sessionStorage)에만 둔다.
// 탭을 닫으면 이메일은 지워진다(Codex 리뷰). 저장소가 막혀도 화면은 그대로 돈다
const ADMINS_KEY = "admin.betaLog.excludeAdmins";
const TEXT_KEY = "admin.betaLog.excludeText";
function readFilter(): { excludeAdmins: boolean; excludeText: string } {
  let excludeAdmins = true;
  let excludeText = "";
  try {
    excludeAdmins = localStorage.getItem(ADMINS_KEY) !== "0";
  } catch {
    // 기본값
  }
  try {
    excludeText = sessionStorage.getItem(TEXT_KEY) ?? "";
  } catch {
    // 기본값
  }
  return { excludeAdmins, excludeText };
}
function saveFilter(value: { excludeAdmins: boolean; excludeText: string }) {
  try {
    localStorage.setItem(ADMINS_KEY, value.excludeAdmins ? "1" : "0");
  } catch {
    // 기억만 못 할 뿐 집계는 그대로
  }
  try {
    if (value.excludeText) sessionStorage.setItem(TEXT_KEY, value.excludeText);
    else sessionStorage.removeItem(TEXT_KEY);
  } catch {
    // 기억만 못 할 뿐 집계는 그대로
  }
}

export default function BetaLogPage() {
  const [attempt, setAttempt] = useState(0);
  const [resource, retry] = useAdminResource<Loaded>(`beta-log:${attempt}`, async (signal) => {
    const [rows, users] = await Promise.all([
      fetchAllBetaEvents(signal),
      fetchUsersUpTo(Number.MAX_SAFE_INTEGER, undefined, signal).then((loaded) => loaded.users),
    ]);
    return { rows, users, loadedAt: Date.now() };
  });

  return (
    <ResourceView resource={resource} retry={retry} loadingText="베타 기록을 불러오고 있습니다">
      {(loaded) => <BetaLogView loaded={loaded} onReload={() => setAttempt((value) => value + 1)} />}
    </ResourceView>
  );
}

function BetaLogView({ loaded, onReload }: { loaded: Loaded; onReload: () => void }) {
  const [filter, setFilter] = useState(readFilter);
  const updateFilter = (next: Partial<typeof filter>) => {
    const value = { ...filter, ...next };
    setFilter(value);
    saveFilter(value);
  };

  const { exclude, unknown } = useMemo(() => {
    const ids = new Set<string>();
    if (filter.excludeAdmins) for (const user of loaded.users) if (user.role === "admin") ids.add(user.user_id);
    const byEmail = new Map(loaded.users.map((user) => [user.email.toLowerCase(), user.user_id]));
    const misses: string[] = [];
    for (const raw of filter.excludeText.split(/[\s,]+/)) {
      const item = raw.trim();
      if (!item) continue;
      const id = item.includes("@") ? byEmail.get(item.toLowerCase()) : item;
      if (id) ids.add(id);
      else misses.push(item);
    }
    return { exclude: ids, unknown: misses };
  }, [loaded.users, filter]);

  const report = useMemo(
    () => buildBetaReport(loaded.rows, { now: loaded.loadedAt, exclude }),
    [loaded.rows, loaded.loadedAt, exclude],
  );

  return (
    <>
      <section className="adm-panel adm-beta-tools" aria-label="불러오기 · 거르기">
        <div className="adm-beta-tools__row">
          <button type="button" className="adm-button adm-button--primary" onClick={onReload}>
            새로 불러오기
          </button>
          <span className="adm-muted">
            {formatDateTime(loaded.loadedAt)} 기준 · 기록 {formatNumber(loaded.rows.length)}건 중{" "}
            {formatNumber(report.events.length)}건 집계
          </span>
        </div>
        <label className="adm-beta-tools__check">
          <input
            type="checkbox"
            checked={filter.excludeAdmins}
            onChange={(event) => updateFilter({ excludeAdmins: event.target.checked })}
          />
          관리자 계정 기록 빼기
        </label>
        <label className="adm-field">
          <span className="adm-field__label">
            뺄 계정 — 시험 계정의 이메일이나 계정 id 를 띄어 쓰거나 줄을 바꿔 적습니다(이 탭을 닫으면 지워집니다)
          </span>
          <textarea
            className="adm-input adm-beta-tools__text"
            rows={2}
            value={filter.excludeText}
            placeholder="test001@example.com"
            onChange={(event) => updateFilter({ excludeText: event.target.value })}
          />
        </label>
        {unknown.length > 0 && (
          <p className="adm-field__error" role="status">
            회원 목록에 없는 이메일: {unknown.join(", ")}
          </p>
        )}
        <p className="adm-muted adm-beta-tools__note">
          불러올 때마다 서버 관리자 기록에 남습니다. 기록에는 이메일 · 닉네임이 없고 계정 id 로만 묶습니다. 10명이 안
          되는 숫자는 비율 대신 사람 수만 보입니다.
        </p>
      </section>

      {report.events.length === 0 ? (
        <Panel title="아직 기록이 없습니다">
          <p className="adm-muted">참가자가 게임을 열면 여기에 쌓입니다. 새로 불러오기를 눌러 다시 확인해 주세요.</p>
        </Panel>
      ) : (
        <ReportView report={report} loadedAt={loaded.loadedAt} />
      )}
    </>
  );
}

function ReportView({ report, loadedAt }: { report: BetaReport; loadedAt: number }) {
  const errorPeople = new Set(report.events.filter((e) => e.event_type === "client_error").map((e) => e.who)).size;
  const naju = report.funnel.find((step) => step.name === "나주 조작 가능")?.people ?? 0;
  const { starters, finished, observing } = report.firstRun;
  const denominator = starters - observing;

  return (
    <>
      <div className="adm-grid adm-grid--four">
        <StatCard
          label="참가자"
          value={formatNumber(report.people)}
          unit="명"
          caption={`계정 ${report.accountPeople} · 코드만 ${report.codeOnlyPeople}`}
        />
        <StatCard
          label="나주 들어감"
          value={formatNumber(naju)}
          unit="명"
          caption={`첫 실행 ${report.funnel[0]?.people ?? 0}명 중 · ${pct(naju, report.funnel[0]?.people ?? 0)}`}
        />
        <StatCard
          label="첫 판 완주(24시간)"
          value={formatNumber(finished)}
          unit="명"
          caption={`${denominator}명 중 · ${pct(finished, denominator)}${observing ? ` · 관찰 중 ${observing}명` : ""}`}
        />
        <StatCard
          label="오류 겪은 사람"
          value={formatNumber(errorPeople)}
          unit="명"
          caption="분류별은 아래 「오류」"
          isAlert={errorPeople > 0}
        />
      </div>

      <div className="adm-grid adm-grid--two">
        <Panel title="진입 단계" meta="단계에 닿은 사람">
          <BarChart
            label="진입 단계별 사람 수"
            bars={report.funnel.map((step, i) => ({ label: SHORT_STEPS[i] ?? step.name, value: step.people }))}
            unit="명"
            xAxisLabel="단계"
          />
        </Panel>
        <Panel title="단계별 이어짐" meta="이미 캐릭터를 만든 사람은 앞 단계를 건너뛰어 100%를 넘을 수 있음">
          <DataTable
            caption="진입 단계별 사람 수와 앞 단계 대비"
            minWidth={0}
            rows={report.funnel.map((step, i) => ({ ...step, i }))}
            rowKey={(row) => row.name}
            emptyText="기록이 없습니다."
            columns={[
              { key: "name", header: "단계", render: (row) => row.name },
              { key: "people", header: "사람", align: "end", mono: true, render: (row) => formatNumber(row.people) },
              {
                key: "fromFirst",
                header: "첫 실행 대비",
                align: "end",
                render: (row) => (row.i === 0 ? "—" : pct(row.people, report.funnel[0].people)),
              },
              {
                key: "rate",
                header: "앞 단계 대비",
                align: "end",
                render: (row) => (row.i === 0 ? "—" : pct(row.people, report.funnel[row.i - 1].people)),
              },
            ]}
          />
        </Panel>
      </div>

      <Panel title="퍼즐 · 목표별" meta="첫 판 · 실시간 기록">
        <DataTable
          caption="퍼즐 · 목표별 도달 · 완료 · 시간 · 실패 · 도움"
          rows={report.objectives}
          rowKey={(row) => row.id}
          emptyText="아직 퍼즐에 닿은 사람이 없습니다."
          columns={OBJECTIVE_COLUMNS}
        />
      </Panel>

      <div className="adm-grid adm-grid--two">
        <Panel title="그만둔 지점" meta="24시간 안에 못 끝낸 첫 판의 마지막 목표">
          <DataTable
            caption="그만둔 지점"
            minWidth={0}
            rows={report.lastSpots}
            rowKey={(row) => row.spot}
            emptyText="그만둔 사람이 없거나 아직 하루가 지나지 않았습니다."
            columns={[
              { key: "spot", header: "마지막 목표", render: (row) => row.spot },
              { key: "people", header: "그만둔 사람", align: "end", mono: true, render: (row) => row.people },
              {
                key: "reached",
                header: "그 목표에 닿은 사람",
                align: "end",
                mono: true,
                render: (row) => row.reached ?? "—",
              },
            ]}
          />
        </Panel>
        <Panel title="한 판 · 로딩 · 동행">
          <dl className="adm-fields">
            <Field label="한 판 조사 시간">
              가운데 {mmss(quantile(report.playTimes, 0.5))} · 75% {mmss(quantile(report.playTimes, 0.75))} (완주{" "}
              {report.playTimes.length}명)
            </Field>
            <Field label="별(완주자)">
              ★★★ {report.stars.three} · ★★ {report.stars.two} · ★ {report.stars.one}
            </Field>
            <Field label="나주 로딩">
              가운데 {sec(quantile(report.najuLoad.readyMs, 0.5))} · 75% {sec(quantile(report.najuLoad.readyMs, 0.75))}{" "}
              ({report.najuLoad.readyMs.length}건) · 시간 초과 {report.najuLoad.timeouts}건
            </Field>
            <Field label="오프닝 영상">
              {frac(report.videos.opening.skipped, report.videos.opening.people)}이 SKIP · 누른 때 가운데{" "}
              {sec(quantile(report.videos.opening.skipAtMs, 0.5))} (길이 {sec(quantile(report.videos.opening.lengthMs, 0.5))})
            </Field>
            <Field label="엔딩 필름">
              {frac(report.videos.endingFilm.skipped, report.videos.endingFilm.people)}이 건너뜀 · 가운데{" "}
              {quantile(report.videos.endingFilm.skipShot, 0.5) ?? "—"}번째 장 / {quantile(report.videos.endingFilm.shots, 0.5) ?? "—"}장
            </Field>
            <Field label="설화 근거 줄">{frac(report.story.heardAll, report.story.najuPeople)}이 세 줄을 모두 봄</Field>
            <Field label="동행 응답">
              {report.companion.responses}건(대답 {report.companion.withReply} · 할 말 없음 {report.companion.noReply} ·
              대체 문구 {report.companion.fallback}) · 실패 {report.companion.errors}건
            </Field>
            <Field label="동행 직접 요청 왕복">
              가운데 {sec(quantile(report.companion.directRtt, 0.5))} · 95%{" "}
              {sec(quantile(report.companion.directRtt, 0.95))} ({report.companion.directRtt.length}건)
            </Field>
          </dl>
        </Panel>
      </div>

      <div className="adm-grid adm-grid--three">
        <Panel title="오류" meta="겪은 사람">
          <DataTable
            caption="오류 분류별 사람 수"
            minWidth={0}
            rows={report.errors}
            rowKey={(row) => row.category}
            emptyText="오류 기록이 없습니다."
            columns={[
              { key: "category", header: "분류", render: (row) => row.category },
              { key: "people", header: "사람", align: "end", mono: true, render: (row) => row.people },
            ]}
          />
        </Panel>
        <Panel title="환경" meta="처음 연 기기">
          <DataTable
            caption="운영체제 · 브라우저별 사람 수"
            minWidth={0}
            rows={report.environments}
            rowKey={(row) => row.name}
            emptyText="기록이 없습니다."
            columns={[
              { key: "name", header: "운영체제 · 브라우저", render: (row) => row.name },
              { key: "people", header: "사람", align: "end", mono: true, render: (row) => row.people },
            ]}
          />
        </Panel>
        <Panel title="설문" meta="제출은 폼 응답과 맞춤">
          <DataTable
            caption="설문 안내 · 열기 · 이미 함"
            minWidth={0}
            rows={report.surveys}
            rowKey={(row) => row.kind}
            emptyText="기록이 없습니다."
            columns={[
              { key: "kind", header: "시점", render: (row) => SURVEY_NAMES[row.kind] ?? row.kind },
              { key: "shown", header: "안내", align: "end", mono: true, render: (row) => row.shown },
              { key: "opened", header: "엶", align: "end", mono: true, render: (row) => row.opened },
              { key: "done", header: "이미 함", align: "end", mono: true, render: (row) => row.dismissedDone },
            ]}
          />
        </Panel>
      </div>

      <Downloads report={report} loadedAt={loadedAt} />
    </>
  );
}

const OBJECTIVE_COLUMNS: readonly Column<ObjectiveRow>[] = [
  { key: "id", header: "목표", render: (row) => row.id },
  { key: "reached", header: "도달", align: "end", mono: true, render: (row) => row.reached },
  { key: "done", header: "완료", align: "end", mono: true, render: (row) => row.done },
  { key: "pass", header: "통과율", align: "end", render: (row) => row.pass },
  { key: "median", header: "걸린 시간(가운데)", align: "end", render: (row) => row.median },
  { key: "p75", header: "느린 쪽(75%)", align: "end", render: (row) => row.p75 },
  { key: "fail3", header: "3번+ 실패", align: "end", mono: true, render: (row) => row.fail3 },
  { key: "serverWrong", header: "서버 오답/판정", align: "end", mono: true, render: (row) => row.serverWrong },
  { key: "help", header: "도움 요청", align: "end", mono: true, render: (row) => row.help },
];

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="adm-field-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** 한국 시간 20261113-0930 */
const stamp = (time: number) =>
  new Date(time + 9 * 3600 * 1000).toISOString().slice(0, 16).replaceAll("-", "").replace("T", "-").replace(":", "");

function save(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Downloads({ report, loadedAt }: { report: BetaReport; loadedAt: number }) {
  const at = stamp(loadedAt);
  const csv = "text/csv;charset=utf-8";
  const files = [
    {
      label: "요약 문서",
      name: `베타기록_요약_${at}.md`,
      make: () => summaryMarkdown(report),
      type: "text/markdown;charset=utf-8",
    },
    { label: "사람별(엑셀)", name: `베타기록_사람별_${at}.csv`, make: () => peopleCsv(report), type: csv },
    { label: "퍼즐별(엑셀)", name: `베타기록_퍼즐별_${at}.csv`, make: () => objectivesCsv(report), type: csv },
    { label: "전체 기록(엑셀)", name: `베타기록_전체_${at}.csv`, make: () => eventsCsv(report), type: csv },
  ];
  return (
    <Panel title="내려받기" meta="지금 거른 그대로 · 엑셀에서 바로 열림">
      <div className="adm-beta-downloads">
        {files.map((file) => (
          <button
            key={file.name}
            type="button"
            className="adm-button adm-button--ghost"
            onClick={() => save(file.name, file.make(), file.type)}
          >
            {file.label}
          </button>
        ))}
      </div>
      <p className="adm-muted adm-beta-tools__note">
        사람별 파일의 「참가 번호」는 게임이 설문 폼에 미리 채운 값이라, 설문 응답과 이 번호로 맞춥니다. 시각은 한국
        시간이 아니라 UTC 로 적힙니다.
      </p>
    </Panel>
  );
}
