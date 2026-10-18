import { define } from "@/utils.ts";
import { healthResponse } from "@/services/health_service.ts";

export const handler = define.handlers({ GET: () => healthResponse() });
