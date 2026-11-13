import { useState } from "react";

import {
  fetchContent,
  fetchContents,
  type ContentCase,
  type ContentCaseDetail,
  type ContentCounts,
} from "../api/contents";
import { useAdminResource } from "../api/useAdminResource";
import ResourceView from "../auth/ResourceView";
import { formatDateTime, formatNumber } from "../lib/format";
import Badge from "../ui/Badge";
import DataTable from "../ui/DataTable";
import Modal from "../ui/Modal";
import Panel from "../ui/Panel";

/**
 * 콘텐츠 — 읽기 전용(관리자 API v0.3 P3-3, 미르 11/13). 사건 · 판(버전) · fingerprint 저장값 · 게시 상태 · 이력과
 * client 콘텐츠에서 센 존 · 오브젝트 · 상호작용 수만 보인다. 정답 · 서버 런타임 · NPC 대사 원문은 서버가 어떤 응답에도 싣지 않는다.
 */
export default function ContentsPage() {
  const [resource, retry] = useAdminResource("contents", fetchContents);
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <>
      <ResourceView resource={resource} retry={retry} loadingText="콘텐츠를 불러오는 중…">
        {(data) => (
          <Panel title="사건 목록" meta="읽기 전용 · 누르면 존 · 게시 이력">
            {data.cases.length === 0 ? (
              <p className="adm-muted">등록된 콘텐츠가 없습니다.</p>
            ) : (
              <ul className="adm-cards">
                {data.cases.map((item) => (
                  <li key={item.case_id} className="adm-content-card">
                    <div className="adm-content-card__body">
                      <span className="adm-content-card__id">{item.case_id}</span>
                      <p className="adm-content-card__title">
                        <button
                          type="button"
                          className="adm-button adm-button--ghost adm-button--small"
                          onClick={() => setOpenId(item.case_id)}
                        >
                          {item.legacy ? "레거시 사건(버전 없음)" : `판 ${formatNumber(item.versions.length)}개`}
                        </button>
                      </p>
                      <div className="adm-content-card__meta">
                        <span>{item.legacy ? "콘텐츠 폴더" : "게시 기록"}</span>
                        <StatusBadge item={item} />
                      </div>
                      <span className="adm-content-card__date">{countsText(item.counts)}</span>
                      {item.versions[0] && (
                        <span className="adm-content-card__date is-mono" title={item.versions[0].content_fingerprint}>
                          v{item.versions[0].content_version} · {shortFingerprint(item.versions[0].content_fingerprint)}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="adm-muted">
              개수는 그 판의 client 콘텐츠를 읽을 수 있을 때만 셉니다. 게시 저장소에 올라오지 않은 판은 「개수
              없음」으로 보입니다.
            </p>
          </Panel>
        )}
      </ResourceView>
      {openId && <ContentModal caseId={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

function StatusBadge({ item }: { item: ContentCase }) {
  const status = item.versions[0]?.publication_status ?? null;
  if (item.legacy) return <Badge tone="gray">레거시</Badge>;
  if (status === "published") return <Badge tone="blue">게시중</Badge>;
  return <Badge tone="gray">{status ?? "상태 없음"}</Badge>;
}

const countsText = (counts: ContentCounts | null) =>
  counts
    ? `존 ${formatNumber(counts.zones)} · 오브젝트 ${formatNumber(counts.objects)} · 상호작용 ${formatNumber(counts.interactions)}`
    : "개수 없음(client 콘텐츠를 못 읽음)";

const shortFingerprint = (value: string) => (value.length > 19 ? `${value.slice(0, 19)}…` : value);

function ContentModal({ caseId, onClose }: { caseId: string; onClose: () => void }) {
  const [resource, retry] = useAdminResource(`content:${caseId}`, (signal) => fetchContent(caseId, signal));
  return (
    <Modal title={caseId} meta="읽기 전용 — 정답 · 런타임 · 대사 원문은 서버가 주지 않습니다" onClose={onClose} wide>
      <ResourceView resource={resource} retry={retry} loadingText="사건을 불러오는 중…" notFoundText="없는 사건입니다.">
        {(detail: ContentCaseDetail) => (
          <div className="adm-grid adm-grid--two">
            <Panel title="존" meta={countsText(detail.counts)}>
              <DataTable
                caption="존 목록"
                rows={detail.zones}
                rowKey={(zone) => zone.zone_id}
                emptyText="client 콘텐츠를 읽을 수 없어 존 목록이 없습니다."
                columns={[
                  { key: "id", header: "존 ID", mono: true, width: "140px", render: (zone) => zone.zone_id },
                  { key: "name", header: "이름", render: (zone) => zone.zone_name },
                  { key: "type", header: "종류", width: "100px", render: (zone) => zone.zone_type },
                  {
                    key: "objects",
                    header: "오브젝트",
                    width: "88px",
                    align: "end",
                    render: (zone) => formatNumber(zone.objects),
                  },
                  {
                    key: "interactions",
                    header: "상호작용",
                    width: "88px",
                    align: "end",
                    render: (zone) => formatNumber(zone.interactions),
                  },
                ]}
              />
              {Object.keys(detail.interactions_by_type).length > 0 && (
                <p className="adm-muted">
                  상호작용 종류:{" "}
                  {Object.entries(detail.interactions_by_type)
                    .map(([kind, count]) => `${kind} ${formatNumber(count)}`)
                    .join(" · ")}
                </p>
              )}
            </Panel>
            <Panel
              title="판 · 게시 이력"
              meta={detail.legacy ? "레거시 — 버전 없음" : `판 ${formatNumber(detail.versions.length)}개`}
            >
              <DataTable
                caption="판 목록"
                rows={detail.versions}
                rowKey={(version) => String(version.content_version)}
                emptyText="등록된 판이 없습니다."
                columns={[
                  { key: "v", header: "판", width: "56px", render: (version) => `v${version.content_version}` },
                  {
                    key: "fp",
                    header: "fingerprint",
                    mono: true,
                    truncate: (version) => version.content_fingerprint,
                    render: (version) => (
                      <span title={version.content_fingerprint}>{shortFingerprint(version.content_fingerprint)}</span>
                    ),
                  },
                  {
                    key: "status",
                    header: "게시 상태",
                    width: "100px",
                    render: (version) =>
                      version.publication_status === "published" ? (
                        <Badge tone="blue">게시중</Badge>
                      ) : (
                        <Badge tone="gray">{version.publication_status ?? "없음"}</Badge>
                      ),
                  },
                  {
                    key: "at",
                    header: "등록",
                    mono: true,
                    width: "168px",
                    render: (version) => formatDateTime(version.registered_at),
                  },
                ]}
              />
              <DataTable
                caption="게시 이력(최근 20건)"
                rows={detail.events}
                rowKey={(event) => `${event.content_version}:${event.at}:${event.to_status}`}
                emptyText="게시 이력이 없습니다."
                columns={[
                  {
                    key: "at",
                    header: "시각",
                    mono: true,
                    width: "168px",
                    render: (event) => formatDateTime(event.at),
                  },
                  { key: "v", header: "판", width: "56px", render: (event) => `v${event.content_version}` },
                  {
                    key: "change",
                    header: "변경",
                    width: "160px",
                    render: (event) => `${event.from_status ?? "—"} → ${event.to_status}`,
                  },
                  {
                    key: "actor",
                    header: "실행",
                    width: "120px",
                    truncate: (event) => event.actor,
                    render: (event) => event.actor,
                  },
                  { key: "reason", header: "사유", truncate: (event) => event.reason, render: (event) => event.reason },
                ]}
              />
            </Panel>
          </div>
        )}
      </ResourceView>
    </Modal>
  );
}
