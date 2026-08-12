import "server-only";
import {
  decryptTargetCore,
  encryptTargetCore,
  maskTargetCore,
} from "@/lib/notifications/target-crypto-core.mjs";

export const encryptTarget = encryptTargetCore;
export const decryptTarget = decryptTargetCore;
export const maskTarget = maskTargetCore;
