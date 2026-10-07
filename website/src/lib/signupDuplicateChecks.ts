import type { AsyncCheck } from "@/hooks/useForm";
import { isEmailTaken, isNicknameTaken } from "@/services/accountStore";

import type { FieldName } from "./validation";

// 칸을 떠나거나 고치다 멈추면 저장소에 「이미 있나」를 묻는다.
export const SIGNUP_DUPLICATE_CHECKS: Partial<Record<FieldName, AsyncCheck>> = {
  email: async (value) => ((await isEmailTaken(value)) ? "이미 가입된 이메일입니다." : ""),
  nickname: async (value) => ((await isNicknameTaken(value)) ? "이미 사용 중인 닉네임입니다." : ""),
};
