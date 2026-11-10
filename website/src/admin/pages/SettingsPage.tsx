import type { ReactNode } from "react";

import { API_ORIGIN } from "@/config/env";

import { useAdminMe } from "../auth/adminSession";
import { useQueryChoice } from "../lib/useQueryChoice";
import Badge from "../ui/Badge";
import Panel from "../ui/Panel";
import PillTabs from "../ui/PillTabs";
import { PendingScreen } from "../ui/StatusScreen";

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

const notConnected = <span className="adm-muted">서버 값 연결 전</span>;

/** 게임 값(힌트 · 동시접속 · 세션)은 서버 콘텐츠 · 설정에서 정한다. 여기서는 읽기만 하고 바꾸지 않는다. */
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
  return (
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
      <Panel title="게임" meta="읽기 전용 · 서버 설정">
        <dl className="adm-fields">
          <ReadOnlyRow label="회차 시작 힌트" name="HINT_INITIAL_BALANCE">
            {notConnected}
          </ReadOnlyRow>
          <ReadOnlyRow label="최대 동시접속">{notConnected}</ReadOnlyRow>
          <ReadOnlyRow label="로그인 유지 기간">{notConnected}</ReadOnlyRow>
        </dl>
      </Panel>
      <Panel title="점검" meta="서버 스위치">
        <div className="adm-switch-row">
          <span className="adm-switch-row__label">점검 모드</span>
          <button type="button" role="switch" aria-checked={false} className="adm-switch" disabled>
            <span className="adm-sr-only">점검 모드</span>
          </button>
        </div>
        <p className="adm-muted">
          서버 스위치가 생기면 연결합니다. 켜면 웹사이트가 점검 화면(/maintenance)으로 바뀝니다. 지금 상태는 이 화면에서
          알 수 없습니다.
        </p>
      </Panel>
    </div>
  );
}

function AdminAccounts() {
  const me = useAdminMe();
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
      <Panel title="관리자 목록" meta="보기 전용">
        <PendingScreen
          compact
          needs="관리자 목록 API 가 생기면 열립니다. 관리자 지정 · 해제는 서버 스크립트(scripts/set_user_role.py)로만 합니다."
        />
      </Panel>
    </div>
  );
}
