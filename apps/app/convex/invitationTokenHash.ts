import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

const INVITATION_TOKEN_DOMAIN = "plinth-invitation-token-v1:";

export function hashInvitationToken(token: string): string {
  return bytesToHex(
    sha256(utf8ToBytes(`${INVITATION_TOKEN_DOMAIN}${token}`)),
  );
}
