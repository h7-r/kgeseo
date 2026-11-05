import { apiOrigin } from "../../../../shared/deploymentUrls.ts";

export const AUTH_API_ORIGIN = apiOrigin(import.meta.env.VITE_API_ORIGIN, import.meta.env.PROD);
