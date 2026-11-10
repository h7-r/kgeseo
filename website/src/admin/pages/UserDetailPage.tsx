import type { ReactNode } from "react";
import { Link, useLocation, useParams } from "react-router-dom";

import { useAdminResource } from "../api/useAdminResource";
import { fetchUserDetail, type AdminUserDetail } from "../api/users";
import ResourceView from "../auth/ResourceView";
import { formatDate, formatDateTime, formatNumber } from "../lib/format";
import { stageLabel } from "../lib/gameStage";
import { listSections } from "../lib/saveSections";
import { ADMIN_PATHS } from "../paths";
import Badge from "../ui/Badge";
import DataTable from "../ui/DataTable";
import PageHeader from "../ui/PageHeader";
import Panel from "../ui/Panel";

/** 목록에서 넘겨준 주소(필터 · 펼친 만큼)로 돌아간다. 다른 값은 받지 않는다. */
function backPath(state: unknown): string {
  const from = typeof state === "object" && state !== null && "from" in state ? state.from : null;
  return typeof from === "string" && from.startsWith(ADMIN_PATHS.users) ? from : ADMIN_PATHS.users;
}

export default function UserDetailPage() {
  const { userId = "" } = useParams();
  const location = useLocation();
  const [resource, retry] = useAdminResource(`user:${userId}`, (signal) => fetchUserDetail(userId, signal));

  return (
    <>
      <Link to={backPath(location.state)} className="adm-back">
        ← 회원 목록
      </Link>
      <p className="adm-audit-banner" role="note">
        열람 기록이 남습니다 — 이 화면을 열면 누가 언제 이 회원 정보를 봤는지 서버 관리자 기록에 남습니다.
      </p>
      <ResourceView
        resource={resource}
        retry={retry}
        loadingText="회원 정보를 불러오고 있습니다"
        notFoundText="없는 회원입니다"
      >
        {(detail) => <UserDetail detail={detail} />}
      </ResourceView>
    </>
  );
}

function Field({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="adm-field-row">
      <dt>{label}</dt>
      <dd className={mono ? "is-mono" : undefined}>{children}</dd>
    </div>
  );
}

function UserDetail({ detail }: { detail: AdminUserDetail }) {
  const { user, save, character, items } = detail;
  const sections = listSections(save?.state);

  return (
    <>
      <PageHeader title={user.nickname} description="회원 상세" />
      <div className="adm-grid adm-grid--three">
        <Panel title="계정">
          <dl className="adm-fields">
            <Field label="닉네임">{user.nickname}</Field>
            <Field label="이메일" mono>
              {user.email}
            </Field>
            <Field label="역할">
              {user.role === "admin" ? <Badge tone="blue">관리자</Badge> : <Badge tone="gray">회원</Badge>}
            </Field>
            <Field label="가입일" mono>
              {formatDate(user.created_at)}
            </Field>
            <Field label="회원 ID" mono>
              <span className="adm-break">{user.user_id}</span>
            </Field>
          </dl>
        </Panel>
        <Panel title="게임 저장">
          {save ? (
            <dl className="adm-fields">
              <Field label="진행 단계">{stageLabel(save.stage)}</Field>
              <Field label="저장 판" mono>
                {formatNumber(save.revision)}
              </Field>
              <Field label="저장 형식" mono>
                v{save.schema_version}
              </Field>
              <Field label="마지막 저장" mono>
                {formatDateTime(save.updated_at)}
              </Field>
            </dl>
          ) : (
            <p className="adm-muted">저장이 없습니다. 아직 게임을 시작하지 않았습니다.</p>
          )}
        </Panel>
        <Panel title="캐릭터">
          {character ? (
            <dl className="adm-fields">
              <Field label="표시 이름">{character.display_name}</Field>
              <Field label="수정 시각" mono>
                {formatDateTime(character.updated_at)}
              </Field>
            </dl>
          ) : (
            <p className="adm-muted">캐릭터를 아직 만들지 않았습니다.</p>
          )}
        </Panel>
      </div>

      <Panel title="저장 칸" meta="단계 이름 · 예/아니오만 표시 — 숫자 · 목록 값은 퍼즐 정답이 될 수 있어 숨김">
        <DataTable
          caption="게임 저장 칸"
          rows={sections}
          rowKey={(row) => row.name}
          emptyText="저장 칸이 없습니다."
          columns={[
            { key: "name", header: "칸 이름", mono: true, width: "240px", render: (row) => row.name },
            { key: "summary", header: "진행 표시", truncate: (row) => row.summary, render: (row) => row.summary },
          ]}
        />
      </Panel>

      <Panel title="소지 아이템" meta={`${formatNumber(items.length)}종`}>
        <DataTable
          caption="소지 아이템"
          rows={items}
          rowKey={(item) => item.item_id}
          emptyText="가진 아이템이 없습니다."
          columns={[
            { key: "name", header: "이름", truncate: (item) => item.name, render: (item) => item.name },
            { key: "kind", header: "종류", width: "140px", render: (item) => item.kind },
            {
              key: "quantity",
              header: "수량",
              align: "end",
              mono: true,
              width: "88px",
              render: (item) => formatNumber(item.quantity),
            },
            { key: "source", header: "얻은 곳", width: "160px", render: (item) => item.source },
            {
              key: "acquired",
              header: "얻은 시각",
              mono: true,
              width: "176px",
              render: (item) => formatDateTime(item.acquired_at),
            },
          ]}
        />
      </Panel>
    </>
  );
}
