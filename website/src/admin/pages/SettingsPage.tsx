import { useState, type ReactNode } from "react";

import { API_ORIGIN } from "@/config/env";

import { toAdminError } from "../api/client";
import { READONLY_LABEL, fetchAdmins, fetchSettings, updateMaintenanceMode, type AdminSettings } from "../api/settings";
import { useAdminResource } from "../api/useAdminResource";
import { useAdminMe } from "../auth/adminSession";
import ResourceView from "../auth/ResourceView";
import { formatDateTime } from "../lib/format";
import { useQueryChoice } from "../lib/useQueryChoice";
import Badge from "../ui/Badge";
import DataTable from "../ui/DataTable";
import Panel from "../ui/Panel";
import PillTabs from "../ui/PillTabs";

const TABS = [
  { id: "general", label: "일반" },
  { id: "admins", label: "관리자 계정" },
] as const;

/** name 은 실제 설정 이름(환경 값)일 때만 적는다. */
function ReadOnlyRow({ label, name, children }: { label: string; name?: string; children: ReactNode }) {
  return (
    <div className="adm-field-row">
      <dt>
        {label}
        {name && <span className="adm-field-row__key">{name}</span>}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * 설정(관리자 API v0.3 P3-2) — 점검 모드는 여기서 켜고 끈다(값 저장). 켜면 웹사이트가 공개 /site/status 를 읽어 점검 화면으로
 * 바뀐다(게임 · API 는 안 막는다, 미르 11/13). 게임 값은 실행 중 서버의 실제 설정을 읽어 보여만 준다 — 바꾸려면 배포.
 */
export default function SettingsPage() {
  const [tab, setTab] = useQueryChoice("tab", TABS, "general");

  return (
    <>
      <PillTabs label="설정 구분" items={TABS} activeId={tab} onSelect={setTab} />
      {tab === "general" ? <GeneralSettings /> : <AdminAccounts />}
    </>
  );
}

function GeneralSettings() {
  const [version, setVersion] = useState(0);
  const [resource, retry] = useAdminResource(`settings:${version}`, fetchSettings);
  return (
    <ResourceView resource={resource} retry={retry} loadingText="설정을 불러오는 중…">
      {(settings: AdminSettings) => (
        <div className="adm-grid adm-grid--three">
          <Panel title="사이트" meta="읽기 전용">
            <dl className="adm-fields">
              <ReadOnlyRow label="서비스 이름">ESCAPE THE LEGEND</ReadOnlyRow>
              <ReadOnlyRow label="관리자 주소">
                <span className="is-mono">www.k-escape.com/admin</span>
              </ReadOnlyRow>
              <ReadOnlyRow label="API 주소" name="VITE_API_ORIGIN">
                {API_ORIGIN ? <span className="is-mono">{API_ORIGIN}</span> : "같은 출처 /api"}
              </ReadOnlyRow>
            </dl>
          </Panel>
          <Panel title="게임 · 서버 값" meta="읽기 전용 · 실행 중 서버에서 읽음">
            <dl className="adm-fields">
              {Object.entries(settings.readonly).map(([key, value]) => (
                <ReadOnlyRow key={key} label={READONLY_LABEL[key] ?? key} name={key.toUpperCase()}>
                  {typeof value === "boolean" ? (value ? "켬" : "끔") : String(value)}
                </ReadOnlyRow>
              ))}
            </dl>
            <p className="adm-muted">바꾸려면 서버 환경 값을 고쳐 배포합니다.</p>
          </Panel>
          <MaintenancePanel
            key={settings.editable.maintenance_mode.updated_at ?? "none"}
            settings={settings}
            onSaved={() => setVersion((count) => count + 1)}
          />
        </div>
      )}
    </ResourceView>
  );
}

function MaintenancePanel({ settings, onSaved }: { settings: AdminSettings; onSaved: () => void }) {
  const current = settings.editable.maintenance_mode;
  const [message, setMessage] = useState(current.message);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const save = async (on: boolean) => {
    setBusy(true);
    setNotice("");
    try {
      await updateMaintenanceMode(on, message.trim());
      setNotice(on ? "점검 모드를 켰습니다. 웹사이트는 점검 화면으로 바뀝니다." : "점검 모드를 껐습니다.");
      onSaved();
    } catch (error) {
      setNotice(
        toAdminError(error).kind === "invalidQuery"
          ? "안내 문구는 200자까지입니다."
          : "저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="점검" meta="웹사이트만 · 게임과 API 는 막지 않음">
      <div className="adm-switch-row">
        <span className="adm-switch-row__label">점검 모드 {current.on ? "켜짐" : "꺼짐"}</span>
        <button
          type="button"
          role="switch"
          aria-checked={current.on}
          className="adm-switch"
          disabled={busy}
          onClick={() => save(!current.on)}
        >
          <span className="adm-sr-only">점검 모드</span>
        </button>
      </div>
      <label className="adm-field">
        <span>점검 화면에 보일 안내(200자까지)</span>
        <input
          className="adm-input"
          maxLength={200}
          value={message}
          disabled={busy}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="예) 새벽 점검 중입니다 (~06:00)"
        />
      </label>
      <div className="adm-input-group">
        <button
          type="button"
          className="adm-button adm-button--primary"
          disabled={busy}
          onClick={() => save(current.on)}
        >
          안내 문구 저장
        </button>
      </div>
      <p className="adm-muted">
        {current.updated_at
          ? `마지막 변경 ${formatDateTime(current.updated_at)} · ${current.updated_by ?? "관리자(삭제됨)"}`
          : "아직 바꾼 적이 없습니다."}{" "}
        켜고 끄는 것은 활동 로그에 「설정 변경」으로 남습니다. 관리자 주소는 점검 중에도 열립니다.
      </p>
      {notice && (
        <p className="adm-muted" role="status">
          {notice}
        </p>
      )}
    </Panel>
  );
}

function AdminAccounts() {
  const me = useAdminMe();
  const [resource, retry] = useAdminResource("admins", fetchAdmins);
  return (
    <div className="adm-grid adm-grid--two">
      <Panel title="지금 로그인한 관리자">
        <dl className="adm-fields">
          <ReadOnlyRow label="닉네임">{me.nickname}</ReadOnlyRow>
          <ReadOnlyRow label="이메일">
            <span className="is-mono">{me.email}</span>
          </ReadOnlyRow>
          <ReadOnlyRow label="역할">
            <Badge tone="blue">관리자</Badge>
          </ReadOnlyRow>
        </dl>
      </Panel>
      <Panel title="관리자 목록" meta="보기 전용 · 지정 · 해제는 서버 스크립트(scripts/set_user_role.py)">
        <ResourceView resource={resource} retry={retry} loadingText="관리자 목록을 불러오는 중…">
          {(data) => (
            <DataTable
              caption="관리자 목록"
              rows={data.items}
              rowKey={(row) => row.user_id}
              emptyText="관리자 계정이 없습니다."
              columns={[
                { key: "nickname", header: "닉네임", render: (row) => row.nickname },
                { key: "email", header: "이메일", mono: true, render: (row) => row.email },
                {
                  key: "created",
                  header: "가입",
                  mono: true,
                  width: "168px",
                  render: (row) => formatDateTime(row.created_at),
                },
                {
                  key: "last",
                  header: "최근 로그인",
                  mono: true,
                  width: "220px",
                  render: (row) =>
                    row.last_login_at ? (
                      formatDateTime(row.last_login_at)
                    ) : row.last_session_started_at ? (
                      <>
                        {formatDateTime(row.last_session_started_at)} <Badge tone="gray">추정</Badge>
                      </>
                    ) : (
                      "—"
                    ),
                },
              ]}
            />
          )}
        </ResourceView>
        <p className="adm-muted">이 목록을 열면 활동 로그에 「관리자 목록 조회」로 남습니다.</p>
      </Panel>
    </div>
  );
}
