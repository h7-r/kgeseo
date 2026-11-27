import { useState } from "react";

import { hasNoErrors, validateFields, type FieldErrors, type FieldName, type FormValues } from "@/lib/validation";
import { receiptAudience, submitInquiry, toCategoryCode } from "@/services/inquiries";
import { confirmServerSession, useSessionUser } from "@/services/session";

const INQUIRY_FIELDS: readonly FieldName[] = ["inquiryType", "title", "content", "email"];

/**
 * 문의 서버(관리자 API v0.3, POST /api/v1/inquiries)가 생겨 켰다(미르 11/13). 끄면 데스크톱 · 휴대폰 모두 메일 안내만 보인다 —
 * 서버가 내려가 접수를 받지 못할 때 쓰는 스위치.
 */
export const IS_INQUIRY_API_READY = true;

/** 문의 유형(화면 글). 디자인에 목록이 없어 공지 · FAQ 분류를 그대로 쓴다. 서버 코드로는 toCategoryCode 가 바꾼다 */
export const INQUIRY_TYPES = ["계정", "게임플레이", "결제", "기술지원", "기타"] as const;

/** 방금 접수한 문의 한 건 — 접수 완료 카드가 되짚어 주는 값. 서버에 있으니 브라우저에는 두지 않는다 */
export interface InquiryReceipt {
  number: string;
  type: string;
  title: string;
  content: string;
  /** 답변 받을 이메일 */
  email: string;
  attachment: string | null;
  /** 접수 시각(ms) */
  receivedAt: number;
  /** 이 문의가 회원 계정에 연결돼 저장됐나 — 건마다 다를 수 있어 접수할 때의 값을 든다(services/inquiries receiptAudience) */
  isMember: boolean;
  /** 화면은 로그인이었는데 서버 세션이 끝나 비회원으로 접수됐다 */
  isSessionExpired: boolean;
}

/**
 * 1:1 문의 양식의 값 · 검사 · 접수. 데스크톱(InquiryPanel)과 휴대폰(MobilePages)이 그리는 모양만 다르고 이 훅을 같이 쓴다.
 * 로그인했으면 답변 받을 이메일을 내 이메일로 채워 둔다(고칠 수 있다).
 */
export function useInquiryForm() {
  const user = useSessionUser();
  // 이메일 칸을 아직 건드리지 않았으면 내 이메일을 보인다. 값으로 넣어 두지 않아서, 새 탭에서 /me 복원이 첫 그림보다
  // 늦게 끝나도 그때 채워진다. 지우면("") 지운 그대로 둔다.
  const [touchedValues, setValues] = useState<FormValues>({});
  const values: FormValues = { ...touchedValues, email: touchedValues.email ?? user?.email };
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitted, setSubmitted] = useState(false);
  // 마지막으로 접수한 문의. 있으면 입력 칸 자리에 접수 완료 카드를 보인다.
  const [receipt, setReceipt] = useState<InquiryReceipt | null>(null);
  const [receiptCount, setReceiptCount] = useState(0);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState("");

  const handleChange = (name: FieldName) => (value: string) => {
    setValues({ ...touchedValues, [name]: value });
    if (submitted) setErrors(validateFields(INQUIRY_FIELDS, { ...values, [name]: value }));
  };

  const submit = async () => {
    setSubmitted(true);
    const nextErrors = validateFields(INQUIRY_FIELDS, values);
    setErrors(nextErrors);
    if (!hasNoErrors(nextErrors) || isSending) return;
    setIsSending(true);
    setSendError("");
    const result = await submitInquiry({
      category: toCategoryCode(values.inquiryType ?? ""),
      title: values.title ?? "",
      body: values.content ?? "",
      email: values.email ?? "",
    });
    setIsSending(false);
    if (!result.ok) {
      setSendError(result.reason);
      return;
    }
    // 회원 안내를 보일지는 서버가 실제로 저장한 결과로 — 화면은 로그인인데 비회원으로 저장됐으면 세션이 끝난 것이다
    const audience = receiptAudience(result.isMember, Boolean(user), Boolean(user?.isTest));
    // 로그인 표시는 서버에 한 번 더 물어 거둔다 — 응답을 기다리는 사이 다른 탭에서 다시 로그인했으면 그 로그인을 지우지 않게(Codex 리뷰)
    if (audience.isSessionExpired) void confirmServerSession();
    setReceipt({
      isMember: audience.isMember,
      isSessionExpired: audience.isSessionExpired,
      number: result.number,
      type: values.inquiryType ?? "",
      title: values.title ?? "",
      content: values.content ?? "",
      email: values.email ?? "",
      attachment: null,
      receivedAt: result.createdAt,
    });
    setReceiptCount((count) => count + 1);
  };

  /** 「추가 접수하기」 — 빈 양식으로 돌아간다 */
  const startAnother = () => {
    setValues({});
    setErrors({});
    setSubmitted(false);
    setSendError("");
    setReceipt(null);
  };

  const fieldProps = (name: FieldName) => ({
    value: values[name] ?? "",
    onChange: handleChange(name),
    error: errors[name],
  });

  return { user, receipt, receiptCount, isSending, sendError, submit, startAnother, fieldProps };
}

/** 접수 완료 카드의 안내 — 데스크톱 · 휴대폰이 같은 말을 쓴다 */
export function receiptMessage(receipt: InquiryReceipt): string {
  if (receipt.isMember) return "답변이 등록되면 마이페이지 「내 문의」에서 볼 수 있습니다.";
  if (receipt.isSessionExpired) {
    return "로그인이 만료되어 비회원으로 접수되었습니다. 답변은 적어 주신 이메일로 따로 드립니다(자동 발송 아님).";
  }
  return "운영팀이 적어 주신 이메일로 따로 답변드립니다(자동 발송 아님).";
}
